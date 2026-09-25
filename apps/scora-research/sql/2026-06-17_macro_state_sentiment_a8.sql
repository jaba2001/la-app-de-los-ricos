-- Migration: macro_state sentiment fields (A8 — MEJORAS_RESEARCH)
-- Date: 2026-06-17
--
-- ADDITIVE ONLY, nullable. Source: CNN Fear & Greed (CBOE put/call + composite
-- contrarian gauge), cached by the cron. Apply BEFORE deploying the updated cron.
-- Idempotent.

ALTER TABLE macro_state
  ADD COLUMN IF NOT EXISTS put_call_ratio    numeric,  -- CBOE put/call (via CNN F&G)
  ADD COLUMN IF NOT EXISTS fear_greed        numeric,  -- CNN Fear & Greed 0-100
  ADD COLUMN IF NOT EXISTS fear_greed_rating text,     -- 'extreme fear'..'extreme greed'
  ADD COLUMN IF NOT EXISTS sentiment_signal  text;     -- contrarian: 'euforia'|'panico'|'neutral'
