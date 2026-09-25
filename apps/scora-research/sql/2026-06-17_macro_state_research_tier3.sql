-- Migration: macro_state research fields TIER 3 (global liquidity — MEJORAS_RESEARCH, F4)
-- Date: 2026-06-17
--
-- ADDITIVE ONLY, nullable. Apply BEFORE deploying the updated cron (PostgREST
-- rejects upserts referencing missing columns). Idempotent.

ALTER TABLE macro_state
  ADD COLUMN IF NOT EXISTS ecb_assets           numeric,  -- FRED ECBASSETSW (€M)
  ADD COLUMN IF NOT EXISTS global_liquidity_dir text;     -- 'expanding'|'contracting'|'mixed' (US+ECB+BoJ vote)
