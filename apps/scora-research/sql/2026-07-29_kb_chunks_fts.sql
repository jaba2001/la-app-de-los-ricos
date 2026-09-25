-- Migration: kb_chunks + full-text retrieval over 10-K filings (Fase 8)
-- Date: 2026-07-29
--
-- THE BUG THIS FIXES
-- kb_docs stores ONE row per 10-K section, capped at 2 200 chars by MAX_SECTION in
-- research/ingest_filings.mjs, and lib/knowledge.ts then injected only the first 1 500 of
-- that into the prompt. A 10-K's Risk Factors section runs to tens of pages, so the first
-- 1 500 characters are almost always the standard preamble ("The following risk factors
-- should be read in conjunction with…"). The grounded thesis was therefore citing the
-- HEADER of the risk section, never the risks — and reporting itself as "✓ grounded"
-- while doing it, because the grounding gate verifies NUMBERS, not qualitative text.
-- The gate is fine; what it was being fed was not.
--
-- THE FIX
-- Store the whole section as overlapping ~900-char chunks and retrieve the ones actually
-- relevant to the question, ranked by Postgres full-text search. No embeddings, no vector
-- database, no new vendor — this keeps the "everything free except the Anthropic API"
-- constraint intact. pgvector remains available in this same database if semantic recall
-- later proves necessary; FTS is the cheaper first step, not a dead end.
--
-- kb_docs is deliberately left in place: lib/knowledge.ts falls back to it when kb_chunks
-- has nothing for a ticker, so the app keeps working before the re-ingest is run.

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          text PRIMARY KEY,          -- <ticker>_<accession>_<Section>_<idx>, stable across re-ingests
  ticker      text NOT NULL,
  cik         text,
  form        text NOT NULL DEFAULT '10-K',
  accession   text,
  section     text NOT NULL,             -- 'Business' | 'Risk Factors' | 'MD&A'
  chunk_idx   integer NOT NULL,
  text        text NOT NULL,
  filed_date  date,
  fiscal_year integer,
  source_url  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Generated column: the index stays correct automatically on every insert/update,
  -- so no trigger to forget and no way for tsv to drift out of sync with text.
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx    ON kb_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS kb_chunks_ticker_idx ON kb_chunks (ticker, section, chunk_idx);

-- SEC filings are public information and the app reads them from the browser, so SELECT
-- is open. There is no write policy: only the ingest script (service_role) may write.
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_chunks_read ON kb_chunks;
CREATE POLICY kb_chunks_read ON kb_chunks FOR SELECT USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- search_kb_chunks — ranked retrieval, executed in the database.
--
-- Ranking lives here rather than in the client so the GIN index is actually used.
-- SECURITY INVOKER (the default) so the RLS policy above still applies to callers.
--
-- Two properties worth keeping:
--  1. SECTION DIVERSITY. A naive "top N by rank" returns eight Risk Factors chunks for a
--     risk-flavoured query and never mentions the business or the MD&A. The window
--     function takes the best p_per_section from each section instead, so the model
--     always sees a balanced view.
--  2. GRACEFUL EMPTY QUERY. With no query it degrades to document order (chunk_idx),
--     i.e. the old behaviour, rather than returning nothing.
--
-- websearch_to_tsquery is used because it never raises on user-ish input (plain words,
-- quotes, OR) — to_tsquery would throw on a stray operator and take the thesis down.
CREATE OR REPLACE FUNCTION search_kb_chunks(
  p_ticker      text,
  p_query       text DEFAULT NULL,
  p_per_section integer DEFAULT 3
)
RETURNS TABLE (
  ticker      text,
  form        text,
  section     text,
  chunk_idx   integer,
  text        text,
  filed_date  date,
  fiscal_year integer,
  rank        real
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT CASE
             WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
             ELSE websearch_to_tsquery('english', p_query)
           END AS tsq
  ),
  scored AS (
    SELECT c.ticker, c.form, c.section, c.chunk_idx, c.text, c.filed_date, c.fiscal_year,
           CASE WHEN q.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, q.tsq) END AS rank,
           ROW_NUMBER() OVER (
             PARTITION BY c.section
             ORDER BY CASE WHEN q.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, q.tsq) END DESC,
                      c.chunk_idx ASC
           ) AS rn
      FROM kb_chunks c CROSS JOIN q
     WHERE c.ticker = upper(p_ticker)
       AND (q.tsq IS NULL OR c.tsv @@ q.tsq)
  )
  SELECT ticker, form, section, chunk_idx, text, filed_date, fiscal_year, rank
    FROM scored
   WHERE rn <= GREATEST(p_per_section, 1)
   -- Risk Factors first: it is the section that most often carries the bear case, and
   -- ordering here mirrors the previous renderDocChunks behaviour.
   ORDER BY CASE section WHEN 'Risk Factors' THEN 0 WHEN 'MD&A' THEN 1 ELSE 2 END,
            rank DESC, chunk_idx ASC;
$$;

-- Sanity check after re-running research/ingest_filings.mjs:
--   SELECT ticker, section, count(*) FROM kb_chunks GROUP BY 1,2 ORDER BY 1,2;
--   SELECT section, left(text, 120) FROM search_kb_chunks('NVDA', 'customer concentration', 3);
