import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Cache in memory for the life of the server process -- this only changes when
// the dataset is reloaded, not per-request.
let cached: { totalFilings: number; dataAsOf: string | null } | null = null;

export async function GET() {
  if (!cached) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total_filings,
              to_char(max(decision_date), 'YYYY-MM-DD') AS data_as_of
       FROM lca_filings`
    );
    cached = { totalFilings: rows[0].total_filings, dataAsOf: rows[0].data_as_of };
  }
  return NextResponse.json(cached);
}
