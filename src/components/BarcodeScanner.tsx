"use client";

import { useEffect, useRef, useCallback } from "react";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  active: boolean;
}

// Uses the native BarcodeDetector API (Chrome 83+) with ZXing as fallback.
export default function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastResultRef = useRef<string>("");
  const lastResultTimeRef = useRef<number>(0);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const handleDetected = useCallback((value: string) => {
    const now = Date.now();
    if (value === lastResultRef.current && now - lastResultTimeRef.current < 2000) return;
    lastResultRef.current = value;
    lastResultTimeRef.current = now;
    onScan(value);
  }, [onScan]);

  const startNativeDetector = useCallback(async (video: HTMLVideoElement) => {
    const BD = window.BarcodeDetector!;
    const supported = await BD.getSupportedFormats();
    const formats = ["code_128", "pdf417", "qr_code", "data_matrix", "aztec", "ean_13", "ean_8"]
      .filter((f) => supported.includes(f));
    const detector = new BD({ formats });

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
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
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
      } catch (err) {
        console.error("Camera init failed:", err);
      }
    }

    init();
    return () => { cancelled = true; mountedRef.current = false; stopCamera(); };
  }, [active, startNativeDetector, startZXing, stopCamera]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted playsInline autoPlay
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-72 h-40 border-2 border-white rounded-lg opacity-60 relative">
          <span className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl" />
          <span className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr" />
          <span className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl" />
          <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br" />
          <div className="absolute inset-x-0 top-0 h-0.5 bg-green-400 opacity-80 animate-bounce" style={{ animationDuration: "1.5s" }} />
        </div>
      </div>
    </div>
  );
}
