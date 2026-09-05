-- Migration: sl_analyses valuation multiples (P1-8)
-- Date: 2026-07-24
--
-- Persist raw valuation multiples alongside the scores so StockCompare can do real relative
-- valuation (P/E, EV/EBITDA, P/FCF, ROIC %, FCF yield %) across the watchlist instead of just
-- comparing sub-scores. All nullable & additive — existing rows read back as NULL, no backfill
-- needed (they populate on the next analyze/re-analyze).

ALTER TABLE sl_analyses
  ADD COLUMN IF NOT EXISTS pe        numeric,
  ADD COLUMN IF NOT EXISTS ev_ebitda numeric,
  ADD COLUMN IF NOT EXISTS pfcf      numeric,
  ADD COLUMN IF NOT EXISTS roic      numeric,   -- stored as percent
  ADD COLUMN IF NOT EXISTS fcf_yield numeric;   -- stored as percent
