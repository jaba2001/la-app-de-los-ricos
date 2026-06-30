-- Migration: macro_state_history (daily snapshot log for historical-analog matching)
-- Date: 2026-06-30
--
-- Purpose: macro_state (id=1) is overwritten daily and has no history. This table adds an
-- append-only daily log of just the fields the Historical Analog feature needs to compare
-- "today" against "our own past" once enough rows accumulate. Written by the SAME
-- macro-refresh cron, same 11:00 UTC tick, right after the existing macro_state upsert.
-- Idempotent: ON CONFLICT (snapshot_date) DO UPDATE — re-running the cron same-day overwrites
-- that day's row instead of duplicating it (mirrors macro_state's own upsert semantics).
--
-- Deliberately THIN (not a clone of macro_state's ~70 columns): only the 5 composites +
-- regime + ic_score + vix are needed for the matching engine. spy_price is included for
-- future use but stays NULL today (macro-refresh is FRED-only, no equity quote source wired
-- into this cron yet).

CREATE TABLE IF NOT EXISTS macro_state_history (
  snapshot_date       date PRIMARY KEY,
  liquidity_cycle     numeric,
  credit_stress       numeric,
  recession_prob      numeric,
  geopolitical_risk   numeric,
  housing_stress      numeric,
  regime_id           text,
  ic_score            numeric,
  vix                 numeric,
  spy_price           numeric,   -- nullable; not fetched by the FRED-only cron today
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS macro_state_history_date_idx ON macro_state_history (snapshot_date DESC);
