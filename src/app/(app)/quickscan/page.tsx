"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { detectCarrier, extractTrackingNumber } from "@/lib/carriers";
import { queueScan, markScanSynced } from "@/lib/offline-queue";
import ScanFeedback, { FeedbackState } from "@/components/ScanFeedback";
import ManualEntryModal from "@/components/ManualEntryModal";
import { Carrier } from "@/types";
import { format } from "date-fns";

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

type RecentScan = {
  id: string;
  tracking: string;
  carrierName: string;
  time: string;
  method: "scan" | "manual";
};

export default function QuickScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const initDir = (searchParams.get("dir") as "outbound" | "inbound") ?? "outbound";

  const [direction, setDirection] = useState<"outbound" | "inbound">(initDir);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [activeCarrier, setActiveCarrier] = useState<Carrier | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // carrierId:direction → manifestId
  const manifestCacheRef = useRef<Map<string, string>>(new Map());
  // All tracking numbers seen this session (across all manifests)
  const seenRef = useRef<Set<string>>(new Set());

  const scannerActive = !loading && !showManual && pendingBarcode === null;

  // ── Auth + load carriers ────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      const { data } = await supabase.from("carriers").select("*").eq("active", true).order("name");
      setCarriers((data as Carrier[]) ?? []);
      setLoading(false);
    }
    init();
  }, [supabase, router]);

  // ── Online / offline ─────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Get or create manifest for a carrier+direction ──────────────────────────
  const getOrCreateManifest = useCallback(
    async (carrierId: string, dir: "outbound" | "inbound"): Promise<string | null> => {
      const key = `${carrierId}:${dir}`;
      if (manifestCacheRef.current.has(key)) return manifestCacheRef.current.get(key)!;

      const today = format(new Date(), "yyyy-MM-dd");

      const { data: existing } = await supabase
        .from("manifests")
        .select("id")
        .eq("carrier_id", carrierId)
        .eq("date", today)
        .eq("direction", dir)
        .eq("status", "open")
        .maybeSingle();

      if (existing) {
        manifestCacheRef.current.set(key, existing.id);
        // Pre-load existing tracking numbers so duplicates are caught
        const { data: parcels } = await supabase
          .from("parcels")
          .select("tracking_number")
          .eq("manifest_id", existing.id);
        parcels?.forEach((p) => seenRef.current.add(p.tracking_number));
        return existing.id;
      }

      const { data: newM } = await supabase
        .from("manifests")
        .insert({ carrier_id: carrierId, date: today, direction: dir, opened_by: userId })
        .select("id")
        .single();

      if (!newM) return null;
      manifestCacheRef.current.set(key, newM.id);
      return newM.id;
    },
    [supabase, userId]
  );

  // ── Core save ────────────────────────────────────────────────────────────────
  const saveScan = useCallback(
    async (
      rawBarcode: string,
      carrierId: string,
      carrierName: string,
      entryMethod: "scan" | "manual",
      dir: "outbound" | "inbound"
    ) => {
      if (!userId) return;
      const tracking = extractTrackingNumber(rawBarcode);

      if (seenRef.current.has(tracking)) {
        setFeedback({ type: "duplicate", tracking });
        return;
      }

      const manifestId = await getOrCreateManifest(carrierId, dir);
      if (!manifestId) return;

      seenRef.current.add(tracking);
      setSessionCount((c) => c + 1);

      const now = new Date().toISOString();
      const scanId = newId();

      setRecentScans((prev) => [
        { id: scanId, tracking, carrierName, time: now, method: entryMethod },
        ...prev.slice(0, 9),
      ]);
      setFeedback({ type: "success", tracking, carrier: carrierName });

      const record = {
        id: scanId,
        manifest_id: manifestId,
        carrier_id: carrierId,
        tracking_number: tracking,
        raw_barcode: rawBarcode,
        entry_method: entryMethod,
        scanned_by: userId,
        scanned_at: now,
        synced: false,
      };

      await queueScan(record);

      if (isOnline) {
        const { error } = await supabase.from("parcels").insert({
          id: record.id,
          manifest_id: record.manifest_id,
          carrier_id: record.carrier_id,
          tracking_number: record.tracking_number,
          raw_barcode: record.raw_barcode,
          entry_method: record.entry_method,
          scanned_by: record.scanned_by,
          scanned_at: record.scanned_at,
        });
        if (!error) await markScanSynced(scanId);
      }
    },
    [userId, getOrCreateManifest, isOnline, supabase]
  );

  // ── Handle scan ──────────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (rawBarcode: string, entryMethod: "scan" | "manual" = "scan") => {
      const tracking = extractTrackingNumber(rawBarcode);
      const detected = detectCarrier(tracking, carriers);

      if (!detected) {
        if (activeCarrier) {
          // Unknown barcode but we have context — assign to active carrier
          await saveScan(rawBarcode, activeCarrier.id, activeCarrier.name, entryMethod, direction);
        } else {
          // No context — ask worker to pick carrier
          setPendingBarcode(rawBarcode);
        }
        return;
      }

      // Auto-switch carrier if different
      if (detected.id !== activeCarrier?.id) {
        setSwitching(detected.name);
        setActiveCarrier(detected);
        setTimeout(() => setSwitching(null), 1800);
      }

      await saveScan(rawBarcode, detected.id, detected.name, entryMethod, direction);
    },
    [carriers, activeCarrier, direction, saveScan]
  );

  // ── Carrier picker (unknown barcode) ─────────────────────────────────────────
  async function assignCarrier(carrier: Carrier) {
    if (!pendingBarcode) return;
    const barcode = pendingBarcode;
    setActiveCarrier(carrier);
    setPendingBarcode(null);
    await saveScan(barcode, carrier.id, carrier.name, "scan", direction);
  }

  // ── HID keyboard wedge ───────────────────────────────────────────────────────
  const handleScanRef = useRef(handleScan);
  useEffect(() => { handleScanRef.current = handleScan; }, [handleScan]);

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
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Enter" || e.key === "Tab") { if (buf.value) { e.preventDefault(); flush(); } return; }
      if (e.key.length !== 1) return;
      buf.value += e.key;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 200);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); if (timer) clearTimeout(timer); };
  }, [scannerActive]);

  // ── Direction toggle ─────────────────────────────────────────────────────────
  function toggleDirection() {
    const next = direction === "outbound" ? "inbound" : "outbound";
    setDirection(next);
    // Flush manifest cache for the active carrier so it re-looks up for new direction
    if (activeCarrier) manifestCacheRef.current.delete(`${activeCarrier.id}:${direction}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white animate-pulse">Loading…</div>
      </div>
    );
  }

  const isInbound = direction === "inbound";

  return (
    <div className="h-screen flex flex-col bg-black overflow-hidden">

      {/* ── Top bar ── */}
      <div className={`flex-none text-white px-3 py-2 safe-top ${isInbound ? "bg-orange-900" : "bg-gray-900"}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/manifests")}
            className="text-gray-400 text-xl p-1 flex-none"
            aria-label="Back"
          >
            ←
          </button>

          <div className="flex-1 min-w-0">
            {activeCarrier ? (
              <div className="font-bold text-base leading-tight truncate">{activeCarrier.name}</div>
            ) : (
              <div className="text-gray-500 text-sm">Scan any package to start</div>
            )}
            {switching && (
              <div className="text-xs text-purple-400 animate-pulse">→ Switched to {switching}</div>
            )}
          </div>

          {/* Direction toggle */}
          <button
            onClick={toggleDirection}
            className={`text-xs font-bold px-2.5 py-1.5 rounded-lg flex-none transition-colors ${
              isInbound ? "bg-orange-600" : "bg-blue-700"
            }`}
          >
            {isInbound ? "↩ RETURN" : "↑ OUTBOUND"}
          </button>

          {/* Package count */}
          <div className="flex-none text-right">
            <span
              className={`text-3xl font-black tabular-nums leading-none ${
                isInbound ? "text-orange-300" : "text-green-400"
              }`}
            >
              {sessionCount}
            </span>
          </div>
        </div>

        {!isOnline && (
          <div className="mt-1">
            <span className="text-xs bg-yellow-600 text-yellow-100 px-1.5 py-0.5 rounded font-semibold">
              OFFLINE — scans saved locally
            </span>
          </div>
        )}
      </div>

      {/* ── Camera ── */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <BarcodeScanner onScan={(v) => handleScan(v, "scan")} active={scannerActive} />

        {/* Feedback strip */}
        {feedback && (
          <div className="absolute top-0 inset-x-0 z-30">
            <ScanFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        )}

        {/* First-scan hint */}
        {!activeCarrier && recentScans.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="bg-black/70 rounded-2xl px-8 py-6 text-center">
              <div className="text-5xl mb-3">📦</div>
              <div className="text-white font-bold text-lg">Scan any package</div>
              <div className="text-gray-400 text-sm mt-1">
                Carrier is detected automatically
              </div>
              <div className="text-gray-600 text-xs mt-3">
                {isInbound ? "↩ Receiving returns mode" : "↑ Outbound mode"}
              </div>
            </div>
          </div>
        )}

        {/* Recent scans overlay */}
        {recentScans.length > 0 && (
          <div className="absolute bottom-0 inset-x-0 z-20 bg-black/80 backdrop-blur-sm">
            {recentScans.slice(0, 4).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 first:border-0"
              >
                <span
                  className={`w-4 h-4 flex-none flex items-center justify-center text-[10px] rounded font-bold ${
                    s.method === "manual"
                      ? "bg-yellow-700 text-yellow-200"
                      : "bg-green-800 text-green-300"
                  }`}
                >
                  {s.method === "manual" ? "M" : "S"}
                </span>
                <span className="font-mono text-xs text-white flex-1 truncate">{s.tracking}</span>
                <span className="text-gray-500 text-xs flex-none">{s.carrierName}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div
        className={`flex-none px-3 py-2 safe-bottom flex gap-2 ${
          isInbound ? "bg-orange-950" : "bg-gray-900"
        }`}
      >
        <button
          onClick={() => setShowManual(true)}
          className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-semibold text-sm"
        >
          ✎ Manual
        </button>
        <button
          onClick={() => router.push("/manifests")}
          className="flex-1 bg-gray-600 text-white py-3 rounded-xl font-semibold text-sm"
        >
          Done ({sessionCount})
        </button>
      </div>

      {/* Manual entry modal */}
      {showManual && (
        <ManualEntryModal
          onSubmit={(v) => { setShowManual(false); handleScan(v, "manual"); }}
          onClose={() => setShowManual(false)}
        />
      )}

      {/* Carrier picker — shown when barcode doesn't match any pattern */}
      {pendingBarcode !== null && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end">
          <div className="bg-gray-900 w-full rounded-t-2xl p-5 space-y-4">
            <div>
              <h2 className="text-white font-bold text-lg">Which carrier is this?</h2>
              <p className="text-gray-500 text-xs font-mono mt-1 truncate">
                {extractTrackingNumber(pendingBarcode)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {carriers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => assignCarrier(c)}
                  className="bg-gray-800 hover:bg-gray-700 active:scale-95 text-white rounded-xl py-4 font-semibold text-sm transition-all"
                >
                  {c.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPendingBarcode(null)}
              className="w-full py-2.5 text-gray-500 text-sm"
            >
              Skip this package
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
