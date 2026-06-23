"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

const STAFF_DOMAIN = "@staff.darwynn.local";

type Mode = "associate" | "staff";

export default function LoginPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("associate");

  // Associate fields
  const [username, setUsername] = useState("");
  const [pin,      setPin]      = useState("");

  // Staff fields
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleAssociateLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const generatedEmail = `${username.trim().toLowerCase()}${STAFF_DOMAIN}`;
    const { error } = await supabase.auth.signInWithPassword({ email: generatedEmail, password: pin });
    if (error) {
      setError("Username or PIN is incorrect.");
      setLoading(false);
      return;
    }
    router.push("/manifests");
    router.refresh();
  }

  async function handleStaffLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push("/manifests");
    router.refresh();
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setUsername(""); setPin("");
    setEmail(""); setPassword("");
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-5 relative overflow-hidden">

      {/* Background glow blobs */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-brand/4 blur-[100px]" />
      </div>

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }}
        aria-hidden
      />

      <div className="relative w-full max-w-sm animate-fade-in">

        {/* Logo */}
        <div className="text-center mb-8">
          <Logo variant="dark" height="h-12" className="mx-auto mb-4" />
          <p className="text-gray-500 text-sm tracking-wide">Warehouse Scanner</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl bg-white/5 border border-white/8 p-1 mb-5">
          {(["associate", "staff"] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === m
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {m === "associate" ? "Associate" : "Manager / Admin"}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="glass-md rounded-3xl p-8 shadow-brand">

          {/* ── Associate login ── */}
          {mode === "associate" && (
            <form onSubmit={handleAssociateLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  placeholder="johndoe"
                  className="w-full bg-white/5 border border-white/8 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand/60 focus:bg-white/8 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                  PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••"
                  className="w-full bg-white/5 border border-white/8 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand/60 focus:bg-white/8 transition-all tracking-widest"
                />
              </div>

              {error && <ErrorBanner message={error} />}

              <SubmitButton loading={loading} label="Sign In" />
            </form>
          )}

          {/* ── Manager / Admin login ── */}
          {mode === "staff" && (
            <form onSubmit={handleStaffLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@darwynn.com"
                  className="w-full bg-white/5 border border-white/8 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand/60 focus:bg-white/8 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full bg-white/5 border border-white/8 text-white placeholder-gray-600 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:border-brand/60 focus:bg-white/8 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs px-1 py-1 transition-colors"
                    tabIndex={-1}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error && <ErrorBanner message={error} />}

              <SubmitButton loading={loading} label="Sign In" />
            </form>
          )}
        </div>

        <p className="text-center text-gray-700 text-xs mt-8">
          © Darwynn — e-commerce evolutionism
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
      <span className="flex-none text-base">⚠</span>
      <span>{message}</span>
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full mt-1 py-3.5 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-50 active:scale-[0.98] relative overflow-hidden animate-glow-idle"
      style={{ background: "linear-gradient(135deg, #00B2D8 0%, #0093B8 100%)" }}
    >
      <span className={loading ? "opacity-0" : ""}>{label}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </span>
      )}
    </button>
  );
}
