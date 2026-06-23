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

type DayGroup = { label: string; date: string; items: ManifestRow[] };

function groupByDate(rows: ManifestRow[]): DayGroup[] {
  const map = new Map<string, ManifestRow[]>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
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
  const router   = useRouter();
  const supabase = createClient();

  const [groups,    setGroups]    = useState<DayGroup[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [userRole,  setUserRole]  = useState<string>("associate");
  const [todayStats, setTodayStats] = useState({ total: 0, out: 0, returns: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const sevenAgo = format(new Date(Date.now() - 7 * 86400_000), "yyyy-MM-dd");

    const [{ data: profile }, { data: mData }, { data: pData }] = await Promise.all([
      supabase.from("user_profiles").select("role").eq("id", user.id).single(),
      supabase.from("manifests").select("*, carrier:carriers(*)").gte("date", sevenAgo).order("opened_at", { ascending: false }),
      supabase.from("user_profiles").select("id, full_name"),
    ]);

    if (profile) setUserRole(profile.role);

    const nameMap = new Map<string, string>();
    (pData ?? []).forEach((p: { id: string; full_name: string }) => nameMap.set(p.id, p.full_name));

    const rows: ManifestRow[] = ((mData ?? []) as unknown as (Manifest & { carrier: Carrier })[]).map(m => ({
      ...m,
      opener_name: m.opened_by ? (nameMap.get(m.opened_by) ?? null) : null,
    }));

    const today = format(new Date(), "yyyy-MM-dd");
    const todayRows = rows.filter(r => r.date === today);
    setTodayStats({
      total:   todayRows.reduce((s, m) => s + m.parcel_count, 0),
      out:     todayRows.filter(m => m.direction === "outbound").reduce((s, m) => s + m.parcel_count, 0),
      returns: todayRows.filter(m => m.direction === "inbound").reduce((s, m) => s + m.parcel_count, 0),
    });

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
          <span className="text-gray-600 text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-brand/5 blur-[100px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-5 pb-4 safe-top">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo variant="dark" height="h-8" />
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/search")}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm"
              aria-label="Search"
            >
              ⌕
            </button>
            {isElevated && userRole !== "admin" && (
              <button
                onClick={() => router.push("/manager")}
                className="h-9 rounded-xl bg-white/5 border border-white/8 px-3 text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-all font-semibold"
              >
                Dashboard
              </button>
            )}
            {userRole === "admin" && (
              <button
                onClick={() => router.push("/admin")}
                className="h-9 rounded-xl bg-purple-500/15 border border-purple-500/25 px-3 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/20 transition-all font-bold"
              >
                ⚙ Admin
              </button>
            )}
            <button
              onClick={signOut}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all text-xs font-bold"
              aria-label="Sign out"
            >
              ↩
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-lg mx-auto px-4 pb-12 space-y-5">

        {/* Date */}
        <div className="text-gray-500 text-sm font-medium px-1">
          {format(new Date(), "EEEE, MMMM d")}
        </div>

        {/* Today's stats — only when there's data */}
        {todayStats.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Total", value: todayStats.total,   color: "text-white" },
              { label: "Outbound", value: todayStats.out,     color: "text-brand" },
              { label: "Returns",  value: todayStats.returns, color: "text-orange-400" },
            ].map(s => (
              <div key={s.label} className="glass rounded-2xl p-3 text-center">
                <div className={`text-2xl font-black tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-gray-500 text-xs mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Primary scan button ── */}
        <div className="relative">
          {/* Animated pulse rings */}
          <div className="absolute inset-0 rounded-2xl bg-brand animate-ring-1 pointer-events-none" />
          <div className="absolute inset-0 rounded-2xl bg-brand animate-ring-2 pointer-events-none" />
          <button
            onClick={() => router.push("/quickscan")}
            className="relative w-full rounded-2xl p-6 font-bold text-white transition-transform active:scale-[0.98] flex items-center justify-center gap-4 animate-glow-idle"
            style={{ background: "linear-gradient(135deg, #00B2D8 0%, #0093B8 100%)" }}
          >
            <span className="text-4xl leading-none">📷</span>
            <div className="text-left">
              <div className="text-xl font-black tracking-tight">Start Scanning</div>
              <div className="text-brand-light/70 text-xs mt-0.5">Carrier auto-detected</div>
            </div>
          </button>
        </div>

        {/* Returns button */}
        <button
          onClick={() => router.push("/quickscan?dir=inbound")}
          className="w-full rounded-2xl p-4 font-bold text-white transition-transform active:scale-[0.98] flex items-center justify-center gap-3 border border-orange-500/20 bg-orange-500/10 hover:bg-orange-500/15"
        >
          <span className="text-2xl leading-none">↩</span>
          <span className="text-base">Receive Returns</span>
        </button>

        {/* ── History ── */}
        {groups.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-20">📋</div>
            <p className="text-gray-500 font-medium">No manifests yet</p>
            <p className="text-gray-600 text-sm mt-1">Tap Start Scanning to begin</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map(group => (
              <section key={group.date}>
                <div className="flex items-center gap-3 mb-2 px-1">
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{group.label}</h2>
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-xs text-gray-600">{group.items.reduce((s, m) => s + m.parcel_count, 0)} pkgs</span>
                </div>
                <div className="space-y-2">
                  {group.items.map(m => {
                    const isIn     = m.direction === "inbound";
                    const isClosed = m.status === "closed";
                    return (
                      <button
                        key={m.id}
                        onClick={() => router.push(`/scan/${m.id}`)}
                        className="w-full glass rounded-2xl p-4 text-left transition-all active:scale-[0.98] hover:bg-white/[0.05] group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {/* Direction + carrier */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded flex-none ${
                                isIn ? "bg-orange-500/15 text-orange-400" : "bg-brand/15 text-brand"
                              }`}>
                                {isIn ? "↩ RETURN" : "↑ OUT"}
                              </span>
                              <span className="font-bold text-sm text-white truncate">{m.carrier.name}</span>
                            </div>
                            {/* Meta row */}
                            <div className="text-gray-500 text-xs">
                              {m.opened_at && format(parseISO(m.opened_at), "h:mm a")}
                              {isClosed && m.closed_at && <> → {format(parseISO(m.closed_at), "h:mm a")}</>}
                              {m.opener_name && <span className="text-gray-600"> · {m.opener_name}</span>}
                            </div>
                          </div>
                          <div className="flex-none flex flex-col items-end gap-1.5">
                            <div className={`text-2xl font-black tabular-nums leading-none ${isIn ? "text-orange-400" : "text-brand"}`}>
                              {m.parcel_count}
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isClosed
                                ? "bg-gray-700/60 text-gray-400"
                                : "bg-green-500/15 text-green-400 flex items-center gap-1"
                            }`}>
                              {!isClosed && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />}
                              {isClosed ? "CLOSED" : "OPEN"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

      </main>
    </div>
  );
}
