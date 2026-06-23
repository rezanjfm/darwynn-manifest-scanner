"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UserProfile } from "@/types";
import { format } from "date-fns";

type KpiRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  outbound_scans: number;
  inbound_scans: number;
  manual_scans: number;
  first_scan_at: string | null;
  last_scan_at: string | null;
};

const ROLE_LABELS: Record<string, string> = { worker: "Worker", manager: "Manager", admin: "Admin" };
const ROLE_COLORS: Record<string, string> = { worker: "text-gray-500", manager: "text-blue-600", admin: "text-purple-600" };

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<"users" | "kpi">("users");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KpiRow[]>([]);
  const [kpiDate, setKpiDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [kpiLoading, setKpiLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin") { router.push("/manifests"); return; }

      const { data: usersData } = await supabase
        .from("user_profiles")
        .select("*")
        .order("created_at");

      setUsers((usersData as UserProfile[]) ?? []);
      setLoading(false);
    }
    init();
  }, [supabase, router]);

  const loadKpi = useCallback(async (date: string) => {
    setKpiLoading(true);
    const { data, error } = await supabase.rpc("get_user_kpi", { p_date: date });
    if (!error) setKpi((data as KpiRow[]) ?? []);
    setKpiLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (tab === "kpi" && !loading) loadKpi(kpiDate);
  }, [tab, kpiDate, loading, loadKpi]);

  async function saveRole(userId: string) {
    const newRole = roleEdits[userId];
    if (!newRole || newRole === users.find((u) => u.id === userId)?.role) return;
    setSaving(userId);
    const { error } = await supabase
      .from("user_profiles")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (!error) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole as UserProfile["role"] } : u));
      setRoleEdits((prev) => { const n = { ...prev }; delete n[userId]; return n; });
    }
    setSaving(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  const kpiTotal = kpi.reduce(
    (acc, r) => ({
      out: acc.out + Number(r.outbound_scans),
      inn: acc.inn + Number(r.inbound_scans),
      active: acc.active + (Number(r.outbound_scans) + Number(r.inbound_scans) > 0 ? 1 : 0),
    }),
    { out: 0, inn: 0, active: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <button onClick={() => router.push("/manifests")} className="bg-white/20 px-3 py-1.5 rounded-lg text-sm">
            ← Back
          </button>
        </div>
        <div className="max-w-4xl mx-auto mt-3 flex gap-2">
          {(["users", "kpi"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors capitalize ${
                tab === t ? "bg-white text-blue-700" : "bg-white/20 text-white"
              }`}
            >
              {t === "kpi" ? "KPI" : "Users"}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {/* ── Users tab ── */}
        {tab === "users" && (
          <>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
              {users.length} registered users
            </p>
            <div className="space-y-2">
              {users.map((u) => {
                const pendingRole = roleEdits[u.id] ?? u.role;
                const isDirty = roleEdits[u.id] && roleEdits[u.id] !== u.role;
                return (
                  <div
                    key={u.id}
                    className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 flex-none">
                      {(u.full_name ?? u.email ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{u.full_name ?? "(no name)"}</div>
                      <div className="text-xs text-gray-400 truncate">{u.email}</div>
                    </div>
                    <select
                      value={pendingRole}
                      onChange={(e) => setRoleEdits((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      className="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="worker">Worker</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => saveRole(u.id)}
                      disabled={!isDirty || saving === u.id}
                      className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-30 min-w-[48px]"
                    >
                      {saving === u.id ? "…" : "Save"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── KPI tab ── */}
        {tab === "kpi" && (
          <>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={kpiDate}
                onChange={(e) => setKpiDate(e.target.value)}
                className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => loadKpi(kpiDate)}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold"
              >
                Refresh
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <div className="text-3xl font-bold text-blue-600">{kpiTotal.out}</div>
                <div className="text-xs text-gray-500 mt-1">Outbound Scanned</div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <div className="text-3xl font-bold text-orange-500">{kpiTotal.inn}</div>
                <div className="text-xs text-gray-500 mt-1">Returns Received</div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <div className="text-3xl font-bold text-gray-700">{kpiTotal.active}</div>
                <div className="text-xs text-gray-500 mt-1">Active Workers</div>
              </div>
            </div>

            {/* Per-user table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {kpiLoading ? (
                <div className="text-center py-10 text-gray-400">Loading…</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Worker</th>
                      <th className="text-right px-3 py-3 font-semibold text-blue-600">Out</th>
                      <th className="text-right px-3 py-3 font-semibold text-orange-500">In</th>
                      <th className="text-right px-3 py-3 font-semibold text-gray-500">Manual</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpi.map((row) => {
                      const first = row.first_scan_at ? new Date(row.first_scan_at) : null;
                      const last  = row.last_scan_at  ? new Date(row.last_scan_at)  : null;
                      const hrs   = first && last
                        ? ((last.getTime() - first.getTime()) / 3_600_000).toFixed(1)
                        : null;
                      const total = Number(row.outbound_scans) + Number(row.inbound_scans);
                      return (
                        <tr key={row.user_id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.full_name ?? row.email ?? "Unknown"}</div>
                            <div className={`text-xs mt-0.5 ${ROLE_COLORS[row.role] ?? "text-gray-400"}`}>
                              {ROLE_LABELS[row.role] ?? row.role}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-bold ${total > 0 ? "text-blue-600" : "text-gray-300"}`}>
                              {row.outbound_scans}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-bold ${Number(row.inbound_scans) > 0 ? "text-orange-500" : "text-gray-300"}`}>
                              {row.inbound_scans}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-gray-400">{row.manual_scans}</td>
                          <td className="px-4 py-3 text-right text-gray-400 text-xs">
                            {hrs ? (
                              <>
                                <div>{hrs}h</div>
                                {first && <div className="text-gray-300">{format(first, "h:mm")}</div>}
                              </>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {kpi.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                          No data for {format(new Date(kpiDate + "T12:00:00"), "MMM d, yyyy")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
