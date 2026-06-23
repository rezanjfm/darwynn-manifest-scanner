"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
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

function QuickScanInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const initDir   = (searchParams.get("dir")     as "outbound" | "inbound") ?? "outbound";
  const initCarrierId = searchParams.get("carrier") ?? null; // pre-set carrier (from manifest list)

  const [direction, setDirection] = useState<"outbound" | "inbound">(initDir);
  const [carriers, setCarriers]   = useState<Carrier[]>([]);
  const [userId, setUserId]       = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [isOnline, setIsOnline]   = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [activeCarrier, setActiveCarrier]   = useState<Carrier | null>(null);
  const [otherCarrier, setOtherCarrier]     = useState<Carrier | null>(null);
  const [sessionCount, setSessionCount]   = useState(0);
  const [recentScans, setRecentScans]     = useState<RecentScan[]>([]);
  const [feedback, setFeedback]           = useState<FeedbackState>(null);
  const [showManual, setShowManual]       = useState(false);
  const [switching, setSwitching]         = useState<string | null>(null);
  // "detecting" while we probe for a camera, then "camera" or "hid"
  const [inputMode, setInputMode]         = useState<"detecting" | "camera" | "hid">("detecting");

  const manifestCacheRef = useRef<Map<string, string>>(new Map());
  const seenRef          = useRef<Set<string>>(new Set());

  const scannerActive = !loading && !showManual;

  // ── Auth + load carriers ──────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);

      const { data } = await supabase
        .from("carriers")
        .select("*")
        .eq("active", true)
        .order("name");

      const list = (data as Carrier[]) ?? [];
      setCarriers(list);
      setOtherCarrier(list.find(c => c.code === "OTHER") ?? null);

      // Pre-set carrier if one was passed in the URL (e.g. from open manifest button)
      if (initCarrierId) {
        const found = list.find(c => c.id === initCarrierId);
        if (found) setActiveCarrier(found);
      }

      // Probe for a camera without requesting permission yet.
      // enumerateDevices() is permission-safe — it returns device types even without a grant.
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices() ?? [];
        const hasCamera = devices.some((d) => d.kind === "videoinput");
        setInputMode(hasCamera ? "camera" : "hid");
      } catch {
        setInputMode("hid");
      }

      setLoading(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Online / offline ──────────────────────────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ── Get or create manifest for a carrier + direction ─────────────────────────
  const getOrCreateManifest = useCallback(
    async (carrierId: string, dir: "outbound" | "inbound"): Promise<string | null> => {
      const key = `${carrierId}:${dir}`;
      if (manifestCacheRef.current.has(key)) return manifestCacheRef.current.get(key)!;

      const today = format(new Date(), "yyyy-MM-dd");

      // Reuse existing open manifest for this carrier + direction today
      const { data: existing } = await supabase
        .from("manifests")
        .select("id")
        .eq("carrier_id", carrierId)
        .eq("date",       today)
        .eq("direction",  dir)
        .eq("status",     "open")
        .maybeSingle();

      if (existing) {
        manifestCacheRef.current.set(key, existing.id);
        // Pre-load seen tracking numbers to deduplicate correctly
        const { data: parcels } = await supabase
          .from("parcels")
          .select("tracking_number")
          .eq("manifest_id", existing.id);
        parcels?.forEach(p => seenRef.current.add(p.tracking_number));
        return existing.id;
      }

      // Create a new manifest
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

  // ── Save a scan ───────────────────────────────────────────────────────────────
  const saveScan = useCallback(
    async (
      rawBarcode: string,
      carrierId:  string,
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
      setSessionCount(c => c + 1);

      const now    = new Date().toISOString();
      const scanId = newId();

      setRecentScans(prev => [
        { id: scanId, tracking, carrierName, time: now, method: entryMethod },
        ...prev.slice(0, 9),
      ]);
      setFeedback({ type: "success", tracking, carrier: carrierName });

      const record = {
        id:              scanId,
        manifest_id:     manifestId,
        carrier_id:      carrierId,
        tracking_number: tracking,
        raw_barcode:     rawBarcode,
        entry_method:    entryMethod,
        scanned_by:      userId,
        scanned_at:      now,
        synced:          false,
      };

      await queueScan(record);

      if (isOnline) {
        const { error } = await supabase.from("parcels").insert({
          id:              record.id,
          manifest_id:     record.manifest_id,
          carrier_id:      record.carrier_id,
          tracking_number: record.tracking_number,
          raw_barcode:     record.raw_barcode,
          entry_method:    record.entry_method,
          scanned_by:      record.scanned_by,
          scanned_at:      record.scanned_at,
        });
        if (!error) await markScanSynced(scanId);
      }
    },
    [userId, getOrCreateManifest, isOnline, supabase]
  );

  // ── Handle a scan ─────────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (rawBarcode: string, entryMethod: "scan" | "manual" = "scan") => {
      const tracking = extractTrackingNumber(rawBarcode);
      const detected = detectCarrier(tracking, carriers);

      if (detected) {
        // Auto-switch carrier if it changed
        if (detected.id !== activeCarrier?.id) {
          setSwitching(detected.name);
          setActiveCarrier(detected);
          setTimeout(() => setSwitching(null), 1800);
        }
        await saveScan(rawBarcode, detected.id, detected.name, entryMethod, direction);
        return;
      }

      // Carrier not detected from barcode pattern
      // Priority: active carrier (mid-run) → Other catch-all → nothing (shouldn't happen)
      const fallback = activeCarrier ?? otherCarrier;
      if (fallback) {
        await saveScan(rawBarcode, fallback.id, fallback.name, entryMethod, direction);
      }
    },
    [carriers, activeCarrier, otherCarrier, direction, saveScan]
  );

  // ── HID keyboard-wedge support ────────────────────────────────────────────────
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [scannerActive]);

  function toggleDirection() {
    const next = direction === "outbound" ? "inbound" : "outbound";
    setDirection(next);
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
            <span className={`text-3xl font-black tabular-nums leading-none ${
              isInbound ? "text-orange-300" : "text-green-400"
            }`}>
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

      {/* ── Main scanning area ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 bg-black">

        {/* Camera mode */}
        {inputMode === "camera" && (
          <BarcodeScanner
            onScan={v => handleScan(v, "scan")}
            active={scannerActive}
            onCameraUnavailable={() => setInputMode("hid")}
          />
        )}

        {/* HID / USB scanner mode — camera unavailable on this device */}
        {inputMode === "hid" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
            {/* Pulsing ring to show "live" state */}
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-full border-4 border-brand/30 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-brand/60 flex items-center justify-center animate-pulse">
                  <span className="text-3xl">📡</span>
                </div>
              </div>
            </div>
            <p className="text-white font-bold text-xl mb-1">Scanner Ready</p>
            <p className="text-gray-400 text-sm text-center">
              Aim your barcode / QR scanner at any label
            </p>
            <p className="text-gray-600 text-xs mt-3 text-center">
              {isInbound ? "↩ Receiving returns" : "↑ Outbound mode"} · USB &amp; Bluetooth scanners supported
            </p>
          </div>
        )}

        {/* Detecting — brief flash before we know the mode */}
        {inputMode === "detecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-600 text-sm animate-pulse">Initialising…</div>
          </div>
        )}

        {feedback && (
          <div className="absolute top-0 inset-x-0 z-30">
            <ScanFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        )}

        {/* Recent scans — shown in both modes */}
        {recentScans.length > 0 && (
          <div className="absolute bottom-0 inset-x-0 z-20 bg-black/85 backdrop-blur-sm">
            {recentScans.slice(0, 4).map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 first:border-0">
                <span className={`w-4 h-4 flex-none flex items-center justify-center text-[10px] rounded font-bold ${
                  s.method === "manual" ? "bg-yellow-700 text-yellow-200" : "bg-green-800 text-green-300"
                }`}>
                  {s.method === "manual" ? "M" : "S"}
                </span>
                <span className="font-mono text-xs text-white flex-1 truncate">{s.tracking}</span>
                <span className="text-gray-500 text-xs flex-none">{s.carrierName}</span>
              </div>
            ))}
          </div>
        )}

        {/* First-scan hint for camera mode when nothing scanned yet */}
        {inputMode === "camera" && !activeCarrier && recentScans.length === 0 && (
          <div className="absolute top-4 inset-x-0 flex justify-center pointer-events-none z-10">
            <div className="bg-black/70 rounded-xl px-4 py-2 text-center">
              <div className="text-white text-sm font-medium">Point at any label to start</div>
              <div className="text-gray-400 text-xs mt-0.5">Carrier detected automatically</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className={`flex-none px-3 py-2 safe-bottom flex gap-2 ${isInbound ? "bg-orange-950" : "bg-gray-900"}`}>
        <button
          onClick={() => setShowManual(true)}
          className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-semibold text-sm"
        >
          ✎ Manual entry
        </button>
        <button
          onClick={() => router.push("/manifests")}
          className="flex-1 bg-gray-600 text-white py-3 rounded-xl font-semibold text-sm"
        >
          Done ({sessionCount})
        </button>
      </div>

      {showManual && (
        <ManualEntryModal
          onSubmit={v => { setShowManual(false); handleScan(v, "manual"); }}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  );
}

// Suspense wrapper required because useSearchParams() is used inside
export default function QuickScanPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white animate-pulse">Loading…</div>
      </div>
    }>
      <QuickScanInner />
    </Suspense>
  );
}
