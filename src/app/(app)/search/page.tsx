"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";

type SearchResult = {
  id: string;
  tracking_number: string;
  entry_method: string;
  scanned_at: string;
  scanned_by: string | null;
  scanned_by_name: string | null;
  manifest_id: string;
  manifest_date: string;
  manifest_status: string;
  manifest_direction: string;
  carrier_name: string;
  carrier_code: string;
};

export default function SearchPage() {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>("associate");

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profile) setUserRole(profile.role);
      inputRef.current?.focus();
    }
    init();
  }, [supabase, router]);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toUpperCase();
    if (trimmed.length < 3) return;
    setLoading(true);
    setSearched(true);

    // search_parcels RPC anonymises scanned_by_name for non-admins at the DB level
    const { data } = await supabase.rpc("search_parcels", {
      p_query: trimmed,
      p_limit: 20,
    });

    setResults((data as SearchResult[]) ?? []);
    setLoading(false);
  }, [supabase]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSearch(query);
  }

  const isElevated = userRole === "admin" || userRole === "manager";

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-brand/4 blur-[100px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-4 pt-5 pb-4 safe-top border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/manifests")}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-gray-400 hover:text-white flex-none transition-colors"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Package Lookup</h1>
            <p className="text-gray-600 text-xs">Search any tracking number</p>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 pt-5 pb-12 space-y-4">

        {/* Search form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="Tracking number or partial…"
            className="flex-1 bg-white/5 border border-white/10 text-white placeholder-gray-600 rounded-xl px-4 py-3.5 font-mono text-sm focus:outline-none focus:border-brand/50 focus:bg-white/8 transition-all"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 3}
            className="px-5 py-3.5 rounded-xl font-bold text-sm text-white disabled:opacity-30 transition-all active:scale-[0.97] min-w-[80px] flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #00B2D8, #0093B8)" }}
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : "Search"
            }
          </button>
        </form>

        {!isElevated && (
          <p className="text-xs text-gray-700 text-center">
            Scanner identity is not shown — contact your admin for details.
          </p>
        )}

        {searched && !loading && results.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4 opacity-20">📭</div>
            <p className="text-gray-400 font-semibold">Not found</p>
            <p className="text-gray-600 text-sm mt-1">&ldquo;{query}&rdquo; has no scan record.</p>
          </div>
        )}

        <div className="space-y-2">
          {results.map((r) => {
            const isIn = r.manifest_direction === "inbound";
            return (
              <button
                key={r.id}
                onClick={() => router.push(`/scan/${r.manifest_id}`)}
                className="w-full glass rounded-2xl p-4 text-left transition-all active:scale-[0.98] hover:bg-white/[0.05]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-none mt-0.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
                      isIn ? "bg-orange-500/15 text-orange-400" : "bg-brand/15 text-brand"
                    }`}>
                      {isIn ? "↩" : "✓"}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                        isIn ? "bg-orange-500/15 text-orange-400" : "bg-brand/15 text-brand"
                      }`}>
                        {isIn ? "RETURN" : "OUTBOUND"}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        r.manifest_status === "closed"
                          ? "bg-gray-700/50 text-gray-500"
                          : "bg-green-500/15 text-green-400"
                      }`}>
                        {r.manifest_status === "closed" ? "CLOSED" : "OPEN"}
                      </span>
                      {r.entry_method === "manual" && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                          Manual
                        </span>
                      )}
                    </div>

                    <div className="font-mono font-bold text-white text-sm leading-tight truncate">
                      {r.tracking_number}
                    </div>

                    <div className="text-gray-500 text-xs mt-1">
                      {r.carrier_name} · {format(new Date(r.scanned_at), "MMM d")} at {format(new Date(r.scanned_at), "h:mm a")}
                    </div>

                    {isElevated && r.scanned_by_name && (
                      <div className="text-xs text-brand/70 mt-0.5">
                        {r.scanned_by_name}
                      </div>
                    )}
                  </div>

                  <div className="flex-none text-gray-700 text-sm">→</div>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
