"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Manifest, Carrier } from "@/types";
import { downloadCSV, manifestToCSV } from "@/lib/csv";
import { format } from "date-fns";

export default function ManagerPage() {
  const router = useRouter();
  const supabase = createClient();

  const [manifests, setManifests] = useState<(Manifest & { carrier: Carrier })[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("manifests")
      .select("*, carrier:carriers(*)")
      .eq("date", date)
      .order("opened_at", { ascending: false });
    setManifests((data as unknown as (Manifest & { carrier: Carrier })[]) ?? []);
    setLoading(false);
  }, [supabase, date]);

  useEffect(() => { load(); }, [load]);

  async function exportManifest(m: Manifest & { carrier: Carrier }) {
    const { data } = await supabase.from("parcels").select("*").eq("manifest_id", m.id).order("scanned_at");
    const csv = manifestToCSV(m, m.carrier, data as never ?? []);
    downloadCSV(csv, `manifest-${m.carrier.code}-${m.date}.csv`);
  }

  async function exportAll() {
    const rows: string[] = [];
    for (const m of manifests) {
      const { data } = await supabase.from("parcels").select("*").eq("manifest_id", m.id).order("scanned_at");
      if (!data || data.length === 0) continue;
      const csv = manifestToCSV(m, m.carrier, data as never);
      rows.push(csv);
    }
    if (rows.length === 0) return;
    const blob = new Blob([rows.join("\n\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `darwynn-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const total = manifests.reduce((sum, m) => sum + m.parcel_count, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Manager Dashboard</h1>
            <p className="text-blue-200 text-sm">{total} parcels outbound</p>
          </div>
          <button onClick={() => router.push("/manifests")} className="bg-white/20 px-3 py-1.5 rounded-lg text-sm">
            ← Back
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Date picker + export all */}
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

        {/* Summary cards */}
        {!loading && manifests.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {manifests.map((m) => (
              <div key={m.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-bold text-sm">{m.carrier.name}</div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      m.status === "open"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {m.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-3xl font-bold text-gray-800 mb-1">{m.parcel_count}</div>
                <div className="text-xs text-gray-400 mb-3">
                  {m.opened_at ? format(new Date(m.opened_at), "h:mm a") : ""} –{" "}
                  {m.closed_at ? format(new Date(m.closed_at), "h:mm a") : "open"}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/scan/${m.id}`)}
                    className="flex-1 text-xs bg-gray-100 text-gray-700 py-1.5 rounded-lg font-semibold"
                  >
                    View
                  </button>
                  <button
                    onClick={() => exportManifest(m)}
                    className="flex-1 text-xs bg-blue-50 text-blue-700 py-1.5 rounded-lg font-semibold"
                  >
                    CSV
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
