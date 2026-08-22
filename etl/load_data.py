"""One-time ETL: read all DOL LCA disclosure xlsx files, reconcile schema,
dedupe cross-quarter case updates, canonicalize employers, and load into Postgres.
H-1B only -- E-3 and H-1B1 filings are filtered out at load time (see load_file()).

Usage:
    python3 load_data.py --data-dir ~/Downloads --dsn "dbname=h1b_explorer"
"""
import argparse
import io
import os
import sys
import time

import psycopg2
from python_calamine import CalamineWorkbook

from canonical_schema import (
    build_column_index,
    clean_text,
    normalize_job_title,
    normalize_soc_code,
    parse_bool_yn,
    parse_date,
    parse_fein,
    parse_int,
    parse_numeric,
    annualize,
)

# (filename, fiscal_year, fiscal_quarter) in chronological order.
FILES = [
    ("LCA_Disclosure_Data_FY2024_Q1.xlsx", 2024, 1),
    ("LCA_Disclosure_Data_FY2024_Q2.xlsx", 2024, 2),
    ("LCA_Disclosure_Data_FY2024_Q3.xlsx", 2024, 3),
    ("LCA_Disclosure_Data_FY2024_Q4.xlsx", 2024, 4),
    ("LCA_Disclosure_Data_FY2025_Q1.xlsx", 2025, 1),
    ("LCA_Disclosure_Data_FY2025_Q2.xlsx", 2025, 2),
    ("LCA_Disclosure_Data_FY2025_Q3.xlsx", 2025, 3),
    ("LCA_Disclosure_Data_FY2025_Q4.xlsx", 2025, 4),
    ("LCA_Disclosure_Data_FY2026_Q3.xlsx", 2026, 3),
]

STAGE_COLUMNS = [
    "stage_id", "case_number", "case_status", "received_date", "decision_date",
    "original_cert_date", "visa_class", "job_title_raw", "job_title_normalized",
    "soc_code", "soc_title", "full_time_position", "begin_date", "end_date",
    "total_worker_positions", "employer_name_raw", "employer_fein", "trade_name_dba",
    "naics_code", "worksite_city", "worksite_county", "worksite_state",
    "worksite_postal_code", "wage_from", "wage_to", "wage_unit", "wage_annualized",
    "prevailing_wage", "pw_unit", "pw_annualized", "pw_wage_level", "h1b_dependent",
    "willful_violator", "support_h1b", "fiscal_year", "fiscal_quarter", "source_file",
]

CHUNK_SIZE = 50_000


def esc(v):
    """Escape one value for Postgres COPY TEXT format."""
    if v is None:
        return "\\N"
    s = str(v)
    return (
        s.replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def transform_row(row, idx, fiscal_year, fiscal_quarter, source_file, stage_id):
    def get(field):
        return row[idx[field]]

    wage_unit = clean_text(get("wage_unit"))
    pw_unit = clean_text(get("pw_unit"))
    wage_from = parse_numeric(get("wage_from"))
    prevailing_wage = parse_numeric(get("prevailing_wage"))
    job_title_raw = clean_text(get("job_title_raw"))

    return [
        stage_id,
        clean_text(get("case_number")),
        clean_text(get("case_status")),
        parse_date(get("received_date")),
        parse_date(get("decision_date")),
        parse_date(get("original_cert_date")),
        clean_text(get("visa_class")),
        job_title_raw,
        normalize_job_title(job_title_raw),
        normalize_soc_code(get("soc_code")),
        clean_text(get("soc_title")),
        parse_bool_yn(get("full_time_position")),
        parse_date(get("begin_date")),
        parse_date(get("end_date")),
        parse_int(get("total_worker_positions")),
        clean_text(get("employer_name_raw")),
        parse_fein(get("employer_fein")),
        clean_text(get("trade_name_dba")),
        clean_text(get("naics_code")),
        clean_text(get("worksite_city")),
        clean_text(get("worksite_county")),
        clean_text(get("worksite_state")),
        clean_text(get("worksite_postal_code")),
        wage_from,
        parse_numeric(get("wage_to")),
        wage_unit,
        annualize(wage_from, wage_unit),
        prevailing_wage,
        pw_unit,
        annualize(prevailing_wage, pw_unit),
        clean_text(get("pw_wage_level")),
        clean_text(get("h1b_dependent")),
        clean_text(get("willful_violator")),
        clean_text(get("support_h1b")),
        fiscal_year,
        fiscal_quarter,
        source_file,
    ]


def create_staging_table(cur):
    cur.execute("DROP TABLE IF EXISTS lca_filings_stage;")
    cur.execute(
        """
        CREATE TABLE lca_filings_stage (
            stage_id BIGINT,
            case_number TEXT,
            case_status TEXT,
            received_date DATE,
            decision_date DATE,
            original_cert_date DATE,
            visa_class TEXT,
            job_title_raw TEXT,
            job_title_normalized TEXT,
            soc_code TEXT,
            soc_title TEXT,
            full_time_position BOOLEAN,
            begin_date DATE,
            end_date DATE,
            total_worker_positions INT,
            employer_name_raw TEXT,
            employer_fein TEXT,
            trade_name_dba TEXT,
            naics_code TEXT,
            worksite_city TEXT,
            worksite_county TEXT,
            worksite_state TEXT,
            worksite_postal_code TEXT,
            wage_from NUMERIC(12,2),
            wage_to NUMERIC(12,2),
            wage_unit TEXT,
            wage_annualized NUMERIC(12,2),
            prevailing_wage NUMERIC(12,2),
            pw_unit TEXT,
            pw_annualized NUMERIC(12,2),
            pw_wage_level TEXT,
            h1b_dependent TEXT,
            willful_violator TEXT,
            support_h1b TEXT,
            fiscal_year INT,
            fiscal_quarter INT,
            source_file TEXT
        );
        """
    )


def load_file(cur, path, fiscal_year, fiscal_quarter, stage_id_start):
    t0 = time.time()
    wb = CalamineWorkbook.from_path(path)
    sheet = wb.get_sheet_by_name(wb.sheet_names[0])
    data = sheet.to_python()
    header, rows = data[0], data[1:]
    idx = build_column_index(header)
    source_file = os.path.basename(path)

    visa_idx = idx["visa_class"]
    stage_id = stage_id_start
    buf = io.StringIO()
    n_written = 0
    n_skipped = 0
    for i, row in enumerate(rows):
        # This tool covers H-1B only -- E-3 and H-1B1 filings are dropped at load time.
        if clean_text(row[visa_idx]) != "H-1B":
            n_skipped += 1
            continue
        transformed = transform_row(row, idx, fiscal_year, fiscal_quarter, source_file, stage_id)
        buf.write("\t".join(esc(v) for v in transformed) + "\n")
        stage_id += 1
        if (i + 1) % CHUNK_SIZE == 0:
            buf.seek(0)
            cur.copy_expert(
                f"COPY lca_filings_stage ({', '.join(STAGE_COLUMNS)}) FROM STDIN", buf
            )
            n_written += CHUNK_SIZE
            buf = io.StringIO()
    if buf.tell() > 0:
        buf.seek(0)
        cur.copy_expert(f"COPY lca_filings_stage ({', '.join(STAGE_COLUMNS)}) FROM STDIN", buf)

    print(f"  loaded {stage_id - stage_id_start:,} H-1B rows from {source_file} "
          f"({n_skipped:,} non-H-1B rows skipped) in {time.time()-t0:.1f}s")
    return stage_id


def reconcile(cur):
    print("Deduplicating (keep latest DECISION_DATE per CASE_NUMBER)...")
    cur.execute("DROP TABLE IF EXISTS lca_filings_dedup;")
    cur.execute(
        """
        CREATE TABLE lca_filings_dedup AS
        SELECT DISTINCT ON (case_number) *
        FROM lca_filings_stage
        ORDER BY case_number, decision_date DESC NULLS LAST, stage_id DESC;
        """
    )
    cur.execute("SELECT count(*) FROM lca_filings_stage;")
    n_stage = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM lca_filings_dedup;")
    n_dedup = cur.fetchone()[0]
    print(f"  {n_stage:,} raw rows -> {n_dedup:,} unique cases "
          f"({n_stage - n_dedup:,} superseded records dropped)")

    print("Applying schema.sql (creates employers, employer_name_variants, job_titles, "
          "lca_filings, and their indexes)...")
    with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
        cur.execute(f.read())

    print("Building canonical employers (grouped by FEIN, fuzzy fallback for the rest)...")
    cur.execute(
        """
        INSERT INTO employers (fein, canonical_name, naics_code)
        SELECT fein, canonical_name, naics_code FROM (
            SELECT
                employer_fein AS fein,
                mode() WITHIN GROUP (ORDER BY employer_name_raw) AS canonical_name,
                mode() WITHIN GROUP (ORDER BY naics_code) AS naics_code
            FROM lca_filings_dedup
            WHERE employer_fein IS NOT NULL
            GROUP BY employer_fein
        ) t;
        """
    )
    cur.execute("SELECT count(*) FROM employers;")
    print(f"  {cur.fetchone()[0]:,} employers canonicalized by FEIN")

    cur.execute(
        """
        INSERT INTO employer_name_variants (employer_id, raw_name, occurrence_count)
        SELECT e.employer_id, d.employer_name_raw, count(*)
        FROM lca_filings_dedup d
        JOIN employers e ON e.fein = d.employer_fein
        GROUP BY e.employer_id, d.employer_name_raw;
        """
    )

    return cur


def handle_missing_fein_employers(conn, cur):
    """Fuzzy-cluster the (expected to be rare) rows with no usable FEIN.

    Deliberately does NOT try to reattach these to an existing real-FEIN employer
    by exact name-string match: QA on the FY2024-2026 data found generic names
    (e.g. "TechCorp Solutions Inc.") that are independently used by more than one
    real, differently-FEIN'd company, and some real filings that appear to have
    self-reported another company's FEIN by filer error. Exact-name reattachment
    would silently create new false-positive merges of the kind this fallback
    path exists to avoid. A handful of these rows end up as small standalone
    employers instead of being folded back into their "true" parent (e.g. ~19 of
    Amazon.com Services LLC's ~44,000 filings) -- an intentional, disclosed
    trade-off: understating one employer's count by <0.05% beats risking a
    false merge between two unrelated ones.
    """
    from rapidfuzz import fuzz, process

    cur.execute(
        "SELECT DISTINCT employer_name_raw FROM lca_filings_dedup WHERE employer_fein IS NULL;"
    )
    names = [r[0] for r in cur.fetchall() if r[0]]
    if not names:
        print("No rows with missing FEIN — fuzzy fallback not needed.")
        return

    print(f"Fuzzy-clustering {len(names):,} employer names with missing/invalid FEIN...")
    clusters = []  # list of [canonical_name, [members]]
    for name in names:
        match = None
        if clusters:
            best = process.extractOne(
                name, [c[0] for c in clusters], scorer=fuzz.token_sort_ratio, score_cutoff=92
            )
            if best:
                match = best[2]  # index into clusters
        if match is not None:
            clusters[match][1].append(name)
        else:
            clusters.append([name, [name]])

    for canonical_name, members in clusters:
        cur.execute(
            "INSERT INTO employers (fein, canonical_name, naics_code) VALUES (NULL, %s, NULL) "
            "RETURNING employer_id",
            (canonical_name,),
        )
        employer_id = cur.fetchone()[0]
        for m in members:
            cur.execute(
                "INSERT INTO employer_name_variants (employer_id, raw_name, occurrence_count) "
                "VALUES (%s, %s, ("
                "  SELECT count(*) FROM lca_filings_dedup "
                "  WHERE employer_fein IS NULL AND employer_name_raw = %s"
                ")) ON CONFLICT DO NOTHING",
                (employer_id, m, m),
            )
    conn.commit()
    print(f"  {len(clusters):,} fuzzy employer clusters created")


def build_job_titles_and_filings(cur):
    print("Populating job_titles dimension...")
    cur.execute(
        """
        INSERT INTO job_titles (title_raw, title_normalized)
        SELECT DISTINCT ON (job_title_raw) job_title_raw, job_title_normalized
        FROM lca_filings_dedup
        WHERE job_title_raw IS NOT NULL;
        """
    )
    cur.execute("SELECT count(*) FROM job_titles;")
    print(f"  {cur.fetchone()[0]:,} distinct job titles")

    print("Populating final lca_filings fact table...")
    cur.execute(
        """
        INSERT INTO lca_filings
        SELECT
            d.case_number, e.employer_id, jt.job_title_id, d.trade_name_dba, d.visa_class,
            d.case_status, d.received_date, d.decision_date, d.original_cert_date,
            d.begin_date, d.end_date, d.soc_code, d.soc_title, d.full_time_position,
            d.total_worker_positions, d.wage_from, d.wage_to, d.wage_unit, d.wage_annualized,
            d.prevailing_wage, d.pw_unit, d.pw_annualized, d.pw_wage_level, d.worksite_city,
            d.worksite_county, d.worksite_state, d.worksite_postal_code, d.h1b_dependent,
            d.willful_violator, d.support_h1b, d.fiscal_year, d.fiscal_quarter, d.source_file
        FROM lca_filings_dedup d
        JOIN employers e ON (
            (d.employer_fein IS NOT NULL AND e.fein = d.employer_fein)
            OR (d.employer_fein IS NULL AND e.fein IS NULL AND e.employer_id = (
                SELECT env.employer_id FROM employer_name_variants env
                JOIN employers e2 ON e2.employer_id = env.employer_id AND e2.fein IS NULL
                WHERE env.raw_name = d.employer_name_raw LIMIT 1
            ))
        )
        JOIN job_titles jt ON jt.title_raw = d.job_title_raw;
        """
    )
    cur.execute("SELECT count(*) FROM lca_filings;")
    print(f"  {cur.fetchone()[0]:,} rows in lca_filings")


def cleanup_staging(cur):
    cur.execute("DROP TABLE IF EXISTS lca_filings_stage;")
    cur.execute("DROP TABLE IF EXISTS lca_filings_dedup;")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--dsn", default="dbname=h1b_explorer")
    ap.add_argument("--keep-staging", action="store_true")
    ap.add_argument("--limit", type=int, default=None,
                     help="only process the first N files (for smoke-testing the pipeline)")
    args = ap.parse_args()

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    cur = conn.cursor()

    print("Creating staging table...")
    create_staging_table(cur)
    conn.commit()

    files = FILES[: args.limit] if args.limit else FILES
    stage_id = 0
    for fname, fy, fq in files:
        path = os.path.join(args.data_dir, fname)
        if not os.path.exists(path):
            print(f"WARNING: {path} not found, skipping", file=sys.stderr)
            continue
        stage_id = load_file(cur, path, fy, fq, stage_id)
        conn.commit()

    reconcile(cur)
    conn.commit()

    handle_missing_fein_employers(conn, cur)

    build_job_titles_and_filings(cur)
    conn.commit()

    if not args.keep_staging:
        cleanup_staging(cur)
        conn.commit()

    cur.close()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
