"use client";

import { useEffect } from "react";

export type FeedbackState =
  | { type: "success"; tracking: string; carrier: string }
  | { type: "duplicate"; tracking: string }
  | { type: "wrong_carrier"; tracking: string; detected: string; expected: string }
  | { type: "error"; message: string }
  | null;

interface Props {
  feedback: FeedbackState;
  onDismiss: () => void;
}

// Plays a short audio beep using the Web Audio API — no audio file needed.
function beep(frequency = 880, duration = 80, type: OscillatorType = "sine") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = type;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch { /* AudioContext not available */ }
}

export default function ScanFeedback({ feedback, onDismiss }: Props) {
  useEffect(() => {
    if (!feedback) return;
    if (feedback.type === "success") beep(880, 80);
    if (feedback.type === "duplicate") beep(440, 200, "square");
    if (feedback.type === "wrong_carrier") beep(330, 300, "sawtooth");
    if (feedback.type === "error") beep(220, 400, "square");

    const timer = setTimeout(onDismiss, feedback.type === "success" ? 2000 : 4000);
    return () => clearTimeout(timer);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  const base = "fixed inset-x-0 bottom-0 z-50 p-6 animate-slide-up";

  if (feedback.type === "success") {
    return (
      <div className={`${base} bg-green-600 text-white`} onClick={onDismiss}>
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <span className="text-4xl">✓</span>
          <div>
            <div className="text-xl font-bold">Scanned</div>
            <div className="font-mono text-sm opacity-90">{feedback.tracking}</div>
            <div className="text-sm opacity-75">{feedback.carrier}</div>
          </div>
        </div>
      </div>
    );
  }

  if (feedback.type === "duplicate") {
    return (
      <div className={`${base} bg-yellow-500 text-white`} onClick={onDismiss}>
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <span className="text-4xl">⚠</span>
          <div>
            <div className="text-xl font-bold">Already Scanned</div>
            <div className="font-mono text-sm opacity-90">{feedback.tracking}</div>
            <div className="text-sm opacity-75">Not added again</div>
          </div>
        </div>
      </div>
    );
  }

  if (feedback.type === "wrong_carrier") {
    return (
      <div className={`${base} bg-red-600 text-white`} onClick={onDismiss}>
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <span className="text-4xl">✗</span>
          <div>
            <div className="text-xl font-bold">Wrong Carrier!</div>
            <div className="font-mono text-sm opacity-90">{feedback.tracking}</div>
            <div className="text-sm">
              Detected: <strong>{feedback.detected}</strong> — Manifest: <strong>{feedback.expected}</strong>
            </div>
            <div className="text-xs opacity-75 mt-1">Tap to dismiss — parcel NOT logged</div>
          </div>
        </div>
      </div>
    );
  }

  if (feedback.type === "error") {
    return (
      <div className={`${base} bg-gray-800 text-white`} onClick={onDismiss}>
        <div className="max-w-lg mx-auto">
          <div className="text-lg font-bold">Error</div>
          <div className="text-sm opacity-90">{feedback.message}</div>
        </div>
      </div>
    );
  }

  return null;
}
