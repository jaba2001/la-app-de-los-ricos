-- Migration: macro_state research fields TIER 2 (A5/A6/A7 — MEJORAS_RESEARCH, F3)
-- Date: 2026-06-17
--
-- ADDITIVE ONLY (same rules as the Tier 1 migration): every column is nullable,
-- nothing existing is renamed/dropped. Apply BEFORE deploying the updated cron,
-- or PostgREST rejects the upsert (HTTP 400) and stalls the macro_state refresh.
-- Idempotent via ADD COLUMN IF NOT EXISTS.

ALTER TABLE macro_state
  -- A5 — Fed reaction function ("good news is bad news")
  ADD COLUMN IF NOT EXISTS fed_room            text,     -- 'constrained'|'neutral'|'room'
  ADD COLUMN IF NOT EXISTS core_pce_yoy        numeric,  -- FRED PCEPILFE % YoY
  ADD COLUMN IF NOT EXISTS unrate              numeric,  -- FRED UNRATE level
  -- A6 — oil shock (WTI only; Cushing/SPR deferred — not on FRED)
  ADD COLUMN IF NOT EXISTS oil_shock           boolean,
  ADD COLUMN IF NOT EXISTS wti_level           numeric,
  ADD COLUMN IF NOT EXISTS wti_chg_1m          numeric,  -- % move over ~1 month
  -- A7 — Buffett indicator → expected 10y return
  ADD COLUMN IF NOT EXISTS buffett_indicator   numeric,  -- NCBEILQ027S / GDP, %
  ADD COLUMN IF NOT EXISTS expected_return_10y numeric;  -- annualized %, derived
