-- Migration: macro_state research fields (Tier 1 — MASTER_PROMPT_MEJORAS_RESEARCH, F1)
-- Date: 2026-06-16
--
-- ADDITIVE ONLY. Every column is nullable and has no default beyond NULL, so:
--   • the existing macro-refresh upsert keeps working unchanged;
--   • rows written before this migration simply have NULLs in the new columns;
--   • nothing existing is renamed, dropped, or re-typed.
--
-- ⚠️ DEPLOY ORDER: apply THIS migration to Supabase BEFORE deploying the updated
-- ic-proxy. PostgREST rejects an upsert that references a column that does not
-- exist (HTTP 400), which would stall the working macro_state refresh. Apply
-- migration → verify columns exist → then deploy the cron.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS lets this run twice safely.

ALTER TABLE macro_state
  -- A1 — long rates & curve (dgs10/dgs30 are also the `rf` the Reverse DCF reads)
  ADD COLUMN IF NOT EXISTS dgs2                  numeric,
  ADD COLUMN IF NOT EXISTS dgs10                 numeric,
  ADD COLUMN IF NOT EXISTS dgs30                 numeric,
  ADD COLUMN IF NOT EXISTS term_premium_10y      numeric,   -- FRED THREEFYTP10
  ADD COLUMN IF NOT EXISTS curve_steepener       text,      -- 'bull'|'bear'|'flattening'|'flat'
  -- A3 — net liquidity (WALCL − TGA − RRP) in $T + direction, BoJ overlay
  ADD COLUMN IF NOT EXISTS net_liquidity_t       numeric,
  ADD COLUMN IF NOT EXISTS net_liquidity_dir     text,      -- 'expanding'|'contracting'|'flat'
  ADD COLUMN IF NOT EXISTS boj_assets            numeric,   -- FRED JPNASSETS
  -- A2 — recession gate inputs (data only; regime effect is flag-gated server-side)
  ADD COLUMN IF NOT EXISTS claims_trend          text,      -- 'rising'|'falling'|'stable'
  ADD COLUMN IF NOT EXISTS profits_trend         text,      -- 'rising'|'falling'|'flat'
  ADD COLUMN IF NOT EXISTS recession_gate_active boolean,
  -- A4 — private-credit proxy (BIZD/BKLN) + hidden-stress divergence flag
  ADD COLUMN IF NOT EXISTS credit_private_proxy  numeric,   -- avg % change of BIZD/BKLN
  ADD COLUMN IF NOT EXISTS credit_divergence     boolean;   -- HY tight but proxy weak
