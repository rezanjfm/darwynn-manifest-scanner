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

  // ── Create manifest for a carrier + direction (one per session, cached) ──────
  // Each quickscan session = fresh manifests. We never reuse one from a prior session
  // so every truck handoff is a distinct record (per carrier · date · time · user).
  const createManifest = useCallback(
    async (carrierId: string, dir: "outbound" | "inbound"): Promise<string | null> => {
      const key = `${carrierId}:${dir}`;
      // Already created in this session — reuse within the session
      if (manifestCacheRef.current.has(key)) return manifestCacheRef.current.get(key)!;

      const today = format(new Date(), "yyyy-MM-dd");
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

      const manifestId = await createManifest(carrierId, dir);
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
      };

      if (isOnline) {
        // Direct write — no intermediate queue
        await supabase.from("parcels").insert(record);
      } else {
        // Offline — queue to IndexedDB, sync when back online
        await queueScan({ ...record, synced: false });
      }
    },
    [userId, createManifest, isOnline, supabase]
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

      // Carrier not detected — always go to Other/Unknown, never assume active carrier.
      // Falling back to the active carrier caused misattribution when packages from
      // a different carrier were mixed in.
      if (otherCarrier) {
        await saveScan(rawBarcode, otherCarrier.id, otherCarrier.name, entryMethod, direction);
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

  const prevCountRef = useRef(sessionCount);
  const [countBump,  setCountBump]  = useState(false);

  useEffect(() => {
    if (sessionCount > prevCountRef.current) {
      setCountBump(true);
      const t = setTimeout(() => setCountBump(false), 400);
      prevCountRef.current = sessionCount;
      return () => clearTimeout(t);
    }
    prevCountRef.current = sessionCount;
  }, [sessionCount]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  const isInbound = direction === "inbound";

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">

      {/* ── Top bar ── */}
      <div className={`flex-none text-white px-4 py-3 safe-top border-b ${
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

          <div className="flex-1 min-w-0">
            {activeCarrier ? (
              <div className="font-bold text-sm leading-tight truncate text-white">{activeCarrier.name}</div>
            ) : (
              <div className="text-gray-600 text-xs">Scan any package to start</div>
            )}
            {switching && (
              <div className="text-[11px] text-brand animate-pulse mt-0.5">→ {switching}</div>
            )}
          </div>

          {/* Direction toggle */}
          <button
            onClick={toggleDirection}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg flex-none transition-all active:scale-95 ${
              isInbound
                ? "bg-orange-500/20 border border-orange-500/30 text-orange-400"
                : "bg-white/8 border border-white/10 text-gray-300"
            }`}
          >
            {isInbound ? "↩ RETURN" : "↑ OUT"}
          </button>

          {/* Count — the hero number */}
          <div className={`flex-none tabular-nums font-black leading-none transition-all ${
            countBump ? "animate-count-bump" : ""
          } ${isInbound ? "text-orange-400" : "text-brand"}`}
            style={{ fontSize: "2.5rem" }}
          >
            {sessionCount}
          </div>
        </div>

        {!isOnline && (
          <div className="mt-2">
            <span className="text-[11px] bg-yellow-500/15 border border-yellow-500/20 text-yellow-400 px-2 py-1 rounded-lg font-semibold">
              ⚡ OFFLINE — saved locally
            </span>
          </div>
        )}
      </div>

      {/* ── Main scanning area ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 bg-black">

        {inputMode === "camera" && (
          <BarcodeScanner
            onScan={v => handleScan(v, "scan")}
            active={scannerActive}
            onCameraUnavailable={() => setInputMode("hid")}
          />
        )}

        {/* HID / USB scanner mode */}
        {inputMode === "hid" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-10">
            {/* Triple animated rings */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-32 h-32 rounded-full border border-brand/20 animate-ring-1" />
              <div className="absolute w-32 h-32 rounded-full border border-brand/20 animate-ring-2" />
              <div className="w-20 h-20 rounded-full border-2 border-brand/40 flex items-center justify-center animate-hid-ring">
                <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center">
                  <span className="text-2xl">📡</span>
                </div>
              </div>
            </div>
            <div className="text-center">
              <p className="text-white font-bold text-lg mb-1">Scanner Ready</p>
              <p className="text-gray-500 text-sm">Aim your USB or Bluetooth scanner at any label</p>
              <div className="mt-3 inline-flex items-center gap-2 bg-white/5 border border-white/8 rounded-full px-4 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                <span className="text-gray-400 text-xs">{isInbound ? "Receiving returns" : "Outbound mode"}</span>
              </div>
            </div>
          </div>
        )}

        {inputMode === "detecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
          </div>
        )}

        {feedback && (
          <div className="absolute top-0 inset-x-0 z-30">
            <ScanFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          </div>
        )}

        {/* Recent scans live feed */}
        {recentScans.length > 0 && (
          <div className="absolute bottom-0 inset-x-0 z-20">
            <div className="bg-black/80 backdrop-blur-sm border-t border-white/5">
              {recentScans.slice(0, 4).map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-white/5" : ""} ${i === 0 ? "bg-white/[0.03]" : ""}`}
                >
                  <span className={`w-5 h-5 flex-none flex items-center justify-center text-[10px] rounded-md font-black ${
                    s.method === "manual" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"
                  }`}>
                    {s.method === "manual" ? "M" : "S"}
                  </span>
                  <span className="font-mono text-xs text-white flex-1 truncate">{s.tracking}</span>
                  <span className="text-gray-600 text-xs flex-none">{s.carrierName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* First-scan hint */}
        {inputMode === "camera" && !activeCarrier && recentScans.length === 0 && (
          <div className="absolute top-5 inset-x-0 flex justify-center pointer-events-none z-10">
            <div className="glass rounded-2xl px-5 py-3 text-center">
              <div className="text-white text-sm font-semibold">Point at any label to start</div>
              <div className="text-gray-500 text-xs mt-0.5">Carrier detected automatically</div>
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
          onClick={() => router.push("/manifests")}
          className="flex-1 py-3 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.97]"
          style={{ background: isInbound ? "linear-gradient(135deg,#c2410c,#9a3412)" : "linear-gradient(135deg,#1d4ed8,#1e40af)" }}
        >
          Done · {sessionCount}
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
