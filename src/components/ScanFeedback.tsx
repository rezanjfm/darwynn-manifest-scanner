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
  } catch { /* AudioContext unavailable */ }
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* vibration unavailable */ }
}

// Dismiss times tuned for high-throughput scanning:
// success at 600 ms — brief flash, worker already grabbing next package
// errors at 1 500 ms — long enough to read, short enough not to block
const DISMISS_MS: Record<NonNullable<FeedbackState>["type"], number> = {
  success:       600,
  duplicate:    1500,
  wrong_carrier: 1500,
  error:         2000,
};

// This component handles timing, sound, and haptics only.
// It renders a plain <div> — the caller decides where to place it
// (typically absolute top-0 inset-x-0 inside the camera area).
export default function ScanFeedback({ feedback, onDismiss }: Props) {
  useEffect(() => {
    if (!feedback) return;

    switch (feedback.type) {
      case "success":
        beep(880, 60);
        vibrate(60);
        break;
      case "duplicate":
        beep(440, 180, "square");
        vibrate([80, 40, 80]);
        break;
      case "wrong_carrier":
        beep(330, 250, "sawtooth");
        vibrate([150, 50, 150]);
        break;
      case "error":
        beep(220, 300, "square");
        vibrate([200, 50, 200]);
        break;
    }

    const t = setTimeout(onDismiss, DISMISS_MS[feedback.type]);
    return () => clearTimeout(t);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  if (feedback.type === "success") {
    return (
      <div
        className="bg-green-600/95 text-white px-4 py-2 flex items-center gap-3 cursor-pointer"
        onClick={onDismiss}
      >
        <span className="text-xl font-bold leading-none">✓</span>
        <span className="font-mono text-sm font-bold flex-1 truncate">{feedback.tracking}</span>
        <span className="text-xs opacity-75 flex-none">{feedback.carrier}</span>
      </div>
    );
  }

  if (feedback.type === "duplicate") {
    return (
      <div
        className="bg-yellow-500/95 text-white px-4 py-2 flex items-center gap-3 cursor-pointer"
        onClick={onDismiss}
      >
        <span className="text-xl font-bold leading-none">⚠</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Already scanned</div>
          <div className="font-mono text-xs opacity-90 truncate">{feedback.tracking}</div>
        </div>
      </div>
    );
  }

  if (feedback.type === "wrong_carrier") {
    return (
      <div
        className="bg-red-600/95 text-white px-4 py-3 flex items-center gap-3 cursor-pointer"
        onClick={onDismiss}
      >
        <span className="text-xl font-bold leading-none">✗</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Wrong carrier — not logged</div>
          <div className="text-xs opacity-90">
            Got <strong>{feedback.detected}</strong> · Expected <strong>{feedback.expected}</strong>
          </div>
          <div className="font-mono text-xs opacity-75 truncate">{feedback.tracking}</div>
        </div>
      </div>
    );
  }

  if (feedback.type === "error") {
    return (
      <div
        className="bg-gray-800/95 text-white px-4 py-2 flex items-center gap-3 cursor-pointer"
        onClick={onDismiss}
      >
        <span className="text-xl font-bold leading-none">!</span>
        <span className="text-sm flex-1">{feedback.message}</span>
      </div>
    );
  }

  return null;
}
