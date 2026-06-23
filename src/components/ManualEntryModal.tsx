"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  onSubmit: (tracking: string) => void;
  onClose: () => void;
}

export default function ManualEntryModal({ onSubmit, onClose }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" />

      {/* Sheet */}
      <div className="relative w-full max-w-lg animate-slide-up" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="bg-gray-900 border border-white/8 rounded-t-3xl p-6">

          {/* Drag handle */}
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />

          <h2 className="text-lg font-bold text-white mb-1">Manual Entry</h2>
          <p className="text-gray-500 text-sm mb-5">Label unreadable? Type the tracking number.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value.toUpperCase())}
              placeholder="e.g. 1Z999AA10123456784"
              className="w-full bg-white/5 border border-white/10 text-white placeholder-gray-600 rounded-xl px-4 py-3.5 font-mono text-base focus:outline-none focus:border-brand/50 focus:bg-white/8 transition-all"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3.5 rounded-xl border border-white/10 text-gray-400 font-semibold text-sm hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!value.trim()}
                className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white disabled:opacity-30 transition-all active:scale-[0.98]"
                style={{ background: value.trim() ? "linear-gradient(135deg, #00B2D8, #0093B8)" : undefined, backgroundColor: value.trim() ? undefined : "#374151" }}
              >
                Add Package
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
