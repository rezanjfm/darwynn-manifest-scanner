"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user dismissed before
    if (sessionStorage.getItem("install-dismissed")) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!prompt || dismissed) return null;

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setPrompt(null);
    }
    setDismissed(true);
  }

  function dismiss() {
    sessionStorage.setItem("install-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="fixed bottom-5 left-4 right-4 z-50 max-w-sm mx-auto animate-slide-up">
      <div className="glass-md border border-white/10 text-white rounded-2xl px-4 py-3.5 shadow-brand-lg flex items-center gap-3">
        <img src="/icons/icon-96.png" alt="Darwynn" className="w-11 h-11 rounded-xl flex-none" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm leading-tight">Add to Home Screen</div>
          <div className="text-gray-500 text-xs mt-0.5">Works offline too</div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <button
            onClick={install}
            className="text-white font-bold px-3.5 py-1.5 rounded-lg text-sm transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg, #00B2D8, #0093B8)" }}
          >
            Install
          </button>
          <button
            onClick={dismiss}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-400 hover:bg-white/5 transition-colors text-base"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
