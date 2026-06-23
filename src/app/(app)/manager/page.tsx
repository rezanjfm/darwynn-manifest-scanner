"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";

type KpiRow = {
  user_id:        string;
  full_name:      string | null;
  email:          string | null;
  role:           string;
  manager_id:     string | null;
  outbound_scans: number;
  inbound_scans:  number;
  manual_scans:   number;
  first_scan_at:  string | null;
  last_scan_at:   string | null;
};

type AssociateScan = {
  id:              string;
  tracking_number: string;
  entry_method:    "scan" | "manual";
  scanned_at:      string;
  carrier:         { name: string; code: string };
  manifest:        { direction: string } | null;
};

export default function ManagerPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [date,        setDate]        = useState(format(new Date(), "yyyy-MM-dd"));
  const [myName,      setMyName]      = useState<string | null>(null);
  const [team,        setTeam]        = useState<KpiRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [userRole,    setUserRole]    = useState<string>("");

  const [expandedUser,   setExpandedUser]   = useState<string | null>(null);
  const [scansMap,       setScansMap]       = useState<Record<string, AssociateScan[]>>({});
  const [loadingScans,   setLoadingScans]   = useState<string | null>(null);

  // Guard: manager or admin only
  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("user_profiles").select("role, full_name").eq("id", user.id).single();
      if (!profile || !["manager", "admin"].includes(profile.role)) { router.push("/manifests"); return; }
      setUserRole(profile.role);
      setMyName(profile.full_name);
    }
    checkRole();
  }, [supabase, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setExpandedUser(null);
    setScansMap({});
    const { data, error } = await supabase.rpc("get_user_kpi", { p_date: date });
    if (!error) setTeam((data as KpiRow[]) ?? []);
    setLoading(false);
  }, [supabase, date]);

  useEffect(() => { if (userRole) load(); }, [load, userRole]);

  async function toggleAssociate(userId: string) {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (scansMap[userId]) return;
    setLoadingScans(userId);
    const dayStart = new Date(date + "T00:00:00").toISOString();
    const dayEnd   = new Date(date + "T23:59:59.999").toISOString();
    const { data } = await supabase
      .from("parcels")
      .select("id, tracking_number, entry_method, scanned_at, carrier:carriers(name,code), manifest:manifests(direction)")
      .eq("scanned_by", userId)
      .gte("scanned_at", dayStart)
      .lte("scanned_at", dayEnd)
      .order("scanned_at", { ascending: false });
    setScansMap(prev => ({ ...prev, [userId]: (data as unknown as AssociateScan[]) ?? [] }));
    setLoadingScans(null);
  }

  const totalOut = team.reduce((s, r) => s + Number(r.outbound_scans), 0);
  const totalIn  = team.reduce((s, r) => s + Number(r.inbound_scans),  0);
  const active   = team.filter(r => Number(r.outbound_scans) + Number(r.inbound_scans) > 0);
  const topTotal = Math.max(...team.map(r => Number(r.outbound_scans) + Number(r.inbound_scans)), 1);

  const isToday = date === format(new Date(), "yyyy-MM-dd");

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur border-b border-white/5 px-4 py-4 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-base leading-none">My Team</h1>
            <p className="text-xs text-blue-400 mt-0.5">{myName ?? "Manager"}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none [color-scheme:dark] w-28"
              />
              {isToday && <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full font-semibold">Live</span>}
            </div>
            {userRole === "admin" && (
              <button onClick={() => router.push("/admin")} className="text-xs bg-purple-700 hover:bg-purple-600 px-3 py-2 rounded-lg font-semibold transition-colors">Admin</button>
            )}
            <button onClick={() => router.push("/manifests")} className="text-xs bg-gray-800 border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-lg font-semibold transition-colors">← Back</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* KPI summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 text-center">
            <div className="text-3xl font-black text-emerald-400">{loading ? "…" : active.length}</div>
            <div className="text-xs text-gray-400 mt-1">Active today</div>
          </div>
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 text-center">
            <div className="text-3xl font-black text-blue-400">{loading ? "…" : totalOut}</div>
            <div className="text-xs text-gray-400 mt-1">Outbound</div>
          </div>
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 text-center">
            <div className="text-3xl font-black text-orange-400">{loading ? "…" : totalIn}</div>
            <div className="text-xs text-gray-400 mt-1">Returns</div>
          </div>
        </div>

        {/* Team list */}
        {loading ? (
          <div className="text-center py-16 text-gray-600 animate-pulse">Loading team…</div>
        ) : team.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-30">👥</div>
            <div className="text-gray-500 font-medium">No associates assigned to you yet</div>
            <div className="text-gray-600 text-sm mt-1">Ask an admin to assign associates in the Users tab</div>
          </div>
        ) : (
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800/60">
            {[...team]
              .sort((a, b) => (Number(b.outbound_scans) + Number(b.inbound_scans)) - (Number(a.outbound_scans) + Number(a.inbound_scans)))
              .map((row, idx) => {
                const total   = Number(row.outbound_scans) + Number(row.inbound_scans);
                const out     = Number(row.outbound_scans);
                const inn     = Number(row.inbound_scans);
                const manual  = Number(row.manual_scans);
                const manPct  = total > 0 ? Math.round((manual / total) * 100) : 0;
                const first   = row.first_scan_at ? new Date(row.first_scan_at) : null;
                const last    = row.last_scan_at  ? new Date(row.last_scan_at)  : null;
                const mins    = first && last ? (last.getTime() - first.getTime()) / 60000 : 0;
                const hrs     = mins > 0 ? (mins / 60).toFixed(1) : null;
                const pace    = mins > 1 ? Math.round(total / (mins / 60)) : null;
                const isActive   = total > 0;
                const isExpanded = expandedUser === row.user_id;

                return (
                  <div key={row.user_id}>
                    <button
                      onClick={() => isActive ? toggleAssociate(row.user_id) : undefined}
                      className={`w-full text-left px-5 py-4 transition-colors ${isActive ? "hover:bg-white/[0.02]" : "opacity-40"}`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Rank badge */}
                        <div className={`text-xs font-black w-5 text-right flex-none mt-1.5 ${idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-gray-700"}`}>
                          {isActive ? `#${idx + 1}` : "—"}
                        </div>

                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-gray-700/60 text-gray-300 flex items-center justify-center text-sm font-bold flex-none">
                          {(row.full_name ?? row.email ?? "?")[0].toUpperCase()}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm mb-1.5">{row.full_name ?? row.email ?? "Unknown"}</div>
                          {isActive ? (
                            <>
                              {/* Stacked bar */}
                              <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-gray-800 mb-2">
                                {out > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(out / topTotal) * 100}%` }} />}
                                {inn > 0 && <div className="bg-orange-500 h-full" style={{ width: `${(inn / topTotal) * 100}%` }} />}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                                {out > 0 && <span><span className="text-blue-400 font-semibold">{out}</span> outbound</span>}
                                {inn > 0 && <span><span className="text-orange-400 font-semibold">{inn}</span> returns</span>}
                                {manual > 0 && <span><span className="text-yellow-400 font-semibold">{manPct}%</span> manual</span>}
                                {pace  && <span><span className="text-green-400 font-semibold">{pace}</span>/hr</span>}
                                {hrs && first && <span className="text-gray-500">{format(first, "h:mma")}–{last ? format(last, "h:mma") : "now"} ({hrs}h)</span>}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-gray-600">No activity today</div>
                          )}
                        </div>

                        {/* Total + chevron */}
                        <div className="text-right flex-none flex flex-col items-end gap-1">
                          <div className={`text-2xl font-black tabular-nums ${isActive ? "text-white" : "text-gray-700"}`}>{total}</div>
                          <div className="text-xs text-gray-600">pkgs</div>
                          {isActive && <div className="text-gray-600 text-xs">{isExpanded ? "▲" : "▼"}</div>}
                        </div>
                      </div>
                    </button>

                    {/* Expanded scan list */}
                    {isExpanded && (
                      <div className="bg-gray-950/80 border-t border-gray-800/60 px-5 py-3">
                        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">
                          {row.full_name ?? row.email} · {format(new Date(date + "T12:00:00"), "MMM d")}
                        </div>
                        {loadingScans === row.user_id ? (
                          <div className="text-center py-6 text-gray-600 animate-pulse text-xs">Loading scans…</div>
                        ) : !scansMap[row.user_id]?.length ? (
                          <div className="text-center py-4 text-gray-600 text-xs">No scans found</div>
                        ) : (
                          <div className="space-y-0 max-h-64 overflow-y-auto">
                            {scansMap[row.user_id].map(s => (
                              <div key={s.id} className="flex items-center gap-3 py-2 border-b border-gray-800/40 last:border-0">
                                <span className="text-gray-500 text-xs flex-none w-14">{format(new Date(s.scanned_at), "h:mm a")}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-none ${
                                  s.manifest?.direction === "inbound" ? "bg-orange-900/60 text-orange-400" : "bg-blue-900/60 text-blue-400"
                                }`}>
                                  {s.manifest?.direction === "inbound" ? "↩" : "↑"}
                                </span>
                                <span className={`text-[10px] font-bold px-1 rounded flex-none ${
                                  s.entry_method === "manual" ? "bg-yellow-900/60 text-yellow-400" : "bg-green-900/40 text-green-500"
                                }`}>
                                  {s.entry_method === "manual" ? "M" : "S"}
                                </span>
                                <span className="font-mono text-xs text-gray-200 flex-1 truncate">{s.tracking_number}</span>
                                <span className="text-gray-500 text-xs flex-none">{s.carrier.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

      </main>
    </div>
  );
}
