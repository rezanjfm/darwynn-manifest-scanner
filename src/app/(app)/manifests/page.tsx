"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Manifest, Carrier } from "@/types";
import { format } from "date-fns";

type ManifestWithCarrier = Manifest & { carrier: Carrier };

export default function ManifestsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [manifests, setManifests] = useState<ManifestWithCarrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("worker");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const [{ data: profile }, { data: manifestsData }] = await Promise.all([
      supabase.from("user_profiles").select("role").eq("id", user.id).single(),
      supabase
        .from("manifests")
        .select("*, carrier:carriers(*)")
        .eq("date", format(new Date(), "yyyy-MM-dd"))
        .order("opened_at", { ascending: false }),
    ]);

    if (profile) setUserRole(profile.role);
    setManifests((manifestsData as unknown as ManifestWithCarrier[]) ?? []);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { load(); }, [load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">Loading…</div>
      </div>
    );
  }

  const openOut   = manifests.filter((m) => m.direction === "outbound" && m.status === "open");
  const openIn    = manifests.filter((m) => m.direction === "inbound"  && m.status === "open");
  const closedOut = manifests.filter((m) => m.direction === "outbound" && m.status === "closed");
  const closedIn  = manifests.filter((m) => m.direction === "inbound"  && m.status === "closed");
  const isElevated = userRole === "manager" || userRole === "admin";

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">📦 Darwynn Scanner</h1>
            <p className="text-blue-200 text-sm">{format(new Date(), "EEEE, MMMM d")}</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            <button onClick={() => router.push("/search")} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Search
            </button>
            {isElevated && (
              <button onClick={() => router.push("/manager")} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
                Dashboard
              </button>
            )}
            {userRole === "admin" && (
              <button onClick={() => router.push("/admin")} className="text-sm bg-purple-600/80 px-3 py-1.5 rounded-lg font-semibold">
                Admin
              </button>
            )}
            <button onClick={signOut} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">

        {/* ── Primary scan actions ── */}
        <div className="space-y-2">
          <button
            onClick={() => router.push("/quickscan")}
            className="w-full bg-brand text-white rounded-2xl p-5 shadow font-bold text-xl active:scale-95 transition-transform flex items-center justify-center gap-3"
          >
            <span className="text-3xl">📷</span>
            <span>Start Scanning</span>
          </button>
          <button
            onClick={() => router.push("/quickscan?dir=inbound")}
            className="w-full bg-orange-500 text-white rounded-2xl p-4 shadow font-bold text-base active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            <span>↩</span>
            <span>Receive Returns</span>
          </button>
        </div>

        {/* ── Open manifests — tap to resume scanning ── */}
        {(openOut.length > 0 || openIn.length > 0) && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Open Now
            </h2>
            <div className="space-y-2">
              {[...openOut, ...openIn].map((m) => {
                const isIn = m.direction === "inbound";
                const elapsed = m.opened_at
                  ? Math.round((Date.now() - new Date(m.opened_at).getTime()) / 60000)
                  : 0;
                return (
                  <button
                    key={m.id}
                    onClick={() => router.push(`/scan/${m.id}`)}
                    className={`w-full rounded-2xl p-4 shadow-sm border-2 active:scale-95 transition-transform text-left ${
                      isIn ? "bg-white border-orange-100" : "bg-white border-blue-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            isIn ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                          }`}>
                            {isIn ? "↩ RETURN" : "↑ OUT"}
                          </span>
                          <span className="font-bold text-lg">{m.carrier.name}</span>
                        </div>
                        <div className="text-gray-500 text-sm mt-0.5">
                          {m.parcel_count} pkg{m.parcel_count !== 1 ? "s" : ""} ·{" "}
                          {elapsed < 60 ? `${elapsed}m ago` : `${(elapsed / 60).toFixed(0)}h ago`}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                          <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                            OPEN
                          </span>
                        </div>
                        <span className={`text-sm font-semibold ${isIn ? "text-orange-500" : "text-blue-600"}`}>
                          Resume →
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Closed today ── */}
        {(closedOut.length > 0 || closedIn.length > 0) && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Closed Today
            </h2>
            <div className="space-y-2">
              {[...closedOut, ...closedIn].map((m) => {
                const isIn = m.direction === "inbound";
                return (
                  <div
                    key={m.id}
                    className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-semibold">
                          {isIn ? "↩ RETURN" : "↑ OUT"}
                        </span>
                        <span className="font-bold">{m.carrier.name}</span>
                      </div>
                      <div className="text-gray-500 text-sm mt-0.5">
                        {m.parcel_count} pkg{m.parcel_count !== 1 ? "s" : ""}
                        {m.closed_at && ` · closed ${format(new Date(m.closed_at), "h:mm a")}`}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full">
                        CLOSED
                      </span>
                      {isElevated && (
                        <button
                          onClick={() => router.push(`/scan/${m.id}`)}
                          className={`text-xs font-semibold ${isIn ? "text-orange-500" : "text-blue-600"}`}
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {manifests.length === 0 && (
          <div className="text-center text-gray-400 py-16">
            <div className="text-5xl mb-3">📋</div>
            <p className="font-medium">No manifests yet today</p>
            <p className="text-sm mt-1">Tap Start Scanning above to begin</p>
          </div>
        )}

      </main>
    </div>
  );
}
