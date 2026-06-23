"use client";

import { useEffect, useRef, useCallback } from "react";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  active: boolean;
  /** Called when camera is unavailable (no device or permission denied) */
  onCameraUnavailable?: () => void;
}

// Uses the native BarcodeDetector API (Chrome 83+) with ZXing as fallback.
// Detects barcodes AND QR codes in all common formats.
export default function BarcodeScanner({ onScan, active, onCameraUnavailable }: BarcodeScannerProps) {
  const videoRef        = useRef<HTMLVideoElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const rafRef          = useRef<number | null>(null);
  const mountedRef      = useRef(true);
  const lastResultRef   = useRef<string>("");
  const lastResultTimeRef = useRef<number>(0);

  // Keep callbacks in refs so the camera useEffect never restarts when the
  // parent re-renders (e.g. showing the duplicate/success feedback banner).
  const onScanRef               = useRef(onScan);
  const onCameraUnavailableRef  = useRef(onCameraUnavailable);
  useEffect(() => { onScanRef.current = onScan; },              [onScan]);
  useEffect(() => { onCameraUnavailableRef.current = onCameraUnavailable; }, [onCameraUnavailable]);

  const stopCamera = useCallback(() => {
    if (rafRef.current)  { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Stable — no dependency on onScan so it never causes the effect to re-run
  const handleDetected = useCallback((value: string) => {
    const now = Date.now();
    if (value === lastResultRef.current && now - lastResultTimeRef.current < 2000) return;
    lastResultRef.current = value;
    lastResultTimeRef.current = now;
    onScanRef.current(value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startNativeDetector = useCallback(async (video: HTMLVideoElement) => {
    const BD = window.BarcodeDetector!;
    const supported = await BD.getSupportedFormats();
    // Include all barcode + QR / 2D formats that the device supports
    const wanted = [
      "code_128", "code_39", "code_93", "codabar", "itf",
      "ean_13", "ean_8", "upc_a", "upc_e",
      "pdf417", "data_matrix", "aztec",
      "qr_code",    // QR codes (e.g. Obibox)
    ];
    const formats = wanted.filter((f) => supported.includes(f));
    const detector = new BD({ formats: formats.length ? formats : supported });

    const detect = async () => {
      if (!mountedRef.current || !active) return;
      try {
        if (video.readyState >= video.HAVE_ENOUGH_DATA) {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) handleDetected(barcodes[0].rawValue);
        }
      } catch { /* ignore per-frame errors */ }
      rafRef.current = requestAnimationFrame(detect);
    };
    rafRef.current = requestAnimationFrame(detect);
  }, [active, handleDetected]);

  const startZXing = useCallback(async (video: HTMLVideoElement) => {
    const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
    const { DecodeHintType } = await import("@zxing/library");
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.PDF_417,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.AZTEC,
      BarcodeFormat.QR_CODE,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);
    const stream = streamRef.current;
    if (!stream) return;
    reader.decodeFromStream(stream, video, (result) => {
      if (result && mountedRef.current && active) handleDetected(result.getText());
    });
  }, [active, handleDetected]);

  useEffect(() => {
    mountedRef.current = true;
    if (!active) { stopCamera(); return; }

    let cancelled = false;
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (typeof window !== "undefined" && window.BarcodeDetector) {
          await startNativeDetector(video);
        } else {
          await startZXing(video);
        }
      } catch {
        if (!cancelled) onCameraUnavailableRef.current?.();
      }
    }

    init();
    return () => { cancelled = true; mountedRef.current = false; stopCamera(); };
  // onCameraUnavailable intentionally omitted — accessed via ref to keep camera stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startNativeDetector, startZXing, stopCamera]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted playsInline autoPlay
      />
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ paddingBottom: "12%" }}
      >
        {/* Viewfinder — slightly taller to cover both 1D barcodes and QR codes */}
        <div className="w-10/12 max-w-xs" style={{ aspectRatio: "1 / 0.75" }}>
          <div className="relative w-full h-full">
            <div className="absolute inset-0 rounded-lg" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.50)" }} />
            {/* Corner brackets */}
            <span className="absolute -top-0.5 -left-0.5  w-7 h-7 border-t-4 border-l-4 border-brand rounded-tl" />
            <span className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-brand rounded-tr" />
            <span className="absolute -bottom-0.5 -left-0.5  w-7 h-7 border-b-4 border-l-4 border-brand rounded-bl" />
            <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-brand rounded-br" />
            {/* Scan line */}
            <div
              className="absolute inset-x-2 h-0.5 bg-brand opacity-90 rounded"
              style={{ animation: "scanLine 1.8s ease-in-out infinite" }}
            />
          </div>
        </div>
      </div>
      {/* Format hint */}
      <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
        <span className="bg-black/60 text-gray-300 text-xs px-3 py-1 rounded-full">
          Barcodes &amp; QR codes
        </span>
      </div>
      <style>{`
        @keyframes scanLine {
          0%   { top: 6px;  opacity: 0.9; }
          45%  { top: calc(100% - 10px); opacity: 0.9; }
          50%  { top: calc(100% - 10px); opacity: 0; }
          55%  { top: 6px;  opacity: 0; }
          60%  { top: 6px;  opacity: 0.9; }
          100% { top: 6px;  opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
