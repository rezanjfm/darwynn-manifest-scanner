"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Manifest, Carrier } from "@/types";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import Logo from "@/components/Logo";

type ManifestRow = Manifest & {
  carrier: Carrier;
  opener_name: string | null;
};

type DayGroup = {
  label: string;
  date: string;
  items: ManifestRow[];
};

function groupByDate(rows: ManifestRow[]): DayGroup[] {
  const map = new Map<string, ManifestRow[]>();
  for (const r of rows) {
    const key = r.date;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => {
      const d = parseISO(date);
      const label = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEE, MMM d");
      return { label, date, items };
    });
}

export default function ManifestsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [groups, setGroups]     = useState<DayGroup[]>([]);
  const [loading, setLoading]   = useState(true);
  const [userRole, setUserRole] = useState<string>("associate");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const sevenDaysAgo = format(new Date(Date.now() - 7 * 86400_000), "yyyy-MM-dd");

    const [{ data: profile }, { data: manifestsData }, { data: profilesData }] = await Promise.all([
      supabase.from("user_profiles").select("role").eq("id", user.id).single(),
      supabase
        .from("manifests")
        .select("*, carrier:carriers(*)")
        .gte("date", sevenDaysAgo)
        .order("opened_at", { ascending: false }),
      supabase.from("user_profiles").select("id, full_name"),
    ]);

    if (profile) setUserRole(profile.role);

    const nameMap = new Map<string, string>();
    (profilesData ?? []).forEach((p: { id: string; full_name: string }) => nameMap.set(p.id, p.full_name));

    const rows: ManifestRow[] = ((manifestsData ?? []) as unknown as (Manifest & { carrier: Carrier })[]).map((m) => ({
      ...m,
      opener_name: m.opened_by ? (nameMap.get(m.opened_by) ?? null) : null,
    }));

    setGroups(groupByDate(rows));
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { load(); }, [load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const isElevated = userRole === "manager" || userRole === "admin";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-brand-surface text-white px-4 py-3 safe-top border-b border-white/10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <Logo variant="dark" height="h-8" />
            <p className="text-gray-400 text-xs mt-0.5">{format(new Date(), "EEEE, MMMM d")}</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            <button onClick={() => router.push("/search")} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Search
            </button>
            {isElevated && userRole !== "admin" && (
              <button onClick={() => router.push("/manager")} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
                Dashboard
              </button>
            )}
            {userRole === "admin" && (
              <button
                onClick={() => router.push("/admin")}
                className="text-sm bg-purple-500 hover:bg-purple-400 text-white px-4 py-1.5 rounded-lg font-bold shadow-lg shadow-purple-900/40"
              >
                ⚙ Admin Panel
              </button>
            )}
            <button onClick={signOut} className="text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">

        {/* ── Scan buttons ── */}
        <div className="space-y-2">
          <button
            onClick={() => router.push("/quickscan")}
            className="w-full bg-brand hover:bg-brand-dark text-white rounded-2xl p-5 shadow font-bold text-xl active:scale-95 transition-transform flex items-center justify-center gap-3"
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

        {/* ── History ── */}
        {groups.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-5xl mb-3">📋</div>
            <p className="font-medium">No manifests in the last 7 days</p>
            <p className="text-sm mt-1">Tap Start Scanning above to begin</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.date}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.items.map((m) => {
                  const isIn   = m.direction === "inbound";
                  const isClosed = m.status === "closed";
                  return (
                    <button
                      key={m.id}
                      onClick={() => router.push(`/scan/${m.id}`)}
                      className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left active:scale-95 transition-transform"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {/* Direction + carrier */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded flex-none ${
                              isIn ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                            }`}>
                              {isIn ? "↩ RETURN" : "↑ OUT"}
                            </span>
                            <span className="font-bold text-base truncate">{m.carrier.name}</span>
                          </div>
                          {/* Count + time */}
                          <div className="text-gray-500 text-sm mt-1">
                            <span className="font-semibold text-gray-800">{m.parcel_count}</span>
                            {" "}pkg{m.parcel_count !== 1 ? "s" : ""}
                            {m.opened_at && (
                              <> · {format(parseISO(m.opened_at), "h:mm a")}</>
                            )}
                            {isClosed && m.closed_at && (
                              <> → {format(parseISO(m.closed_at), "h:mm a")}</>
                            )}
                          </div>
                          {/* User */}
                          {m.opener_name && (
                            <div className="text-gray-400 text-xs mt-0.5 truncate">
                              {m.opener_name}
                            </div>
                          )}
                        </div>
                        <div className="flex-none flex flex-col items-end gap-1">
                          {isClosed ? (
                            <span className="bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full">
                              CLOSED
                            </span>
                          ) : (
                            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                              OPEN
                            </span>
                          )}
                          <span className="text-gray-400 text-xs">View →</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}

      </main>
    </div>
  );
}
