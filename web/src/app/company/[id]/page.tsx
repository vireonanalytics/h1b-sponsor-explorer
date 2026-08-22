"use client";

import { useEffect, useState, use } from "react";
import { pwLevelLabel } from "@/lib/wageLevels";

type CompanyData = {
  employer: { employer_id: number; canonical_name: string; fein: string | null; naics_code: string | null };
  nameVariants: { raw_name: string; occurrence_count: number }[];
  summary: {
    filing_count: number;
    distinct_job_titles: number;
    most_recent_filing_date: string | null;
    wage_p25: string | null;
    wage_median: string | null;
    wage_p75: string | null;
  };
  topJobTitles: { job_title: string; filing_count: number; wage_p25: string | null; wage_median: string | null; wage_p75: string | null }[];
  experienceLevelBreakdown: { pw_wage_level: string; filing_count: number; wage_median: string | null }[];
  filingVolumeOverTime: { quarter: string; filing_count: number }[];
  topWorksites: { worksite_state: string; worksite_city: string; filing_count: number }[];
};

const money = (v: string | number | null) =>
  v == null ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CompanyData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/employers/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return <div className="max-w-4xl mx-auto px-4 py-8">Company not found.</div>;
  }
  if (!data) {
    return <div className="max-w-4xl mx-auto px-4 py-8 text-black/50 dark:text-white/50">Loading…</div>;
  }

  const maxVolume = Math.max(...data.filingVolumeOverTime.map((v) => v.filing_count), 1);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">{data.employer.canonical_name}</h1>
      <p className="text-xs text-black/50 dark:text-white/50 mb-6">
        {data.employer.fein ? `FEIN ${data.employer.fein}` : "FEIN unavailable"}
        {data.employer.naics_code ? ` · NAICS ${data.employer.naics_code}` : ""}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Total filings" value={data.summary.filing_count.toLocaleString()} />
        <Stat label="Distinct roles" value={data.summary.distinct_job_titles.toLocaleString()} />
        <Stat label="Median wage" value={money(data.summary.wage_median)} />
        <Stat label="Most recent filing" value={data.summary.most_recent_filing_date ?? "—"} />
      </div>

      {data.experienceLevelBreakdown.length > 0 && (
        <Section title="Experience level breakdown">
          <p className="text-xs text-black/50 dark:text-white/50 mb-3">
            Share of filings at each DOL prevailing-wage experience level (of{" "}
            {data.experienceLevelBreakdown.reduce((s, l) => s + l.filing_count, 0).toLocaleString()}{" "}
            filings with a level on record).
          </p>
          <div className="space-y-2">
            {data.experienceLevelBreakdown.map((lvl) => {
              const total = data.experienceLevelBreakdown.reduce((s, l) => s + l.filing_count, 0);
              const pct = total > 0 ? (lvl.filing_count / total) * 100 : 0;
              return (
                <div key={lvl.pw_wage_level} className="flex items-center gap-3 text-sm">
                  <span className="w-56 shrink-0 text-black/70 dark:text-white/70">
                    {pwLevelLabel(lvl.pw_wage_level)}
                  </span>
                  <div className="flex-1 h-4 bg-black/5 dark:bg-white/5 rounded overflow-hidden">
                    <div
                      className="h-full bg-foreground/70 rounded"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-black/60 dark:text-white/60">
                    {pct.toFixed(0)}%
                  </span>
                  <span className="w-24 shrink-0 text-right text-black/40 dark:text-white/40">
                    med {money(lvl.wage_median)}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Top sponsored job titles">
        <table className="w-full text-sm">
          <thead className="text-left text-black/50 dark:text-white/50">
            <tr>
              <th className="py-1 font-medium">Job title</th>
              <th className="py-1 font-medium text-right">Filings</th>
              <th className="py-1 font-medium text-right">Wage range (25th–75th pct)</th>
            </tr>
          </thead>
          <tbody>
            {data.topJobTitles.map((r) => (
              <tr key={r.job_title} className="border-t border-black/10 dark:border-white/10">
                <td className="py-1.5">{r.job_title}</td>
                <td className="py-1.5 text-right">{r.filing_count.toLocaleString()}</td>
                <td className="py-1.5 text-right">
                  {money(r.wage_p25)} – {money(r.wage_p75)}{" "}
                  <span className="text-black/40 dark:text-white/40">(med {money(r.wage_median)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Filing volume over time">
        <div className="flex items-end gap-1 h-32">
          {data.filingVolumeOverTime.map((v) => (
            <div key={v.quarter} className="flex flex-col items-center justify-end flex-1 min-w-6 h-full" title={`${v.quarter}: ${v.filing_count}`}>
              <div
                className="w-full bg-foreground/70 rounded-t"
                style={{ height: `${Math.max(4, (v.filing_count / maxVolume) * 112)}px` }}
              />
              <span className="text-[9px] text-black/40 dark:text-white/40 mt-1 rotate-0 whitespace-nowrap">
                {v.quarter}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Top worksite locations">
        <ul className="text-sm space-y-1">
          {data.topWorksites.map((w) => (
            <li key={`${w.worksite_state}-${w.worksite_city}`} className="flex justify-between border-t border-black/10 dark:border-white/10 py-1.5">
              <span>{w.worksite_city}, {w.worksite_state}</span>
              <span className="text-black/50 dark:text-white/50">{w.filing_count.toLocaleString()} filings</span>
            </li>
          ))}
        </ul>
      </Section>

      {data.nameVariants.length > 1 && (
        <Section title="Also filed as">
          <p className="text-xs text-black/50 dark:text-white/50">
            {data.nameVariants.map((v) => v.raw_name).join(" · ")}
          </p>
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded border-black/10 dark:border-white/10 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-black/40 dark:text-white/40">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}
