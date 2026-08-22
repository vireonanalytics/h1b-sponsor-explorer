-- LCA disclosure data warehouse schema.
-- Authoritative DDL, executed by load_data.py after staging/dedup — safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS lca_filings CASCADE;
DROP TABLE IF EXISTS job_titles CASCADE;
DROP TABLE IF EXISTS employer_name_variants CASCADE;
DROP TABLE IF EXISTS employers CASCADE;

-- One row per legal employer entity, canonicalized primarily by federal EIN.
CREATE TABLE employers (
    employer_id     BIGSERIAL PRIMARY KEY,
    fein            TEXT UNIQUE,          -- federal tax ID; null only for the rare fuzzy-only fallback cluster
    canonical_name  TEXT NOT NULL,
    naics_code      TEXT
);

-- Every raw spelling of an employer name we saw, rolled up under its canonical employer.
CREATE TABLE employer_name_variants (
    employer_id       BIGINT NOT NULL REFERENCES employers(employer_id),
    raw_name          TEXT NOT NULL,
    occurrence_count  INT NOT NULL DEFAULT 1,
    PRIMARY KEY (employer_id, raw_name)
);

-- One row per distinct raw JOB_TITLE string, holding its sentence-transformers embedding
-- (populated by embed_job_titles.py, run after load_data.py).
CREATE TABLE job_titles (
    job_title_id      BIGSERIAL PRIMARY KEY,
    title_raw         TEXT UNIQUE NOT NULL,
    title_normalized  TEXT NOT NULL,
    embedding         vector(384)
);

-- Fact table: one row per LCA case (post-dedup: latest DECISION_DATE wins per CASE_NUMBER).
CREATE TABLE lca_filings (
    case_number             TEXT PRIMARY KEY,
    employer_id             BIGINT NOT NULL REFERENCES employers(employer_id),
    job_title_id            BIGINT NOT NULL REFERENCES job_titles(job_title_id),
    trade_name_dba          TEXT,
    visa_class               TEXT,
    case_status                TEXT,
    received_date               DATE,
    decision_date                 DATE,
    original_cert_date              DATE,
    begin_date                       DATE,
    end_date                          DATE,
    soc_code                          TEXT,
    soc_title                        TEXT,
    full_time_position               BOOLEAN,
    total_worker_positions           INT,
    wage_from                        NUMERIC(12, 2),
    wage_to                          NUMERIC(12, 2),
    wage_unit                        TEXT,
    wage_annualized                  NUMERIC(12, 2),
    prevailing_wage                  NUMERIC(12, 2),
    pw_unit                          TEXT,
    pw_annualized                    NUMERIC(12, 2),
    pw_wage_level                    TEXT,
    worksite_city                    TEXT,
    worksite_county                  TEXT,
    worksite_state                   TEXT,
    worksite_postal_code             TEXT,
    h1b_dependent                    TEXT,
    willful_violator                 TEXT,
    support_h1b                      TEXT,
    fiscal_year                      INT,
    fiscal_quarter                   INT,
    source_file                      TEXT
);

-- Search & filter indexes
CREATE INDEX idx_filings_employer       ON lca_filings (employer_id);
CREATE INDEX idx_filings_job_title      ON lca_filings (job_title_id);
CREATE INDEX idx_filings_worksite       ON lca_filings (worksite_state, worksite_city);
CREATE INDEX idx_filings_wage           ON lca_filings (wage_annualized);
CREATE INDEX idx_filings_decision_date  ON lca_filings (decision_date DESC);
CREATE INDEX idx_filings_soc_code       ON lca_filings (soc_code);
CREATE INDEX idx_filings_pw_wage_level  ON lca_filings (pw_wage_level);
-- No index on visa_class: this tool is H-1B only, so the column is single-valued
-- (kept only for provenance) and an index on it would have zero selectivity.

CREATE INDEX idx_employers_name_trgm    ON employers USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX idx_job_titles_raw_trgm    ON job_titles USING GIN (title_raw gin_trgm_ops);

-- Note: the HNSW vector index on job_titles.embedding is created by embed_job_titles.py,
-- after embeddings are populated (an index over an all-NULL column is useless).
