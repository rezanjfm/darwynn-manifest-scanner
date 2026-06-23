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
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"associate" | "manager" | "admin">("associate");
  const [loading, setLoading] = useState(true);

  const seenRef = useRef<Set<string>>(new Set());
  // Tracks IDs deleted optimistically so the realtime DELETE event doesn't double-decrement
  const pendingDeletesRef = useRef<Set<string>>(new Set());

  const scannerActive = !!manifest && !showManual;

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

      if (profile) setUserRole(profile.role as "associate" | "manager" | "admin");
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

  // --- Export CSV ---
  async function exportCSV() {
    if (!manifest || !carrier) return;
    const { data } = await supabase.from("parcels").select("*").eq("manifest_id", manifestId).order("scanned_at");
    const csv = manifestToCSV(manifest, carrier, (data as unknown as Parcel[]) ?? []);
    downloadCSV(csv, `manifest-${carrier.code}-${manifest.date}.csv`);
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (!manifest || !carrier) return null;

  const isInbound = manifest.direction === "inbound";

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">

      {/* ── Top bar ── */}
      <div className={`flex-none text-white px-4 pb-3 safe-top border-b ${
        isInbound ? "bg-orange-950/80 border-orange-900/50" : "bg-gray-900/80 border-white/5"
      } backdrop-blur-sm`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/manifests")}
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center text-gray-400 hover:text-white flex-none transition-colors text-base"
            aria-label="Back"
          >
            ←
          </button>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="font-bold text-sm leading-tight truncate">{carrier.name}</span>
            {isInbound && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded bg-orange-500/20 border border-orange-500/30 text-orange-400 flex-none">
                ↩ RETURN
              </span>
            )}
            {!isOnline && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 border border-yellow-500/20 text-yellow-400 flex-none">
                OFFLINE
              </span>
            )}
            {syncing && (
              <span className="text-[10px] font-bold text-brand flex-none animate-pulse">Syncing…</span>
            )}
          </div>

          <div className={`flex-none font-black tabular-nums leading-none ${isInbound ? "text-orange-400" : "text-brand"}`}
            style={{ fontSize: "2.5rem" }}>
            {manifest.parcel_count}
          </div>
        </div>
      </div>

      {/* ── Camera ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 bg-black">
        <BarcodeScanner onScan={(v) => handleScan(v, "scan")} active={scannerActive} />

        {feedback && (
          <div className="absolute top-0 inset-x-0 z-30">
            <ScanFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        )}

        {scannedList.length > 0 && (
          <div className="absolute bottom-0 inset-x-0 z-20">
            <div className="bg-black/80 backdrop-blur-sm border-t border-white/5">
              {scannedList.slice(0, 4).map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-white/5" : ""} ${i === 0 ? "bg-white/[0.03]" : ""}`}
                >
                  <span className={`w-5 h-5 flex-none flex items-center justify-center text-[10px] rounded-md font-black ${
                    p.entry_method === "manual" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"
                  }`}>
                    {p.entry_method === "manual" ? "M" : "S"}
                  </span>
                  <span className="font-mono text-xs text-white flex-1 truncate">{p.tracking_number}</span>
                  <span className="text-gray-600 text-xs flex-none">{timeAgo(p.scanned_at)}</span>
                  {userRole !== "associate" && (
                    <button
                      onClick={() => voidScan(p.id, p.tracking_number)}
                      className="w-5 h-5 flex-none flex items-center justify-center rounded text-red-500/70 hover:text-red-400 hover:bg-red-500/10 transition-colors text-[11px]"
                      aria-label="Remove scan"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className={`flex-none px-4 py-3 safe-bottom flex gap-2 border-t ${
        isInbound ? "bg-orange-950/80 border-orange-900/50" : "bg-gray-900/80 border-white/5"
      } backdrop-blur-sm`}>
        <button
          onClick={() => setShowManual(true)}
          className="flex-1 bg-white/8 border border-white/10 text-gray-300 py-3 rounded-xl font-semibold text-sm hover:bg-white/12 transition-colors active:scale-[0.97]"
        >
          ✎ Manual
        </button>
        <button
          onClick={exportCSV}
          className="bg-white/8 border border-white/10 text-gray-400 px-4 py-3 rounded-xl font-semibold text-sm hover:bg-white/12 transition-colors active:scale-[0.97]"
        >
          CSV
        </button>
      </div>

      {showManual && (
        <ManualEntryModal
          onSubmit={(v) => { setShowManual(false); handleScan(v, "manual"); }}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  );
}
