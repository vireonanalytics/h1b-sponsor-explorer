import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employerId = Number(id);
  if (!Number.isInteger(employerId)) {
    return NextResponse.json({ error: "invalid employer id" }, { status: 400 });
  }

  const employerQ = pool.query(
    `SELECT employer_id, canonical_name, fein, naics_code FROM employers WHERE employer_id = $1`,
    [employerId]
  );
  const variantsQ = pool.query(
    `SELECT raw_name, occurrence_count FROM employer_name_variants
     WHERE employer_id = $1 ORDER BY occurrence_count DESC LIMIT 10`,
    [employerId]
  );
  const summaryQ = pool.query(
    `SELECT
       count(*)::int AS filing_count,
       count(DISTINCT job_title_id)::int AS distinct_job_titles,
       to_char(max(decision_date), 'YYYY-MM-DD') AS most_recent_filing_date,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p25,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annualized) AS wage_median,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY wage_annualized) AS wage_p75
     FROM lca_filings WHERE employer_id = $1`,
    [employerId]
  );
  const topRolesQ = pool.query(
    `SELECT jt.title_raw AS job_title,
            count(*)::int AS filing_count,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_p25,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_median,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_p75
     FROM lca_filings f JOIN job_titles jt ON jt.job_title_id = f.job_title_id
     WHERE f.employer_id = $1
     GROUP BY jt.job_title_id, jt.title_raw
     ORDER BY filing_count DESC LIMIT 15`,
    [employerId]
  );
  const experienceLevelQ = pool.query(
    `SELECT pw_wage_level,
            count(*)::int AS filing_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annualized) AS wage_median
     FROM lca_filings
     WHERE employer_id = $1 AND pw_wage_level IN ('I', 'II', 'III', 'IV')
     GROUP BY pw_wage_level
     ORDER BY pw_wage_level`,
    [employerId]
  );
  const volumeOverTimeQ = pool.query(
    `SELECT to_char(date_trunc('quarter', decision_date), 'YYYY-"Q"Q') AS quarter,
            count(*)::int AS filing_count
     FROM lca_filings WHERE employer_id = $1 AND decision_date IS NOT NULL
     GROUP BY 1 ORDER BY 1`,
    [employerId]
  );
  const locationsQ = pool.query(
    `SELECT worksite_state, worksite_city, count(*)::int AS filing_count
     FROM lca_filings WHERE employer_id = $1 AND worksite_state IS NOT NULL
     GROUP BY worksite_state, worksite_city
     ORDER BY filing_count DESC LIMIT 10`,
    [employerId]
  );

  const [employerR, variantsR, summaryR, topRolesR, experienceLevelR, volumeR, locationsR] =
    await Promise.all([
      employerQ, variantsQ, summaryQ, topRolesQ, experienceLevelQ, volumeOverTimeQ, locationsQ,
    ]);

  if (employerR.rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    employer: employerR.rows[0],
    nameVariants: variantsR.rows,
    summary: summaryR.rows[0],
    topJobTitles: topRolesR.rows,
    experienceLevelBreakdown: experienceLevelR.rows,
    filingVolumeOverTime: volumeR.rows,
    topWorksites: locationsR.rows,
  });
}
