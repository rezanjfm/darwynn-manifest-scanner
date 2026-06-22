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
  // crypto.randomUUID() is available in modern browsers and Node 14.17+
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function ScanPage() {
  const { id: manifestId } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [carrier, setCarrier] = useState<Carrier | null>(null);
  const [allCarriers, setAllCarriers] = useState<Carrier[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [showManual, setShowManual] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"worker" | "manager">("worker");
  const [loading, setLoading] = useState(true);

  // Track tracking numbers seen this session (local + DB)
  const seenRef = useRef<Set<string>>(new Set());

  // --- Load manifest & carriers ---
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);

      const [{ data: profile }, { data: mfData }, { data: carriersData }, { data: parcelsData }] = await Promise.all([
        supabase.from("user_profiles").select("role").eq("id", user.id).single(),
        supabase.from("manifests").select("*, carrier:carriers(*)").eq("id", manifestId).single(),
        supabase.from("carriers").select("*").eq("active", true).order("name"),
        supabase.from("parcels").select("tracking_number").eq("manifest_id", manifestId),
      ]);

      if (profile) setUserRole(profile.role as "worker" | "manager");
      if (!mfData) { router.push("/manifests"); return; }
      setManifest(mfData as unknown as Manifest);
      setCarrier((mfData as unknown as { carrier: Carrier }).carrier);
      setAllCarriers(carriersData ?? []);

      // Seed seen set with DB tracking numbers
      const dbNums = new Set((parcelsData ?? []).map((p: { tracking_number: string }) => p.tracking_number));
      // Also check offline queue
      const localNums = await getLocalTrackingNumbers(manifestId);
      seenRef.current = new Set([...dbNums, ...localNums]);

      setLoading(false);
    }
    load();
  }, [manifestId, router, supabase]);

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
    // Refresh parcel count from DB
    const { data } = await supabase.from("manifests").select("parcel_count").eq("id", manifestId).single();
    if (data) setManifest((m) => m ? { ...m, parcel_count: data.parcel_count } : m);
  }, [isOnline, syncing, userId, manifestId, supabase]);

  useEffect(() => {
    if (isOnline) syncQueue();
  }, [isOnline, syncQueue]);

  // --- Handle a scan (from camera or manual entry) ---
  const handleScan = useCallback(async (rawBarcode: string, entryMethod: "scan" | "manual" = "scan") => {
    if (!manifest || !carrier || !userId) return;
    if (manifest.status === "closed" && userRole !== "manager") return;

    const tracking = extractTrackingNumber(rawBarcode);

    // Duplicate detection (local + queue)
    if (seenRef.current.has(tracking)) {
      setFeedback({ type: "duplicate", tracking });
      return;
    }

    // Carrier mismatch detection (Phase 2 extends this with real pattern matching)
    const detected = detectCarrier(tracking, allCarriers);
    if (detected && detected.id !== carrier.id) {
      setFeedback({ type: "wrong_carrier", tracking, detected: detected.name, expected: carrier.name });
      return;
    }

    // Mark as seen immediately (before async ops)
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

    // Queue locally first (works offline)
    await queueScan(scanRecord);

    // Optimistically update count
    setManifest((m) => m ? { ...m, parcel_count: m.parcel_count + 1 } : m);
    setFeedback({ type: "success", tracking, carrier: carrier.name });

    // Persist to Supabase if online
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
  const scannerActive = !isClosed && !showManual && !showClose;

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
      <div className="flex-1 relative overflow-hidden">
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
            {userRole === "manager" && (
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
