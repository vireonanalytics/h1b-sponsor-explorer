import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embed";

// Powers the role-explorer picker: given free text, find the closest matching
// SOC occupation codes (ranked by how many filings back them, for relevance).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    const { rows } = await pool.query(
      `SELECT soc_code, mode() WITHIN GROUP (ORDER BY soc_title) AS soc_title,
              count(*)::int AS filing_count
       FROM lca_filings WHERE soc_code IS NOT NULL
       GROUP BY soc_code ORDER BY filing_count DESC LIMIT 20`
    );
    return NextResponse.json({ results: rows });
  }

  const vec = await embedText(q);
  const vecLiteral = toVectorLiteral(vec);

  const { rows } = await pool.query(
    `WITH matched_titles AS (
       SELECT job_title_id FROM job_titles WHERE title_raw ILIKE $1
       UNION
       (SELECT job_title_id FROM job_titles
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector LIMIT 300)
     )
     SELECT f.soc_code, mode() WITHIN GROUP (ORDER BY f.soc_title) AS soc_title,
            count(*)::int AS filing_count
     FROM lca_filings f
     WHERE f.job_title_id IN (SELECT job_title_id FROM matched_titles) AND f.soc_code IS NOT NULL
     GROUP BY f.soc_code
     ORDER BY filing_count DESC LIMIT 20`,
    [`%${q}%`, vecLiteral]
  );
  return NextResponse.json({ results: rows });
}
