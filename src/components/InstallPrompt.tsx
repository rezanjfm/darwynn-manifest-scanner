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
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="bg-gray-900 border border-gray-700 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-3">
        <img src="/icons/icon-96.png" alt="Darwynn" className="w-12 h-12 rounded-xl flex-none" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm leading-tight">Add Darwynn to Home Screen</div>
          <div className="text-gray-400 text-xs mt-0.5">One tap away — works offline too</div>
        </div>
        <div className="flex gap-2 flex-none">
          <button
            onClick={install}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            Install
          </button>
          <button
            onClick={dismiss}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1 transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
