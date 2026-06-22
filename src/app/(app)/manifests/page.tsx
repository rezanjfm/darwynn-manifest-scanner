"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Manifest, Carrier } from "@/types";
import { format } from "date-fns";

export default function ManifestsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [manifests, setManifests] = useState<(Manifest & { carrier: Carrier })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [userRole, setUserRole] = useState<"worker" | "manager">("worker");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const [{ data: profile }, { data: carriersData }, { data: manifestsData }] = await Promise.all([
      supabase.from("user_profiles").select("role").eq("id", user.id).single(),
      supabase.from("carriers").select("*").eq("active", true).order("name"),
      supabase
        .from("manifests")
        .select("*, carrier:carriers(*)")
        .eq("date", format(new Date(), "yyyy-MM-dd"))
        .order("opened_at", { ascending: false }),
    ]);

    if (profile) setUserRole(profile.role as "worker" | "manager");
    setCarriers(carriersData ?? []);
    setManifests((manifestsData as unknown as (Manifest & { carrier: Carrier })[]) ?? []);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { load(); }, [load]);

  async function createManifest() {
    if (!selectedCarrierId) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("manifests")
      .insert({
        carrier_id: selectedCarrierId,
        date: format(new Date(), "yyyy-MM-dd"),
        opened_by: user?.id,
      })
      .select("*")
      .single();

    if (error) { alert(error.message); setCreating(false); return; }
    router.push(`/scan/${data.id}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading…</div>
      </div>
    );
  }

  const open = manifests.filter((m) => m.status === "open");
  const closed = manifests.filter((m) => m.status === "closed");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">📦 Darwynn Scanner</h1>
            <p className="text-blue-200 text-sm">{format(new Date(), "EEEE, MMMM d")}</p>
          </div>
          <div className="flex gap-2 items-center">
            {userRole === "manager" && (
              <button
                onClick={() => router.push("/manager")}
                className="text-sm bg-white/20 px-3 py-1.5 rounded-lg"
              >
                Dashboard
              </button>
            )}
            <button onClick={signOut} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Open manifests */}
        {open.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Open Today
            </h2>
            <div className="space-y-2">
              {open.map((m) => (
                <button
                  key={m.id}
                  onClick={() => router.push(`/scan/${m.id}`)}
                  className="w-full bg-white rounded-2xl p-4 shadow-sm border-2 border-blue-100 active:scale-95 transition-transform text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-lg">{m.carrier.name}</div>
                      <div className="text-gray-500 text-sm">
                        {m.parcel_count} parcel{m.parcel_count !== 1 ? "s" : ""} scanned
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        OPEN
                      </span>
                      <span className="text-blue-600 text-sm font-semibold">Tap to scan →</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* New manifest */}
        <section>
          {!showNew ? (
            <button
              onClick={() => setShowNew(true)}
              className="w-full bg-brand text-white rounded-2xl p-5 shadow font-bold text-lg active:scale-95 transition-transform"
            >
              + Open New Manifest
            </button>
          ) : (
            <div className="bg-white rounded-2xl p-4 shadow border-2 border-blue-100 space-y-3">
              <h3 className="font-bold text-lg">New Manifest</h3>
              <select
                value={selectedCarrierId}
                onChange={(e) => setSelectedCarrierId(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-500 bg-white"
              >
                <option value="">Select carrier…</option>
                {carriers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNew(false)}
                  className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-semibold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={createManifest}
                  disabled={!selectedCarrierId || creating}
                  className="flex-1 py-3 rounded-xl bg-brand text-white font-bold disabled:opacity-40"
                >
                  {creating ? "Opening…" : "Open & Scan"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Closed manifests */}
        {closed.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Closed Today
            </h2>
            <div className="space-y-2">
              {closed.map((m) => (
                <div key={m.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">{m.carrier.name}</div>
                      <div className="text-gray-500 text-sm">{m.parcel_count} parcels</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full">
                        CLOSED
                      </span>
                      {userRole === "manager" && (
                        <button
                          onClick={() => router.push(`/scan/${m.id}`)}
                          className="text-xs text-blue-600"
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {open.length === 0 && closed.length === 0 && !showNew && (
          <div className="text-center text-gray-400 py-12">
            <div className="text-5xl mb-3">📋</div>
            <p>No manifests today yet.</p>
            <p className="text-sm">Tap above to open one.</p>
          </div>
        )}
      </main>
    </div>
  );
}
