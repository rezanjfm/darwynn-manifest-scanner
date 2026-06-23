"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { detectCarrier, extractTrackingNumber } from "@/lib/carriers";
import { queueScan, getPendingScans, markScanSynced, getLocalTrackingNumbers } from "@/lib/offline-queue";
import { downloadCSV, manifestToCSV } from "@/lib/csv";
import ScanFeedback, { FeedbackState } from "@/components/ScanFeedback";
import ManualEntryModal from "@/components/ManualEntryModal";
import { Manifest, Carrier, Parcel } from "@/types";
import { format } from "date-fns";

// Lazy-load the camera component — it imports WASM and is large
const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-black flex items-center justify-center text-white text-lg">
      Starting camera…
    </div>
  ),
});

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

type ScanItem = Pick<Parcel, "id" | "tracking_number" | "entry_method" | "scanned_at">;

export default function ScanPage() {
  const { id: manifestId } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [carrier, setCarrier] = useState<Carrier | null>(null);
  const [allCarriers, setAllCarriers] = useState<Carrier[]>([]);
  const [scannedList, setScannedList] = useState<ScanItem[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [showManual, setShowManual] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"worker" | "manager" | "admin">("worker");
  const [loading, setLoading] = useState(true);

  const seenRef = useRef<Set<string>>(new Set());
  // Tracks IDs deleted optimistically so the realtime DELETE event doesn't double-decrement
  const pendingDeletesRef = useRef<Set<string>>(new Set());

  // Derived before hooks so the keyboard wedge effect can depend on it.
  // False while loading (manifest is null), false when closed or a modal is open.
  const scannerActive = !!manifest && manifest.status !== "closed" && !showManual && !showClose;

  // --- Load manifest, carriers, and parcel history ---
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);

      const [{ data: profile }, { data: mfData }, { data: carriersData }, { data: parcelsData }] = await Promise.all([
        supabase.from("user_profiles").select("role").eq("id", user.id).single(),
        supabase.from("manifests").select("*, carrier:carriers(*)").eq("id", manifestId).single(),
        supabase.from("carriers").select("*").eq("active", true).order("name"),
        supabase
          .from("parcels")
          .select("id, tracking_number, entry_method, scanned_at")
          .eq("manifest_id", manifestId)
          .order("scanned_at", { ascending: false })
          .limit(100),
      ]);

      if (profile) setUserRole(profile.role as "worker" | "manager" | "admin");
      if (!mfData) { router.push("/manifests"); return; }
      setManifest(mfData as unknown as Manifest);
      setCarrier((mfData as unknown as { carrier: Carrier }).carrier);
      setAllCarriers(carriersData ?? []);

      const items = (parcelsData ?? []) as ScanItem[];
      setScannedList(items);

      const dbNums = new Set(items.map((p) => p.tracking_number));
      const localNums = await getLocalTrackingNumbers(manifestId);
      seenRef.current = new Set([...dbNums, ...localNums]);

      setLoading(false);
    }
    load();
  }, [manifestId, router, supabase]);

  // --- Realtime: sync count + list when another device scans or voids ---
  useEffect(() => {
    const channel = supabase
      .channel(`manifest-parcels-${manifestId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "parcels", filter: `manifest_id=eq.${manifestId}` },
        (payload) => {
          const p = payload.new as Parcel;
          // Skip if this device scanned it (already added optimistically)
          if (seenRef.current.has(p.tracking_number)) return;
          seenRef.current.add(p.tracking_number);
          setManifest((m) => m ? { ...m, parcel_count: m.parcel_count + 1 } : m);
          setScannedList((prev) => [
            { id: p.id, tracking_number: p.tracking_number, entry_method: p.entry_method, scanned_at: p.scanned_at },
            ...prev,
          ]);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "parcels", filter: `manifest_id=eq.${manifestId}` },
        (payload) => {
          const deletedId = payload.old.id as string;
          // Skip if this device initiated the void (already handled optimistically)
          if (pendingDeletesRef.current.has(deletedId)) {
            pendingDeletesRef.current.delete(deletedId);
            return;
          }
          setScannedList((prev) => {
            const item = prev.find((p) => p.id === deletedId);
            if (item) seenRef.current.delete(item.tracking_number);
            return prev.filter((p) => p.id !== deletedId);
          });
          setManifest((m) => m ? { ...m, parcel_count: Math.max(0, m.parcel_count - 1) } : m);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [manifestId, supabase]);

  // --- Online/offline tracking ---
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // --- Sync queue when back online ---
  const syncQueue = useCallback(async () => {
    if (!isOnline || syncing || !userId) return;
    const pending = await getPendingScans(manifestId);
    if (pending.length === 0) return;
    setSyncing(true);
    for (const scan of pending) {
      const { error } = await supabase.from("parcels").insert({
        id: scan.id,
        manifest_id: scan.manifest_id,
        carrier_id: scan.carrier_id,
        tracking_number: scan.tracking_number,
        raw_barcode: scan.raw_barcode,
        entry_method: scan.entry_method,
        scanned_by: scan.scanned_by,
        scanned_at: scan.scanned_at,
      });
      if (!error) await markScanSynced(scan.id);
    }
    setSyncing(false);
    const { data } = await supabase.from("manifests").select("parcel_count").eq("id", manifestId).single();
    if (data) setManifest((m) => m ? { ...m, parcel_count: data.parcel_count } : m);
  }, [isOnline, syncing, userId, manifestId, supabase]);

  useEffect(() => {
    if (isOnline) syncQueue();
  }, [isOnline, syncQueue]);

  // --- Handle a scan (from camera or manual entry) ---
  const handleScan = useCallback(async (rawBarcode: string, entryMethod: "scan" | "manual" = "scan") => {
    if (!manifest || !carrier || !userId) return;
    if (manifest.status === "closed" && userRole === "worker") return;

    const tracking = extractTrackingNumber(rawBarcode);

    if (seenRef.current.has(tracking)) {
      setFeedback({ type: "duplicate", tracking });
      return;
    }

    const detected = detectCarrier(tracking, allCarriers);
    if (detected && detected.id !== carrier.id) {
      setFeedback({ type: "wrong_carrier", tracking, detected: detected.name, expected: carrier.name });
      return;
    }

    seenRef.current.add(tracking);

    const now = new Date().toISOString();
    const scanId = newId();

    const scanRecord = {
      id: scanId,
      manifest_id: manifestId,
      carrier_id: carrier.id,
      tracking_number: tracking,
      raw_barcode: rawBarcode,
      entry_method: entryMethod,
      scanned_by: userId,
      scanned_at: now,
      synced: false,
    };

    await queueScan(scanRecord);

    setManifest((m) => m ? { ...m, parcel_count: m.parcel_count + 1 } : m);
    setScannedList((prev) => [{ id: scanId, tracking_number: tracking, entry_method: entryMethod, scanned_at: now }, ...prev]);
    setFeedback({ type: "success", tracking, carrier: carrier.name });

    if (isOnline) {
      const { error } = await supabase.from("parcels").insert({
        id: scanId,
        manifest_id: manifestId,
        carrier_id: carrier.id,
        tracking_number: tracking,
        raw_barcode: rawBarcode,
        entry_method: entryMethod,
        scanned_by: userId,
        scanned_at: now,
      });
      if (!error) await markScanSynced(scanId);
    }
  }, [manifest, carrier, userId, userRole, allCarriers, manifestId, isOnline, supabase]);

  // --- Void a scan (manager only) ---
  const voidScan = useCallback(async (scanId: string, trackingNumber: string) => {
    pendingDeletesRef.current.add(scanId);
    // Optimistic update
    seenRef.current.delete(trackingNumber);
    setScannedList((prev) => prev.filter((p) => p.id !== scanId));
    setManifest((m) => m ? { ...m, parcel_count: Math.max(0, m.parcel_count - 1) } : m);
    const { error } = await supabase.from("parcels").delete().eq("id", scanId);
    if (error) {
      // Rollback
      pendingDeletesRef.current.delete(scanId);
      seenRef.current.add(trackingNumber);
      setScannedList((prev) => [...prev]); // trigger re-render; full rollback would require stashing old list
      setManifest((m) => m ? { ...m, parcel_count: m.parcel_count + 1 } : m);
    }
  }, [supabase]);

  // Stable ref to handleScan used by the keyboard wedge listener to avoid stale closures
  const handleScanRef = useRef(handleScan);
  useEffect(() => { handleScanRef.current = handleScan; }, [handleScan]);

  // HID keyboard-wedge scanner support (USB/Bluetooth barcode guns and fixed counter scanners).
  // Scanners emit rapid keystrokes ending in Enter (or just a burst with no terminator).
  useEffect(() => {
    if (!scannerActive) return;

    const buf = { value: "" };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const val = buf.value.trim();
      buf.value = "";
      if (timer) { clearTimeout(timer); timer = null; }
      if (val.length >= 6) handleScanRef.current(val, "scan");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when a form field has focus (manual entry modal, etc.)
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter" || e.key === "Tab") {
        if (buf.value) { e.preventDefault(); flush(); }
        return;
      }

      if (e.key.length !== 1) return; // skip modifier/arrow/fn keys

      buf.value += e.key;
      if (timer) clearTimeout(timer);
      // 200 ms of silence means the scanner finished; handles guns that omit Enter
      timer = setTimeout(flush, 200);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [scannerActive]);

  // --- Close manifest ---
  async function closeManifest() {
    if (!manifest || !userId) return;
    const { error } = await supabase
      .from("manifests")
      .update({ status: "closed", closed_by: userId, closed_at: new Date().toISOString() })
      .eq("id", manifestId);
    if (error) { alert(error.message); return; }
    setManifest((m) => m ? { ...m, status: "closed" } : m);
    setShowClose(false);
    router.push("/manifests");
  }

  // --- Export CSV ---
  async function exportCSV() {
    if (!manifest || !carrier) return;
    const { data } = await supabase.from("parcels").select("*").eq("manifest_id", manifestId).order("scanned_at");
    const csv = manifestToCSV(manifest, carrier, (data as unknown as Parcel[]) ?? []);
    downloadCSV(csv, `manifest-${carrier.code}-${manifest.date}.csv`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white text-lg">Loading scanner…</div>
      </div>
    );
  }

  if (!manifest || !carrier) return null;

  const isClosed = manifest.status === "closed";

  return (
    <div className="h-screen flex flex-col bg-black overflow-hidden">
      {/* Top bar */}
      <div className="flex-none bg-gray-900 text-white px-4 py-3 safe-top">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => router.push("/manifests")}
            className="text-gray-400 text-2xl leading-none p-1"
          >
            ←
          </button>
          <div className="flex-1 text-center">
            <div className="font-bold text-lg leading-tight">{carrier.name}</div>
            <div className="text-gray-400 text-xs">{format(new Date(manifest.date), "MMM d, yyyy")}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-400">{manifest.parcel_count}</div>
            <div className="text-gray-400 text-xs">parcels</div>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2 mt-2">
          {manifest.direction === "inbound" && (
            <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
              ↩ INBOUND RETURN
            </span>
          )}
          {!isOnline && (
            <span className="bg-yellow-600 text-yellow-100 text-xs px-2 py-0.5 rounded-full font-semibold">
              OFFLINE — queuing scans
            </span>
          )}
          {syncing && (
            <span className="bg-blue-700 text-blue-100 text-xs px-2 py-0.5 rounded-full">
              Syncing…
            </span>
          )}
          {isClosed && (
            <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full font-semibold">
              MANIFEST CLOSED
            </span>
          )}
        </div>
      </div>

      {/* Camera or closed overlay */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <BarcodeScanner onScan={(v) => handleScan(v, "scan")} active={scannerActive} />

        {isClosed && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white p-6 gap-4">
            <div className="text-5xl">🔒</div>
            <div className="text-xl font-bold">Manifest Closed</div>
            <div className="text-gray-400 text-center">{manifest.parcel_count} parcels recorded</div>
            <button
              onClick={exportCSV}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-lg"
            >
              Export CSV
            </button>
            {userRole !== "worker" && (
              <button
                onClick={async () => {
                  await supabase.from("manifests").update({ status: "open", closed_at: null, closed_by: null }).eq("id", manifestId);
                  setManifest((m) => m ? { ...m, status: "open" } : m);
                }}
                className="text-yellow-400 underline text-sm"
              >
                Reopen manifest
              </button>
            )}
          </div>
        )}
      </div>

      {/* Recent scans panel */}
      {!isClosed && scannedList.length > 0 && (
        <div className="flex-none bg-gray-900 border-t border-gray-800 overflow-y-auto" style={{ maxHeight: "9rem" }}>
          {scannedList.slice(0, 20).map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 last:border-0">
              <span
                className={`w-5 h-5 flex-none flex items-center justify-center text-xs rounded font-bold ${
                  p.entry_method === "manual" ? "bg-yellow-700 text-yellow-200" : "bg-green-800 text-green-300"
                }`}
              >
                {p.entry_method === "manual" ? "M" : "S"}
              </span>
              <span className="font-mono text-sm text-white flex-1 truncate">{p.tracking_number}</span>
              <span className="text-gray-500 text-xs flex-none">{timeAgo(p.scanned_at)}</span>
              {userRole !== "worker" && (
                <button
                  onClick={() => voidScan(p.id, p.tracking_number)}
                  className="text-red-400 text-xs flex-none px-1.5 py-0.5 rounded hover:bg-red-900/50 transition-colors"
                  aria-label="Remove scan"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom action bar */}
      {!isClosed && (
        <div className="flex-none bg-gray-900 px-4 py-3 safe-bottom flex gap-3">
          <button
            onClick={() => setShowManual(true)}
            className="flex-1 bg-gray-700 text-white py-4 rounded-xl font-semibold text-sm"
          >
            ✎ Manual Entry
          </button>
          <button
            onClick={exportCSV}
            className="bg-gray-700 text-white px-4 py-4 rounded-xl font-semibold text-sm"
          >
            CSV
          </button>
          <button
            onClick={() => setShowClose(true)}
            className="flex-1 bg-red-700 text-white py-4 rounded-xl font-bold text-sm"
          >
            Close Manifest
          </button>
        </div>
      )}

      {/* Feedback overlay */}
      <ScanFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />

      {/* Manual entry modal */}
      {showManual && (
        <ManualEntryModal
          onSubmit={(v) => { setShowManual(false); handleScan(v, "manual"); }}
          onClose={() => setShowManual(false)}
        />
      )}

      {/* Close confirmation */}
      {showClose && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 animate-slide-up">
            <h2 className="text-xl font-bold mb-2">Close Manifest?</h2>
            <p className="text-gray-600 mb-1">
              {manifest.parcel_count} parcel{manifest.parcel_count !== 1 ? "s" : ""} will be locked.
            </p>
            <p className="text-sm text-gray-400 mb-5">This means the truck is gone. You can still export CSV after closing.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClose(false)} className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-semibold">
                Cancel
              </button>
              <button onClick={closeManifest} className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
