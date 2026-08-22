"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PW_LEVELS } from "@/lib/wageLevels";

type SearchResult = {
  employerId: number;
  employerName: string;
  jobTitleId: number;
  jobTitle: string;
  filingCount: number;
  wageP25: string | null;
  wageMedian: string | null;
  wageP75: string | null;
  mostRecentFilingDate: string | null;
};

type SearchResponse = {
  results: SearchResult[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

const DEFAULT_SORT = "filing_count";

const money = (v: string | null) =>
  v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;

function SearchPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Hydrate initial state from the URL so a reload (or a shared/bookmarked
  // link) restores the exact same search instead of resetting to blank.
  const [jobTitle, setJobTitle] = useState(() => searchParams.get("jobTitle") ?? "");
  const [company, setCompany] = useState(() => searchParams.get("company") ?? "");
  const [location, setLocation] = useState(() => searchParams.get("location") ?? "");
  const [pwLevels, setPwLevels] = useState<string[]>(() => {
    const raw = searchParams.get("pwLevel");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? DEFAULT_SORT);
  const [page, setPage] = useState(() => Number(searchParams.get("page") ?? 1) || 1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const togglePwLevel = (level: string) => {
    setPwLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const runSearch = useCallback(
    async (p: number) => {
      if (!jobTitle && !company && !location && pwLevels.length === 0) {
        setData(null);
        return;
      }
      setLoading(true);
      const params = new URLSearchParams();
      if (jobTitle) params.set("jobTitle", jobTitle);
      if (company) params.set("company", company);
      if (location) params.set("location", location);
      if (pwLevels.length > 0) params.set("pwLevel", pwLevels.join(","));
      params.set("sort", sort);
      params.set("page", String(p));
      try {
        const res = await fetch(`/api/search?${params.toString()}`);
        const json = await res.json();
        setData(json);
      } finally {
        setLoading(false);
      }
    },
    [jobTitle, company, location, pwLevels, sort]
  );

  // Keep the URL's query string in sync with the current filters/page, so
  // reloading, going back, or sharing the link reproduces this exact search.
  useEffect(() => {
    const params = new URLSearchParams();
    if (jobTitle) params.set("jobTitle", jobTitle);
    if (company) params.set("company", company);
    if (location) params.set("location", location);
    if (pwLevels.length > 0) params.set("pwLevel", pwLevels.join(","));
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobTitle, company, location, pwLevels, sort, page]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMountRef = useRef(false);

  // On mount: run the search once with whatever page/filters came from the
  // URL (no debounce, no forcing back to page 1). After that, auto-search
  // whenever a filter changes, debounced so typing doesn't fire a request
  // (and a semantic-search embedding call) on every keystroke, and reset to
  // page 1 since the previous page number no longer applies to a new filter.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      if (jobTitle || company || location || pwLevels.length > 0) {
        runSearch(page);
      }
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      runSearch(1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobTitle, company, location, pwLevels, sort]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPage(1);
    runSearch(1);
  };

  const goToPage = (p: number) => {
    setPage(p);
    runSearch(p);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Find H-1B sponsors</h1>
      <p className="text-sm text-black/60 dark:text-white/60 mb-6">
        Search 1.5M+ unique H-1B LCA filings from public DOL disclosure data by job title,
        company, or location.
      </p>

      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <input
          className="border rounded px-3 py-2 text-sm border-black/15 dark:border-white/15 bg-transparent"
          placeholder="Job title (e.g. data analyst)"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
        <input
          className="border rounded px-3 py-2 text-sm border-black/15 dark:border-white/15 bg-transparent"
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <input
          className="border rounded px-3 py-2 text-sm border-black/15 dark:border-white/15 bg-transparent"
          placeholder="City or state (e.g. TX)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <button
          type="submit"
          className="rounded px-3 py-2 text-sm font-medium bg-foreground text-background hover:opacity-90"
        >
          Search
        </button>
      </form>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs text-black/50 dark:text-white/50">Experience level:</span>
        {PW_LEVELS.map((lvl) => (
          <button
            key={lvl.value}
            type="button"
            onClick={() => togglePwLevel(lvl.value)}
            aria-pressed={pwLevels.includes(lvl.value)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              pwLevels.includes(lvl.value)
                ? "bg-foreground text-background border-foreground"
                : "border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {lvl.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-black/50 dark:text-white/50">
          {loading ? "Searching…" : data ? `${data.totalCount.toLocaleString()} results` : ""}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="sort" className="text-black/50 dark:text-white/50">
            Sort by
          </label>
          <select
            id="sort"
            className="border rounded px-2 py-1 border-black/15 dark:border-white/15 bg-transparent"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="filing_count">Filing count</option>
            <option value="wage_median">Median wage</option>
            <option value="most_recent">Most recent filing</option>
          </select>
        </div>
      </div>

      {!data && !loading && (
        <div className="border rounded border-black/10 dark:border-white/10 px-3 py-16 text-center text-sm text-black/50 dark:text-white/50">
          Enter a job title, company, or location, or pick an experience level above to search.
        </div>
      )}

      {(data || loading) && (
      <div className="overflow-x-auto border rounded border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/5 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Job title</th>
              <th className="px-3 py-2 font-medium text-right">Filings</th>
              <th className="px-3 py-2 font-medium text-right">Wage range (25th–75th pct)</th>
              <th className="px-3 py-2 font-medium text-right">Most recent</th>
            </tr>
          </thead>
          <tbody>
            {data?.results.map((r) => (
              <tr
                key={`${r.employerId}-${r.jobTitleId}`}
                className="border-t border-black/10 dark:border-white/10"
              >
                <td className="px-3 py-2">
                  <Link href={`/company/${r.employerId}`} className="hover:underline">
                    {r.employerName}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.jobTitle}</td>
                <td className="px-3 py-2 text-right">{r.filingCount.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  {money(r.wageP25)} – {money(r.wageP75)}
                  <span className="text-black/40 dark:text-white/40">
                    {" "}
                    (med {money(r.wageMedian)})
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{r.mostRecentFilingDate ?? "—"}</td>
              </tr>
            ))}
            {data && data.results.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-black/50 dark:text-white/50">
                  No results. Try broadening your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="px-3 py-1 border rounded border-black/15 dark:border-white/15 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-black/60 dark:text-white/60">
            Page {page} of {data.totalPages.toLocaleString()}
          </span>
          <button
            disabled={page >= data.totalPages}
            onClick={() => goToPage(page + 1)}
            className="px-3 py-1 border rounded border-black/15 dark:border-white/15 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
