"use client";

import { useEffect } from "react";

export type FeedbackState =
  | { type: "success";      tracking: string; carrier: string }
  | { type: "duplicate";    tracking: string }
  | { type: "wrong_carrier"; tracking: string; detected: string; expected: string }
  | { type: "error";        message: string }
  | null;

interface Props {
  feedback: FeedbackState;
  onDismiss: () => void;
}

function beep(frequency = 880, duration = 80, type: OscillatorType = "sine") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = type;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch { /* AudioContext unavailable */ }
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* unavailable */ }
}

const DISMISS_MS: Record<NonNullable<FeedbackState>["type"], number> = {
  success:       550,
  duplicate:    1800,
  wrong_carrier: 1800,
  error:         2200,
};

export default function ScanFeedback({ feedback, onDismiss }: Props) {
  useEffect(() => {
    if (!feedback) return;
    switch (feedback.type) {
      case "success":       beep(880, 55);              vibrate(50);              break;
      case "duplicate":     beep(440, 180, "square");   vibrate([80, 40, 80]);    break;
      case "wrong_carrier": beep(330, 250, "sawtooth"); vibrate([150, 50, 150]);  break;
      case "error":         beep(220, 300, "square");   vibrate([200, 50, 200]);  break;
    }
    const t = setTimeout(onDismiss, DISMISS_MS[feedback.type]);
    return () => clearTimeout(t);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  if (feedback.type === "success") {
    return (
      <div
        onClick={onDismiss}
        className="animate-slide-down flex items-center gap-3 px-4 py-3 cursor-pointer"
        style={{ background: "linear-gradient(90deg, #16a34a 0%, #15803d 100%)" }}
      >
        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-none">
          <span className="text-white font-black text-sm leading-none">✓</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-mono font-bold text-white text-sm truncate block">{feedback.tracking}</span>
        </div>
        <span className="text-white/60 text-xs flex-none">{feedback.carrier}</span>
      </div>
    );
  }

  if (feedback.type === "duplicate") {
    return (
      <div
        onClick={onDismiss}
        className="animate-slide-down flex items-center gap-3 px-4 py-3 cursor-pointer bg-yellow-500/95"
      >
        <div className="w-7 h-7 rounded-full bg-black/15 flex items-center justify-center flex-none">
          <span className="text-white font-black text-sm leading-none">!</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-sm leading-tight">Already scanned</div>
          <div className="font-mono text-white/80 text-xs truncate">{feedback.tracking}</div>
        </div>
      </div>
    );
  }

  if (feedback.type === "wrong_carrier") {
    return (
      <div
        onClick={onDismiss}
        className="animate-slide-down flex items-center gap-3 px-4 py-3.5 cursor-pointer bg-red-600/95"
      >
        <div className="w-7 h-7 rounded-full bg-black/15 flex items-center justify-center flex-none">
          <span className="text-white font-black text-sm leading-none">✗</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-sm">Wrong carrier</div>
          <div className="text-white/80 text-xs">
            Got <strong>{feedback.detected}</strong> · Expected <strong>{feedback.expected}</strong>
          </div>
        </div>
      </div>
    );
  }

  if (feedback.type === "error") {
    return (
      <div
        onClick={onDismiss}
        className="animate-slide-down flex items-center gap-3 px-4 py-3 cursor-pointer bg-gray-800/95 border-b border-white/10"
      >
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-none">
          <span className="text-gray-300 font-black text-sm leading-none">!</span>
        </div>
        <span className="text-gray-200 text-sm flex-1">{feedback.message}</span>
      </div>
    );
  }

  return null;
}
