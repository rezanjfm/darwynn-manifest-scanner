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

  const isAdmin = userRole === "admin";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand text-white px-4 py-4 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Package Lookup</h1>
            <p className="text-blue-200 text-sm">Search any tracking number</p>
          </div>
          <button onClick={() => router.push("/manifests")} className="bg-white/20 px-3 py-1.5 rounded-lg text-sm">
            ← Back
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="Tracking number or partial…"
            className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 font-mono text-base focus:outline-none focus:border-blue-500 bg-white"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 3}
            className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold disabled:opacity-40 min-w-[72px]"
          >
            {loading ? "…" : "Search"}
          </button>
        </form>

        {!isAdmin && (
          <p className="text-xs text-gray-400 text-center">
            Who scanned each package is not shown — contact your admin for details.
          </p>
        )}

        {searched && !loading && results.length === 0 && (
          <div className="text-center text-gray-400 py-14">
            <div className="text-5xl mb-3">📭</div>
            <p className="font-semibold">Not found</p>
            <p className="text-sm mt-1">"{query}" has no scan record.</p>
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) => {
            const isInbound = r.manifest_direction === "inbound";
            return (
              <div
                key={r.id}
                className={`bg-white rounded-2xl p-4 shadow-sm border-l-4 ${
                  isInbound ? "border-orange-400" : "border-green-400"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`text-3xl mt-0.5 flex-none ${isInbound ? "text-orange-400" : "text-green-500"}`}>
                    {isInbound ? "↩" : "✓"}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {isInbound ? (
                        <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          RETURN
                        </span>
                      ) : (
                        <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          OUTBOUND
                        </span>
                      )}
                      <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                        {r.manifest_status === "closed" ? "Manifest Closed" : "Manifest Open"}
                      </span>
                      {r.entry_method === "manual" && (
                        <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">
                          Manual entry
                        </span>
                      )}
                    </div>

                    {/* Tracking number */}
                    <div className="font-mono font-bold text-lg leading-tight truncate">
                      {r.tracking_number}
                    </div>

                    {/* Carrier + date */}
                    <div className="text-gray-600 text-sm mt-0.5">{r.carrier_name}</div>
                    <div className="text-gray-500 text-sm">
                      {format(new Date(r.scanned_at), "MMM d, yyyy")} at{" "}
                      {format(new Date(r.scanned_at), "h:mm a")}
                    </div>

                    {/* Admin-only: who scanned it */}
                    {isAdmin && r.scanned_by_name && (
                      <div className="text-xs text-purple-600 mt-1 font-medium">
                        Scanned by {r.scanned_by_name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
