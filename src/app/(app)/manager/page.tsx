"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Manifest, Carrier } from "@/types";
import { downloadCSV, manifestToCSV } from "@/lib/csv";
import { Parcel } from "@/types";
import { format } from "date-fns";

type ManifestWithCarrier = Manifest & { carrier: Carrier };

export default function ManagerPage() {
  const router = useRouter();
  const supabase = createClient();

  const [manifests, setManifests] = useState<ManifestWithCarrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [userRole, setUserRole] = useState<string>("");

  // Guard: manager or admin only
  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).single();
      if (!profile || !["manager", "admin"].includes(profile.role)) {
        router.push("/manifests");
        return;
      }
      setUserRole(profile.role);
    }
    checkRole();
  }, [supabase, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("manifests")
      .select("*, carrier:carriers(*)")
      .eq("date", date)
      .order("opened_at", { ascending: false });
    setManifests((data as unknown as ManifestWithCarrier[]) ?? []);
    setLoading(false);
  }, [supabase, date]);

  useEffect(() => { if (userRole) load(); }, [load, userRole]);

  async function exportManifest(m: ManifestWithCarrier) {
    const { data } = await supabase.from("parcels").select("*").eq("manifest_id", m.id).order("scanned_at");
    const csv = manifestToCSV(m, m.carrier, (data as unknown as Parcel[]) ?? []);
    downloadCSV(csv, `manifest-${m.carrier.code}-${m.date}-${m.direction}.csv`);
  }

  async function exportAll() {
    const rows: string[] = [];
    for (const m of manifests) {
      const { data } = await supabase.from("parcels").select("*").eq("manifest_id", m.id).order("scanned_at");
      if (!data || data.length === 0) continue;
      rows.push(manifestToCSV(m, m.carrier, data as unknown as Parcel[]));
    }
    if (rows.length === 0) return;
    const blob = new Blob([rows.join("\n\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `darwynn-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const outbound = manifests.filter((m) => m.direction === "outbound");
  const inbound  = manifests.filter((m) => m.direction === "inbound");
  const totalOut = outbound.reduce((s, m) => s + m.parcel_count, 0);
  const totalIn  = inbound.reduce((s, m) => s + m.parcel_count, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Manager Dashboard</h1>
            <p className="text-blue-200 text-sm">
              {totalOut} outbound · {totalIn} returns
            </p>
          </div>
          <div className="flex gap-2">
            {userRole === "admin" && (
              <button onClick={() => router.push("/admin")} className="bg-purple-600/80 px-3 py-1.5 rounded-lg text-sm font-semibold">
                Admin
              </button>
            )}
            <button onClick={() => router.push("/manifests")} className="bg-white/20 px-3 py-1.5 rounded-lg text-sm">
              ← Back
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Date + export all */}
        <div className="flex gap-3 items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={exportAll}
            disabled={manifests.length === 0}
            className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
          >
            Export All CSV
          </button>
        </div>

        {loading && <div className="text-center text-gray-400 py-8">Loading…</div>}
        {!loading && manifests.length === 0 && (
          <div className="text-center text-gray-400 py-12">No manifests for {date}</div>
        )}

        {/* Outbound cards */}
        {!loading && outbound.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Outbound</h2>
            <div className="grid grid-cols-2 gap-3">
              {outbound.map((m) => <ManifestCard key={m.id} m={m} onView={() => router.push(`/scan/${m.id}`)} onExport={() => exportManifest(m)} />)}
            </div>
          </section>
        )}

        {/* Inbound / Returns cards */}
        {!loading && inbound.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-2">Inbound Returns</h2>
            <div className="grid grid-cols-2 gap-3">
              {inbound.map((m) => <ManifestCard key={m.id} m={m} onView={() => router.push(`/scan/${m.id}`)} onExport={() => exportManifest(m)} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ManifestCard({
  m,
  onView,
  onExport,
}: {
  m: ManifestWithCarrier;
  onView: () => void;
  onExport: () => void;
}) {
  const isInbound = m.direction === "inbound";
  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm border ${isInbound ? "border-orange-100" : "border-gray-100"}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="font-bold text-sm truncate flex-1">{m.carrier.name}</div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-none ml-1 ${
            m.status === "open"
              ? isInbound ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {m.status === "open" ? (isInbound ? "RECEIVING" : "OPEN") : "CLOSED"}
        </span>
      </div>
      <div className={`text-3xl font-bold mb-1 ${isInbound ? "text-orange-600" : "text-gray-800"}`}>
        {m.parcel_count}
      </div>
      <div className="text-xs text-gray-400 mb-3">
        {m.opened_at ? format(new Date(m.opened_at), "h:mm a") : ""}
        {" – "}
        {m.closed_at ? format(new Date(m.closed_at), "h:mm a") : "open"}
      </div>
      <div className="flex gap-2">
        <button onClick={onView} className="flex-1 text-xs bg-gray-100 text-gray-700 py-1.5 rounded-lg font-semibold">
          View
        </button>
        <button onClick={onExport} className={`flex-1 text-xs py-1.5 rounded-lg font-semibold ${isInbound ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"}`}>
          CSV
        </button>
      </div>
    </div>
  );
}
