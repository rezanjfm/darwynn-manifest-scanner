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
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 animate-slide-up">
        <h2 className="text-xl font-bold mb-1">Manual Entry</h2>
        <p className="text-sm text-gray-500 mb-4">Label unreadable? Type the tracking number.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            placeholder="e.g. 1Z999AA10123456784"
            className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 font-mono text-lg focus:outline-none focus:border-blue-500"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-semibold text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
