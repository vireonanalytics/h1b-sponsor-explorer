import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embed";
import { VALID_PW_LEVELS } from "@/lib/wageLevels";

const SEMANTIC_CANDIDATE_LIMIT = 300;
const SEMANTIC_DISTANCE_MAX = 0.6; // cosine distance; lower = more similar
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const jobTitle = sp.get("jobTitle")?.trim() || null;
  const company = sp.get("company")?.trim() || null;
  const location = sp.get("location")?.trim() || null;
  const pwLevels = (sp.get("pwLevel") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => VALID_PW_LEVELS.has(v));
  const minWage = sp.get("minWage") ? Number(sp.get("minWage")) : null;
  const maxWage = sp.get("maxWage") ? Number(sp.get("maxWage")) : null;
  const sort = sp.get("sort") || "filing_count";
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get("pageSize") || DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  if (!jobTitle && !company && !location && pwLevels.length === 0) {
    // An unfiltered GROUP BY over 1.5M+ rows (with 3 percentile_cont aggregates and a
    // window count) takes several seconds — require at least one filter.
    return NextResponse.json(
      { error: "at least one of jobTitle, company, location, or pwLevel is required" },
      { status: 400 }
    );
  }

  const where: string[] = [];
  const params: unknown[] = [];

  if (company) {
    params.push(`%${company}%`);
    where.push(`e.canonical_name ILIKE $${params.length}`);
  }
  if (location) {
    params.push(`%${location}%`);
    const cityIdx = params.length;
    params.push(location.toUpperCase());
    const stateIdx = params.length;
    where.push(`(f.worksite_city ILIKE $${cityIdx} OR f.worksite_state = $${stateIdx})`);
  }
  if (pwLevels.length > 0) {
    params.push(pwLevels);
    where.push(`f.pw_wage_level = ANY($${params.length}::text[])`);
  }
  if (minWage != null && !Number.isNaN(minWage)) {
    params.push(minWage);
    where.push(`f.wage_annualized >= $${params.length}`);
  }
  if (maxWage != null && !Number.isNaN(maxWage)) {
    params.push(maxWage);
    where.push(`f.wage_annualized <= $${params.length}`);
  }

  let jobTitleIdsCte = "";
  if (jobTitle) {
    const vec = await embedText(jobTitle);
    const vecLiteral = toVectorLiteral(vec);
    params.push(`%${jobTitle}%`);
    const trgmIdx = params.length;
    params.push(vecLiteral);
    const vecIdx = params.length;
    params.push(SEMANTIC_DISTANCE_MAX);
    const distIdx = params.length;
    params.push(SEMANTIC_CANDIDATE_LIMIT);
    const limitIdx = params.length;

    jobTitleIdsCte = `
      matched_titles AS (
        SELECT job_title_id FROM job_titles WHERE title_raw ILIKE $${trgmIdx}
        UNION
        (SELECT job_title_id FROM job_titles
         WHERE embedding IS NOT NULL AND (embedding <=> $${vecIdx}::vector) < $${distIdx}
         ORDER BY embedding <=> $${vecIdx}::vector
         LIMIT $${limitIdx})
      ),`;
    where.push(`f.job_title_id IN (SELECT job_title_id FROM matched_titles)`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortSql =
    {
      filing_count: "filing_count DESC",
      wage_median: "wage_median DESC NULLS LAST",
      most_recent: "most_recent_filing_date DESC NULLS LAST",
    }[sort] ?? "filing_count DESC";

  const query = `
    WITH ${jobTitleIdsCte}
    grouped AS (
      SELECT
        e.employer_id, e.canonical_name AS employer_name,
        jt.job_title_id, jt.title_raw AS job_title,
        count(*)::int AS filing_count,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_p25,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY f.wage_annualized) AS wage_p75,
        to_char(max(f.decision_date), 'YYYY-MM-DD') AS most_recent_filing_date
      FROM lca_filings f
      JOIN employers e ON e.employer_id = f.employer_id
      JOIN job_titles jt ON jt.job_title_id = f.job_title_id
      ${whereSql}
      GROUP BY e.employer_id, e.canonical_name, jt.job_title_id, jt.title_raw
    )
    SELECT *, count(*) OVER() AS total_count
    FROM grouped
    ORDER BY ${sortSql}
    LIMIT ${pageSize} OFFSET ${offset};
  `;

  try {
    const { rows } = await pool.query(query, params);
    const totalCount = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    return NextResponse.json({
      results: rows.map((r) => ({
        employerId: r.employer_id,
        employerName: r.employer_name,
        jobTitleId: r.job_title_id,
        jobTitle: r.job_title,
        filingCount: r.filing_count,
        wageP25: r.wage_p25,
        wageMedian: r.wage_median,
        wageP75: r.wage_p75,
        mostRecentFilingDate: r.most_recent_filing_date,
      })),
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
