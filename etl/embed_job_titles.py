"""Compute sentence-transformers embeddings for every distinct job title and build
the HNSW ANN index for semantic search. Run once, after load_data.py.

Local model only (all-MiniLM-L6-v2, ~80MB, downloaded once from Hugging Face and then
cached on disk) -- no external API calls, no per-request cost, works offline after
the first run.

Usage:
    python3 embed_job_titles.py --dsn "dbname=h1b_explorer"
"""
import argparse

import psycopg2
import psycopg2.extras
import torch
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"
BATCH_SIZE = 512


def pick_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="dbname=h1b_explorer")
    args = ap.parse_args()

    device = pick_device()
    print(f"Loading {MODEL_NAME} on device={device}...")
    model = SentenceTransformer(MODEL_NAME, device=device)

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()
    cur.execute(
        "SELECT job_title_id, title_normalized FROM job_titles WHERE embedding IS NULL;"
    )
    rows = cur.fetchall()
    print(f"Embedding {len(rows):,} distinct job titles...")

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        ids = [r[0] for r in batch]
        titles = [r[1] for r in batch]
        vectors = model.encode(titles, batch_size=BATCH_SIZE, show_progress_bar=False,
                                normalize_embeddings=True)
        updates = [(vec.tolist(), jid) for vec, jid in zip(vectors, ids)]
        psycopg2.extras.execute_batch(
            cur, "UPDATE job_titles SET embedding = %s WHERE job_title_id = %s", updates
        )
        conn.commit()
        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  {min(i + BATCH_SIZE, len(rows)):,} / {len(rows):,}")

    print("Building HNSW index for cosine similarity search...")
    cur.execute("DROP INDEX IF EXISTS idx_job_titles_embedding;")
    cur.execute(
        "CREATE INDEX idx_job_titles_embedding ON job_titles "
        "USING hnsw (embedding vector_cosine_ops);"
    )
    conn.commit()

    cur.close()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
