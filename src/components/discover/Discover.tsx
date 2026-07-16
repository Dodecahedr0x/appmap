"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppCard } from "@/components/AppCard";
import { Facets } from "@/components/discover/Facets";
import { SORT_OPTIONS } from "@/lib/constants";
import type { SearchResult } from "@/lib/types";

interface Props {
  initial: SearchResult;
}

/**
 * The Discover experience: a search box, faceted filters, sort control, and a
 * results grid. All state lives in the URL so results are shareable and the
 * back button works; changing any control pushes new query params and refetches
 * from /api/apps.
 */
export function Discover({ initial }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [result, setResult] = useState<SearchResult>(initial);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const selectedTags = useMemo(() => params.getAll("tags"), [params]);
  const category = params.get("category") ?? "";
  const chain = params.get("chain") ?? "";
  const sort = params.get("sort") ?? "rank";
  const page = Number(params.get("page") ?? "1");

  // Build a query string from the current control values.
  const buildParams = useCallback(
    (overrides: Record<string, string | string[] | undefined>) => {
      const next = new URLSearchParams();
      const q = overrides.q !== undefined ? overrides.q : query;
      if (q && typeof q === "string") next.set("q", q);

      const cat = overrides.category !== undefined ? overrides.category : category;
      if (cat && typeof cat === "string") next.set("category", cat);

      const ch = overrides.chain !== undefined ? overrides.chain : chain;
      if (ch && typeof ch === "string") next.set("chain", ch);

      const s = overrides.sort !== undefined ? overrides.sort : sort;
      if (s && typeof s === "string" && s !== "rank") next.set("sort", s);

      const tags =
        overrides.tags !== undefined
          ? (overrides.tags as string[])
          : selectedTags;
      for (const t of tags) next.append("tags", t);

      const p = overrides.page !== undefined ? overrides.page : "1";
      if (p && p !== "1") next.set("page", String(p));

      return next;
    },
    [query, category, chain, sort, selectedTags],
  );

  const navigate = useCallback(
    (overrides: Record<string, string | string[] | undefined>) => {
      const next = buildParams(overrides);
      router.push(`/?${next.toString()}`, { scroll: false });
    },
    [buildParams, router],
  );

  // Refetch whenever the URL params change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = params.toString();
    fetch(`/api/apps?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok) setResult(json.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  // Debounced text search.
  const onQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: value, page: "1" }), 300);
  };

  const toggleTag = (slug: string) => {
    const next = selectedTags.includes(slug)
      ? selectedTags.filter((t) => t !== slug)
      : [...selectedTags, slug];
    navigate({ tags: next, page: "1" });
  };

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const startRank = (result.page - 1) * result.pageSize;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="bg-brand-gradient bg-clip-text text-3xl font-black text-transparent sm:text-4xl">
          Discover the best apps
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Ranked by the crowd — token-weighted votes, tag stake, and real
          traffic.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            className="input pl-10"
            placeholder="Search apps, tags, categories…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search apps"
          />
          <svg
            className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
            />
          </svg>
        </div>
        <select
          className="input sm:w-48"
          value={sort}
          onChange={(e) => navigate({ sort: e.target.value, page: "1" })}
          aria-label="Sort results"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <Facets
            facets={result.facets}
            selectedTags={selectedTags}
            category={category}
            chain={chain}
            onToggleTag={toggleTag}
            onSelectCategory={(c) =>
              navigate({ category: c === category ? "" : c, page: "1" })
            }
            onSelectChain={(c) =>
              navigate({ chain: c === chain ? "" : c, page: "1" })
            }
            onClear={() =>
              navigate({ category: "", chain: "", tags: [], q: query })
            }
          />
        </aside>

        <section>
          <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
            <span>
              {loading ? "Searching…" : `${result.total} apps`}
              {query && !loading && ` for “${query}”`}
            </span>
          </div>

          {result.apps.length === 0 ? (
            <div className="card grid place-items-center p-12 text-center text-slate-500">
              <p>No apps match your search.</p>
              <p className="mt-1 text-xs">
                Try removing a filter — or{" "}
                <a href="/submit" className="text-brand-purple hover:underline">
                  submit the app yourself
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {result.apps.map((app, i) => (
                <AppCard
                  key={app.id}
                  app={app}
                  rank={sort === "rank" ? startRank + i + 1 : undefined}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => navigate({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                className="btn-secondary"
                disabled={page >= totalPages}
                onClick={() => navigate({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
