"use client";

import { useEffect, useState } from "react";
import { pwLevelLabel } from "@/lib/wageLevels";

type RoleOption = { soc_code: string; soc_title: string; filing_count: number };
type RoleStats = {
  socCode: string;
  overall: {
    soc_title: string;
    filing_count: number;
    wage_p10: string | null;
    wage_p25: string | null;
    wage_median: string | null;
    wage_p75: string | null;
    wage_p90: string | null;
  };
  byLevel: { pw_wage_level: string; filing_count: number; wage_p25: string | null; wage_median: string | null; wage_p75: string | null }[];
  byCompany: { employer_id: number; employer_name: string; filing_count: number; wage_median: string | null }[];
  byRegion: { worksite_state: string; filing_count: number; wage_median: string | null }[];
};

const money = (v: string | null) => (v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`);

export default function RolesPage() {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<RoleStats | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/roles/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setOptions(d.results));
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/roles/${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then(setStats);
  }, [selected]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Role Explorer</h1>
      <p className="text-sm text-black/60 dark:text-white/60 mb-6">
        Pick a role to see wage percentiles across companies and regions, grouped by
        standardized SOC occupation code.
      </p>

      <input
        className="w-full border rounded px-3 py-2 text-sm border-black/15 dark:border-white/15 bg-transparent mb-3"
        placeholder="Search for a role (e.g. software engineer)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="flex flex-wrap gap-2 mb-8">
        {options.map((o) => (
          <button
            key={o.soc_code}
            onClick={() => setSelected(o.soc_code)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              selected === o.soc_code
                ? "bg-foreground text-background border-foreground"
                : "border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {o.soc_title} <span className="opacity-60">({o.filing_count.toLocaleString()})</span>
          </button>
        ))}
      </div>

      {stats && (
        <>
          <h2 className="text-lg font-semibold mb-1">{stats.overall.soc_title}</h2>
          <p className="text-xs text-black/50 dark:text-white/50 mb-4">
            SOC {stats.socCode} · {stats.overall.filing_count.toLocaleString()} filings nationwide
          </p>

          <div className="grid grid-cols-5 gap-2 mb-8">
            {(
              [
                ["10th pct", stats.overall.wage_p10],
                ["25th pct", stats.overall.wage_p25],
                ["Median", stats.overall.wage_median],
                ["75th pct", stats.overall.wage_p75],
                ["90th pct", stats.overall.wage_p90],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="border rounded border-black/10 dark:border-white/10 px-2 py-2 text-center">
                <div className="text-[10px] uppercase text-black/40 dark:text-white/40">{label}</div>
                <div className="text-sm font-semibold">{money(v)}</div>
              </div>
            ))}
          </div>

          {stats.byLevel.length > 0 && (
            <div className="mb-8">
              <h3 className="text-sm font-semibold mb-2">Wage percentiles by experience level</h3>
              <p className="text-xs text-black/50 dark:text-white/50 mb-2">
                Mixing all experience levels into one range is misleading — an entry-level
                and a senior filing for the same role can differ by 2x or more.
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-black/50 dark:text-white/50">
                  <tr>
                    <th className="py-1 font-medium">Level</th>
                    <th className="py-1 font-medium text-right">Filings</th>
                    <th className="py-1 font-medium text-right">25th pct</th>
                    <th className="py-1 font-medium text-right">Median</th>
                    <th className="py-1 font-medium text-right">75th pct</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byLevel.map((lvl) => (
                    <tr key={lvl.pw_wage_level} className="border-t border-black/10 dark:border-white/10">
                      <td className="py-1.5">{pwLevelLabel(lvl.pw_wage_level)}</td>
                      <td className="py-1.5 text-right">{lvl.filing_count.toLocaleString()}</td>
                      <td className="py-1.5 text-right">{money(lvl.wage_p25)}</td>
                      <td className="py-1.5 text-right font-medium">{money(lvl.wage_median)}</td>
                      <td className="py-1.5 text-right">{money(lvl.wage_p75)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold mb-2">Top sponsoring companies</h3>
              <ul className="text-sm space-y-1">
                {stats.byCompany.map((c) => (
                  <li
                    key={c.employer_id}
                    className="flex justify-between border-t border-black/10 dark:border-white/10 py-1.5"
                  >
                    <a href={`/company/${c.employer_id}`} className="hover:underline truncate pr-2">
                      {c.employer_name}
                    </a>
                    <span className="text-black/50 dark:text-white/50 shrink-0">
                      {c.filing_count.toLocaleString()} · {money(c.wage_median)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Top regions</h3>
              <ul className="text-sm space-y-1">
                {stats.byRegion.map((r) => (
                  <li
                    key={r.worksite_state}
                    className="flex justify-between border-t border-black/10 dark:border-white/10 py-1.5"
                  >
                    <span>{r.worksite_state}</span>
                    <span className="text-black/50 dark:text-white/50">
                      {r.filing_count.toLocaleString()} · {money(r.wage_median)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
