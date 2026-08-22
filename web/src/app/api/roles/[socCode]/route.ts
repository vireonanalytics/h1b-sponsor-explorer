import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Wage percentiles for one SOC occupation code, broken down by employer and by
// worksite state. Aggregating at the SOC-code level (rather than one exact raw
// job-title string) gives statistically meaningful percentiles across the many
// employer-specific title spellings that share the same standardized occupation.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ socCode: string }> }
) {
  const { socCode } = await params;
  const state = req.nextUrl.searchParams.get("state")?.trim() || null;

  const baseWhere = state
    ? `f.soc_code = $1 AND f.worksite_state = $2`
    : `f.soc_code = $1`;
  const baseParams = state ? [socCode, state.toUpperCase()] : [socCode];

  const overallQ = pool.query(
    // soc_title is free text pulled per-filing and can vary in spelling for the same
    // soc_code, so it must not be a GROUP BY key here -- mode() picks the most common
    // spelling as a label while the aggregates below span every matching row.
    `SELECT mode() WITHIN GROUP (ORDER BY soc_title) AS soc_title,
            count(*)::int AS filing_count,
            percentile_cont(0.1) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p10,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p25,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annualized) AS wage_median,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p75,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p90
     FROM lca_filings f WHERE ${baseWhere}`,
    baseParams
  );

  const byLevelQ = pool.query(
    // Mixing all experience levels into one percentile band is misleading (an
    // entry-level and a senior filing for the "same" role can differ 2x+ in pay),
    // so break percentiles out per DOL wage level as well as the overall figure.
    `SELECT pw_wage_level,
            count(*)::int AS filing_count,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p25,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annualized) AS wage_median,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p75
     FROM lca_filings f
     WHERE ${baseWhere} AND pw_wage_level IN ('I', 'II', 'III', 'IV')
     GROUP BY pw_wage_level
     ORDER BY pw_wage_level`,
    baseParams
  );

  const byCompanyQ = pool.query(
    `SELECT e.employer_id, e.canonical_name AS employer_name,
            count(*)::int AS filing_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_median
     FROM lca_filings f JOIN employers e ON e.employer_id = f.employer_id
     WHERE ${baseWhere}
     GROUP BY e.employer_id, e.canonical_name
     ORDER BY filing_count DESC LIMIT 20`,
    baseParams
  );

  const byRegionQ = pool.query(
    `SELECT worksite_state,
            count(*)::int AS filing_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annualized) AS wage_median
     FROM lca_filings f WHERE soc_code = $1 AND worksite_state IS NOT NULL
     GROUP BY worksite_state
     ORDER BY filing_count DESC LIMIT 20`,
    [socCode]
  );

  const [overallR, byLevelR, byCompanyR, byRegionR] = await Promise.all([
    overallQ, byLevelQ, byCompanyQ, byRegionQ,
  ]);

  if (overallR.rows.length === 0) {
    return NextResponse.json({ error: "no filings found for this SOC code" }, { status: 404 });
  }

  return NextResponse.json({
    socCode,
    overall: overallR.rows[0],
    byLevel: byLevelR.rows,
    byCompany: byCompanyR.rows,
    byRegion: byRegionR.rows,
  });
}
