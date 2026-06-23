"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UserProfile, Manifest, Carrier } from "@/types";
import { format } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

type KpiRow = {
  user_id:       string;
  full_name:     string | null;
  email:         string | null;
  role:          string;
  manager_id:    string | null;
  outbound_scans: number;
  inbound_scans:  number;
  manual_scans:   number;
  first_scan_at:  string | null;
  last_scan_at:   string | null;
};

type ManifestWithCarrier = Manifest & { carrier: Carrier };

type ParcelBrief = {
  id: string;
  scanned_at: string;
  entry_method: "scan" | "manual";
  carrier_id: string;
};

type AssociateScan = {
  id:              string;
  tracking_number: string;
  entry_method:    "scan" | "manual";
  scanned_at:      string;
  carrier:         { name: string; code: string };
  manifest:        { direction: string } | null;
};

type CarrierStat = {
  id: string; name: string; code: string;
  outbound: number; inbound: number; manifests: number; openManifests: number;
};

const TABS = ["dashboard", "associates", "carriers", "users"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  dashboard:  "Dashboard",
  associates: "Associates",
  carriers:   "Carriers",
  users:      "Users",
};

const ROLE_CHIP: Record<string, string> = {
  associate: "bg-gray-700/60 text-gray-300",
  manager:   "bg-blue-900/60  text-blue-300",
  admin:     "bg-purple-900/60 text-purple-300",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [tab,    setTab]    = useState<Tab>("dashboard");
  const [date,   setDate]   = useState(format(new Date(), "yyyy-MM-dd"));
  const [authed, setAuthed] = useState(false);

  // Users
  const [users,      setUsers]      = useState<UserProfile[]>([]);
  const [roleEdits,  setRoleEdits]  = useState<Record<string, string>>({});
  const [mgEdits,    setMgEdits]    = useState<Record<string, string | null>>({});
  const [saving,     setSaving]     = useState<string | null>(null);
  const [saveError,  setSaveError]  = useState<string | null>(null);

  // Invite form
  const [inviteEmail,   setInviteEmail]   = useState("");
  const [inviteName,    setInviteName]    = useState("");
  const [inviteRole,    setInviteRole]    = useState("associate");
  const [inviting,      setInviting]      = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError,   setInviteError]   = useState<string | null>(null);

  // KPI / dashboard
  const [kpi,        setKpi]        = useState<KpiRow[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [manifests,  setManifests]  = useState<ManifestWithCarrier[]>([]);
  const [parcels,    setParcels]    = useState<ParcelBrief[]>([]);
  const [dashLoading, setDashLoading] = useState(false);

  // Expanded associate in leaderboard → their individual scans
  const [expandedUser,      setExpandedUser]      = useState<string | null>(null);
  const [associateScans,    setAssociateScans]    = useState<Record<string, AssociateScan[]>>({});
  const [loadingScans,      setLoadingScans]      = useState<string | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/login"); return; }
        const res = await fetch("/api/admin/users");
        if (res.status === 403) { router.push("/manifests"); return; }
        if (!res.ok) throw new Error("Failed to load users");
        const usersData = await res.json() as UserProfile[];
        const me = usersData.find(u => u.id === user.id);
        if (me?.role !== "admin") { router.push("/manifests"); return; }
        setUsers(usersData);
        setAuthed(true);
      } catch {
        router.push("/manifests");
      }
    }
    init();
  }, [supabase, router]);

  // ── Data loaders ─────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async (d: string) => {
    setDashLoading(true);
    const dayStart = new Date(d + "T00:00:00").toISOString();
    const dayEnd   = new Date(d + "T23:59:59.999").toISOString();
    const [{ data: mData }, { data: pData }] = await Promise.all([
      supabase.from("manifests").select("*, carrier:carriers(*)").eq("date", d).order("opened_at", { ascending: false }),
      supabase.from("parcels").select("id, scanned_at, entry_method, carrier_id").gte("scanned_at", dayStart).lte("scanned_at", dayEnd),
    ]);
    setManifests((mData as ManifestWithCarrier[]) ?? []);
    setParcels((pData as ParcelBrief[]) ?? []);
    setDashLoading(false);
  }, [supabase]);

  const loadKpi = useCallback(async (d: string) => {
    setKpiLoading(true);
    const { data, error } = await supabase.rpc("get_user_kpi", { p_date: d });
    if (!error) setKpi((data as KpiRow[]) ?? []);
    setKpiLoading(false);
  }, [supabase]);

  useEffect(() => { if (!authed) return; loadDashboard(date); }, [authed, date, loadDashboard]);
  useEffect(() => { if (!authed || tab !== "associates") return; loadKpi(date); }, [authed, tab, date, loadKpi]);

  // ── Expand associate → fetch their scans ─────────────────────────────────
  async function toggleAssociate(userId: string) {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (associateScans[userId]) return; // already loaded
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
    setAssociateScans(prev => ({ ...prev, [userId]: (data as unknown as AssociateScan[]) ?? [] }));
    setLoadingScans(null);
  }

  // ── Computed ─────────────────────────────────────────────────────────────
  const totalOut      = useMemo(() => manifests.filter(m => m.direction === "outbound").reduce((s, m) => s + m.parcel_count, 0), [manifests]);
  const totalIn       = useMemo(() => manifests.filter(m => m.direction === "inbound").reduce((s, m) => s + m.parcel_count, 0), [manifests]);
  const totalPackages = totalOut + totalIn;
  const manualCount   = useMemo(() => parcels.filter(p => p.entry_method === "manual").length, [parcels]);
  const manualRate    = totalPackages > 0 ? Math.round((manualCount / totalPackages) * 100) : 0;
  const hourlyData = useMemo(() => { const b = Array(24).fill(0) as number[]; parcels.forEach(p => { b[new Date(p.scanned_at).getHours()]++; }); return b; }, [parcels]);
  const peakCount  = Math.max(...hourlyData.slice(5, 23), 1);
  const carrierStats = useMemo((): CarrierStat[] => {
    const map: Record<string, CarrierStat> = {};
    manifests.forEach(m => {
      if (!map[m.carrier_id]) map[m.carrier_id] = { id: m.carrier_id, name: m.carrier.name, code: m.carrier.code, outbound: 0, inbound: 0, manifests: 0, openManifests: 0 };
      map[m.carrier_id].manifests++;
      if (m.direction === "outbound") map[m.carrier_id].outbound += m.parcel_count;
      else                            map[m.carrier_id].inbound  += m.parcel_count;
    });
    return Object.values(map).sort((a, b) => (b.outbound + b.inbound) - (a.outbound + a.inbound));
  }, [manifests]);
  const maxCarrierVol  = Math.max(...carrierStats.map(c => c.outbound + c.inbound), 1);
  const activeAssociates = useMemo(() => kpi.filter(r => Number(r.outbound_scans) + Number(r.inbound_scans) > 0), [kpi]);
  const topTotal = Math.max(...kpi.map(r => Number(r.outbound_scans) + Number(r.inbound_scans)), 1);
  const isToday  = date === format(new Date(), "yyyy-MM-dd");
  const managers = useMemo(() => users.filter(u => u.role === "manager" || u.role === "admin"), [users]);

  // ── Role + manager save ───────────────────────────────────────────────────
  async function saveUser(userId: string) {
    const newRole = roleEdits[userId];
    const newMgr  = mgEdits[userId]; // undefined = not changed
    const current = users.find(u => u.id === userId);
    if (!current) return;
    if (!newRole && newMgr === undefined) return;
    setSaving(userId); setSaveError(null);
    try {
      const body: Record<string, unknown> = { userId };
      if (newRole && newRole !== current.role) body.role = newRole;
      if (newMgr !== undefined) body.manager_id = newMgr;
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json() as { error?: string };
        setSaveError(b.error ?? "Save failed");
      } else {
        setUsers(prev => prev.map(u => u.id === userId
          ? { ...u, role: (newRole ?? u.role) as UserProfile["role"], manager_id: newMgr !== undefined ? newMgr : u.manager_id }
          : u
        ));
        setRoleEdits(prev => { const n = { ...prev }; delete n[userId]; return n; });
        setMgEdits(prev => { const n = { ...prev }; delete n[userId]; return n; });
      }
    } catch { setSaveError("Network error"); }
    setSaving(null);
  }

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true); setInviteError(null); setInviteSuccess(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), full_name: inviteName.trim(), role: inviteRole }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) { setInviteError(body.error ?? "Failed to send invite"); }
      else {
        setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
        setInviteEmail(""); setInviteName(""); setInviteRole("associate");
        const refreshed = await fetch("/api/admin/users");
        if (refreshed.ok) setUsers(await refreshed.json() as UserProfile[]);
      }
    } catch { setInviteError("Network error"); }
    setInviting(false);
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-purple-400 text-sm font-semibold animate-pulse">Loading admin panel…</div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 pb-0 safe-top">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/manifests")}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center text-gray-400 hover:text-white flex-none transition-colors"
              >
                ←
              </button>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center font-black text-xs shadow-lg shadow-purple-900/40 flex-none">A</div>
              <div>
                <h1 className="font-bold text-sm leading-none text-white">Admin Panel</h1>
                <p className="text-[11px] text-purple-400/80 mt-0.5">Darwynn Logistics</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-xl px-3 py-2">
                <input
                  type="date"
                  value={date}
                  onChange={e => { setDate(e.target.value); setExpandedUser(null); setAssociateScans({}); }}
                  className="bg-transparent text-xs text-white focus:outline-none [color-scheme:dark] w-28"
                />
                {isToday && (
                  <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full leading-none font-semibold">Live</span>
                )}
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex -mb-px">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                  tab === t
                    ? "border-purple-500 text-white"
                    : "border-transparent text-gray-600 hover:text-gray-400 hover:border-gray-700"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ════════════════════════════ DASHBOARD ════════════════════════════ */}
        {tab === "dashboard" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard value={dashLoading ? "…" : totalPackages} label="Total Processed"  color="purple" sub={format(new Date(date + "T12:00:00"), "MMM d, yyyy")} />
              <KpiCard value={dashLoading ? "…" : totalOut}      label="Outbound"         color="blue"   />
              <KpiCard value={dashLoading ? "…" : totalIn}       label="Returns In"       color="orange" />
              <KpiCard value={dashLoading ? "…" : `${manualRate}%`} label="Manual Entry Rate" color={manualRate > 15 ? "red" : manualRate > 5 ? "yellow" : "green"} sub={manualRate > 15 ? "High — check labels" : manualRate > 5 ? "Elevated" : "Good"} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Manifests",   value: manifests.length },
                { label: "Carriers",    value: carrierStats.length },
                { label: "Manual pkgs", value: manualCount },
                { label: "Scan pkgs",   value: totalPackages - manualCount },
              ].map(({ label, value }) => (
                <div key={label} className="glass rounded-xl p-3 text-center">
                  <div className="text-lg font-black text-gray-200">{dashLoading ? "…" : value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {!dashLoading && manifests.length > 0 && (
              <Section title="Today's Sessions" badge={manifests.length}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {manifests.map(m => {
                    const isIn = m.direction === "inbound";
                    return (
                      <button key={m.id} onClick={() => router.push(`/scan/${m.id}`)}
                        className={`text-left rounded-xl border p-4 flex items-center gap-4 hover:brightness-110 transition-all ${
                          isIn ? "bg-orange-950/50 border-orange-800/40" : "bg-blue-950/50 border-blue-800/40"
                        }`}
                      >
                        <div className={`text-xs font-black px-2 py-1 rounded flex-none ${isIn ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"}`}>
                          {isIn ? "↩ RTN" : "↑ OUT"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{m.carrier.name}</div>
                          <div className="text-xs text-gray-500">{m.opened_at ? format(new Date(m.opened_at), "h:mm a") : "—"}</div>
                        </div>
                        <div className="text-right flex-none">
                          <div className="text-2xl font-black">{m.parcel_count}</div>
                          <div className="text-xs text-gray-500">pkgs</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Section>
            )}

            {!dashLoading && parcels.length > 0 && (
              <Section title="Hourly Throughput">
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-end gap-[3px] h-32">
                    {hourlyData.slice(5, 23).map((count, i) => {
                      const hour = i + 5;
                      const pct  = count === 0 ? 2 : Math.max(4, Math.round((count / peakCount) * 100));
                      const label = hour % 3 === 0 ? `${hour % 12 || 12}${hour < 12 ? "a" : "p"}` : "";
                      return (
                        <div key={hour} className="flex-1 flex flex-col items-center gap-0.5 group">
                          {count > 0 && <div className="text-[10px] text-gray-500 group-hover:text-purple-400">{count}</div>}
                          <div className={`w-full rounded-t-sm ${count === 0 ? "bg-gray-800/60" : "bg-purple-600 hover:bg-purple-500"}`} style={{ height: `${pct}%` }} />
                          <div className="text-[10px] text-gray-600 leading-none">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-5 text-xs text-gray-500">
                    <span>Peak: <strong className="text-white">{peakCount} pkgs</strong></span>
                    <span>Busiest: <strong className="text-white">{(() => { const peak = hourlyData.indexOf(Math.max(...hourlyData)); return `${peak % 12 || 12}${peak < 12 ? "am" : "pm"}`; })()}</strong></span>
                  </div>
                </div>
              </Section>
            )}

            {!dashLoading && carrierStats.length > 0 && (
              <Section title="Carrier Volume">
                <div className="glass rounded-2xl divide-y divide-white/5">
                  {carrierStats.map(c => {
                    const total  = c.outbound + c.inbound;
                    const outPct = (c.outbound / maxCarrierVol) * 100;
                    const inPct  = (c.inbound  / maxCarrierVol) * 100;
                    return (
                      <div key={c.id} className="px-5 py-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{c.name}</span>
                          </div>
                          <span className="text-sm font-bold">{total} pkgs</span>
                        </div>
                        <div className="space-y-1.5">
                          {c.outbound > 0 && (
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-blue-400 w-14 flex-none">↑ {c.outbound}</span>
                              <div className="flex-1 bg-gray-800 rounded-full h-2">
                                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${outPct}%` }} />
                              </div>
                            </div>
                          )}
                          {c.inbound > 0 && (
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-orange-400 w-14 flex-none">↩ {c.inbound}</span>
                              <div className="flex-1 bg-gray-800 rounded-full h-2">
                                <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${inPct}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {!dashLoading && manifests.length === 0 && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4 opacity-30">📦</div>
                <div className="text-gray-500">No activity on {format(new Date(date + "T12:00:00"), "MMMM d, yyyy")}</div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════ ASSOCIATES ═══════════════════════════ */}
        {tab === "associates" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard value={kpiLoading ? "…" : activeAssociates.length} label="Active Today"   color="green"  />
              <KpiCard value={kpiLoading ? "…" : totalOut + totalIn}       label="Total Packages" color="purple" />
              <KpiCard value={kpiLoading ? "…" : totalOut}                 label="Outbound"       color="blue"   />
              <KpiCard value={kpiLoading ? "…" : `${manualRate}%`}         label="Manual Rate"    color={manualRate > 10 ? "red" : "green"} />
            </div>

            <Section title="Performance Leaderboard">
              <div className="glass rounded-2xl overflow-hidden">
                {kpiLoading ? (
                  <div className="text-center py-14 text-gray-500 animate-pulse">Loading…</div>
                ) : kpi.length === 0 ? (
                  <div className="text-center py-14 text-gray-500">
                    No activity on {format(new Date(date + "T12:00:00"), "MMMM d, yyyy")}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-800/60">
                    {[...kpi]
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
                        const isActive  = total > 0;
                        const isExpanded = expandedUser === row.user_id;
                        const rankColor = idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-gray-700";

                        return (
                          <div key={row.user_id}>
                            {/* Row */}
                            <button
                              onClick={() => isActive ? toggleAssociate(row.user_id) : undefined}
                              className={`w-full text-left px-5 py-4 transition-colors ${isActive ? "hover:bg-white/[0.02] cursor-pointer" : "opacity-40 cursor-default"}`}
                            >
                              <div className="flex items-start gap-4">
                                {/* Rank */}
                                <div className={`text-sm font-black w-5 text-right flex-none mt-1 ${rankColor}`}>
                                  {isActive ? `#${idx + 1}` : "—"}
                                </div>
                                {/* Avatar */}
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-none ${ROLE_CHIP[row.role] ?? "bg-gray-700 text-gray-300"}`}>
                                  {(row.full_name ?? row.email ?? "?")[0].toUpperCase()}
                                </div>
                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <span className="font-semibold text-sm">{row.full_name ?? row.email ?? "Unknown"}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_CHIP[row.role] ?? ""}`}>{row.role}</span>
                                  </div>
                                  {isActive && (
                                    <>
                                      <div className="flex gap-0.5 mb-2 h-2 rounded-full overflow-hidden bg-gray-800">
                                        {out > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(out / topTotal) * 100}%` }} />}
                                        {inn > 0 && <div className="bg-orange-500 h-full" style={{ width: `${(inn / topTotal) * 100}%` }} />}
                                      </div>
                                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                                        {out > 0 && <span><span className="text-blue-400 font-semibold">{out}</span> out</span>}
                                        {inn > 0 && <span><span className="text-orange-400 font-semibold">{inn}</span> return</span>}
                                        {manual > 0 && <span><span className="text-yellow-400 font-semibold">{manPct}%</span> manual</span>}
                                        {pace && <span><span className="text-green-400 font-semibold">{pace}</span>/hr</span>}
                                        {hrs && first && <span>{format(first, "h:mma")}–{last ? format(last, "h:mma") : "now"} ({hrs}h)</span>}
                                      </div>
                                    </>
                                  )}
                                </div>
                                {/* Total + expand indicator */}
                                <div className="text-right flex-none flex flex-col items-end gap-1">
                                  <div className={`text-2xl font-black tabular-nums ${isActive ? "text-white" : "text-gray-700"}`}>{total}</div>
                                  <div className="text-xs text-gray-600">pkgs</div>
                                  {isActive && (
                                    <div className="text-gray-600 text-xs">{isExpanded ? "▲" : "▼"}</div>
                                  )}
                                </div>
                              </div>
                            </button>

                            {/* Expanded: individual scans */}
                            {isExpanded && (
                              <div className="bg-gray-950/60 border-t border-white/5 px-5 py-3">
                                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">
                                  Scans by {row.full_name ?? row.email} on {format(new Date(date + "T12:00:00"), "MMM d")}
                                </div>
                                {loadingScans === row.user_id ? (
                                  <div className="text-center py-6 text-gray-600 animate-pulse text-xs">Loading scans…</div>
                                ) : !associateScans[row.user_id]?.length ? (
                                  <div className="text-center py-4 text-gray-600 text-xs">No scans found</div>
                                ) : (
                                  <div className="space-y-1 max-h-60 overflow-y-auto">
                                    {associateScans[row.user_id].map(s => (
                                      <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-gray-800/40 last:border-0">
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
                      })
                    }
                  </div>
                )}
              </div>
            </Section>

            {!kpiLoading && kpi.length > 0 && (
              <div className="glass rounded-2xl p-5 border border-purple-500/10">
                <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-3">Shift Summary</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  {[
                    { value: activeAssociates.length,                                             label: "Associates on shift" },
                    { value: activeAssociates.length > 0 ? Math.round((totalOut + totalIn) / activeAssociates.length) : 0, label: "Avg pkgs / associate" },
                    { value: manualCount,                                                          label: "Manual entries" },
                    { value: totalPackages - manualCount,                                          label: "Scanned entries" },
                  ].map(({ value, label }) => (
                    <div key={label}>
                      <div className="text-2xl font-bold">{value}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════ CARRIERS ═════════════════════════════ */}
        {tab === "carriers" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <KpiCard value={dashLoading ? "…" : carrierStats.length} label="Active Carriers"  color="purple" />
              <KpiCard value={dashLoading ? "…" : totalOut}            label="Outbound Volume"  color="blue"   />
              <KpiCard value={dashLoading ? "…" : totalIn}             label="Returns Volume"   color="orange" />
            </div>

            {dashLoading ? (
              <div className="text-center py-12 text-gray-500 animate-pulse">Loading…</div>
            ) : carrierStats.length === 0 ? (
              <div className="text-center py-16 text-gray-500">No carrier activity on {format(new Date(date + "T12:00:00"), "MMMM d, yyyy")}</div>
            ) : (
              <Section title="Volume by Carrier">
                <div className="space-y-3">
                  {carrierStats.map(c => {
                    const total  = c.outbound + c.inbound;
                    const share  = Math.round((total / Math.max(totalPackages, 1)) * 100);
                    const outPct = (c.outbound / maxCarrierVol) * 100;
                    const inPct  = (c.inbound  / maxCarrierVol) * 100;
                    const mfForCarrier = manifests.filter(m => m.carrier_id === c.id);
                    return (
                      <div key={c.id} className="glass rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-base">{c.name}</span>
                              </div>
                            <div className="text-xs text-gray-500 mt-0.5">{mfForCarrier.length} manifest{mfForCarrier.length !== 1 ? "s" : ""} · {share}% of day</div>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl font-black">{total}</div>
                            <div className="text-xs text-gray-500">packages</div>
                          </div>
                        </div>
                        {c.outbound > 0 && (
                          <div className="mb-3">
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-blue-400 font-semibold">↑ Outbound</span>
                              <span className="text-gray-400">{c.outbound} pkgs</span>
                            </div>
                            <div className="bg-gray-800 rounded-full h-2.5">
                              <div className="bg-gradient-to-r from-blue-700 to-blue-400 h-2.5 rounded-full" style={{ width: `${outPct}%` }} />
                            </div>
                          </div>
                        )}
                        {c.inbound > 0 && (
                          <div className="mb-3">
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-orange-400 font-semibold">↩ Returns</span>
                              <span className="text-gray-400">{c.inbound} pkgs</span>
                            </div>
                            <div className="bg-gray-800 rounded-full h-2.5">
                              <div className="bg-gradient-to-r from-orange-700 to-orange-400 h-2.5 rounded-full" style={{ width: `${inPct}%` }} />
                            </div>
                          </div>
                        )}
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {mfForCarrier.map(m => (
                            <button key={m.id} onClick={() => router.push(`/scan/${m.id}`)}
                              className={`text-left rounded-lg px-3 py-2 text-xs border transition-colors ${
                                m.direction === "inbound"
                                  ? "bg-orange-950/60 border-orange-800/40 hover:border-orange-600"
                                  : "bg-blue-950/60 border-blue-800/40 hover:border-blue-600"
                              }`}
                            >
                              <div className="font-semibold">{m.direction === "inbound" ? "↩ Return" : "↑ Outbound"}</div>
                              <div className="font-bold mt-0.5 text-white">{m.parcel_count} pkgs</div>
                              <div className="text-gray-500 mt-0.5">{m.opened_at ? format(new Date(m.opened_at), "h:mm a") : "—"}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ════════════════════════════ USERS ════════════════════════════════ */}
        {tab === "users" && (
          <>
            {/* Invite form */}
            <div className="glass rounded-2xl p-5 border border-purple-500/15">
              <h3 className="text-sm font-bold text-purple-300 mb-4">Invite New User</h3>
              <form onSubmit={inviteUser} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="email" placeholder="Email address" value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)} required
                    className="bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500/60 placeholder-gray-600 w-full transition-colors"
                  />
                  <input
                    type="text" placeholder="Full name (optional)" value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    className="bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500/60 placeholder-gray-600 w-full transition-colors"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    className="bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-purple-500/60 [color-scheme:dark]"
                  >
                    <option value="associate">Associate</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="submit" disabled={inviting || !inviteEmail.trim()}
                    className="disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}
                  >
                    {inviting ? "Sending…" : "Send Invite"}
                  </button>
                </div>
                {inviteSuccess && (
                  <div className="bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl px-3 py-2 text-sm flex items-center justify-between">
                    <span>✓ {inviteSuccess}</span>
                    <button type="button" onClick={() => setInviteSuccess(null)} className="text-green-500 text-lg leading-none">×</button>
                  </div>
                )}
                {inviteError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2 text-sm flex items-center justify-between">
                    <span>⚠ {inviteError}</span>
                    <button type="button" onClick={() => setInviteError(null)} className="text-red-500 text-lg leading-none">×</button>
                  </div>
                )}
              </form>
            </div>

            {saveError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm flex items-center justify-between">
                <span>⚠ {saveError}</span>
                <button onClick={() => setSaveError(null)} className="text-red-400 text-lg leading-none">×</button>
              </div>
            )}

            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{users.length} accounts</p>
              <div className="flex gap-4 text-xs text-gray-600">
                <span>{users.filter(u => u.role === "admin").length} admin</span>
                <span>{users.filter(u => u.role === "manager").length} manager</span>
                <span>{users.filter(u => u.role === "associate").length} associate</span>
              </div>
            </div>

            <div className="space-y-2">
              {users.map(u => {
                const pendingRole = roleEdits[u.id] ?? u.role;
                const pendingMgr  = mgEdits[u.id] !== undefined ? mgEdits[u.id] : u.manager_id;
                const isDirty     = (roleEdits[u.id] !== undefined && roleEdits[u.id] !== u.role) || (mgEdits[u.id] !== undefined && mgEdits[u.id] !== u.manager_id);
                const initial     = (u.full_name ?? u.email ?? "?")[0].toUpperCase();
                const assignedMgr = managers.find(m => m.id === u.manager_id);
                return (
                  <div key={u.id} className="glass rounded-2xl p-4 hover:bg-white/[0.04] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-none ${ROLE_CHIP[u.role] ?? "bg-gray-700 text-gray-300"}`}>{initial}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{u.full_name ?? "(no name)"}</div>
                        <div className="text-xs text-gray-500 truncate">{u.email}</div>
                        {u.role === "associate" && assignedMgr && (
                          <div className="text-xs text-blue-400 mt-0.5">→ {assignedMgr.full_name ?? assignedMgr.email}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* Manager assignment — only for associates */}
                        {(pendingRole === "associate") && (
                          <select
                            value={pendingMgr ?? ""}
                            onChange={e => setMgEdits(prev => ({ ...prev, [u.id]: e.target.value || null }))}
                            className="bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand/50 transition-colors max-w-[130px] [color-scheme:dark]"
                          >
                            <option value="">No manager</option>
                            {managers.filter(m => m.id !== u.id).map(m => (
                              <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                            ))}
                          </select>
                        )}
                        <select
                          value={pendingRole}
                          onChange={e => setRoleEdits(prev => ({ ...prev, [u.id]: e.target.value }))}
                          className="bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-purple-500/60 transition-colors [color-scheme:dark]"
                        >
                          <option value="associate">Associate</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          onClick={() => saveUser(u.id)}
                          disabled={!isDirty || saving === u.id}
                          className="disabled:opacity-25 text-white px-3 py-1.5 rounded-lg text-sm font-semibold min-w-[52px] transition-all active:scale-[0.97]"
                          style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}
                        >
                          {saving === u.id ? "…" : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

      </main>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function KpiCard({ value, label, color, sub }: {
  value: string | number;
  label: string;
  color: "purple" | "blue" | "orange" | "green" | "red" | "yellow";
  sub?: string;
}) {
  const textColor = { purple: "text-purple-400", blue: "text-blue-400", orange: "text-orange-400", green: "text-emerald-400", red: "text-red-400", yellow: "text-yellow-400" }[color];
  return (
    <div className="glass rounded-2xl p-5">
      <div className={`text-3xl sm:text-4xl font-black tracking-tight tabular-nums ${textColor}`}>{value}</div>
      <div className="text-xs text-gray-400 font-medium mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[11px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, badge, badgeColor = "green", children }: {
  title: string;
  badge?: number;
  badgeColor?: "green" | "blue" | "orange";
  children: React.ReactNode;
}) {
  const chip = { green: "bg-green-500/20 text-green-400 border-green-500/30", blue: "bg-blue-500/20 text-blue-400 border-blue-500/30", orange: "bg-orange-500/20 text-orange-400 border-orange-500/30" }[badgeColor];
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</h2>
        {badge !== undefined && badge > 0 && <span className={`text-xs border px-1.5 py-0.5 rounded-full font-semibold ${chip}`}>{badge}</span>}
      </div>
      {children}
    </section>
  );
}
