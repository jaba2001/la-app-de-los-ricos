-- Migration: ai_audit_log — token usage + estimated cost (Fase 7)
-- Date: 2026-07-29
--
-- Purpose: Anthropic is the app's only variable cost (~€10/month today) and the only one
-- that scales with users. Every response already carries token counts; we were discarding
-- them. Persisting them here makes "which module is eating the budget, and is the free
-- tier's 1-analysis/day sustainable?" answerable from data instead of from guesswork.
--
-- est_cost_usd is TELEMETRY, never billing — Anthropic's invoice is the source of truth.
-- It is computed client-side in lib/proxy.ts (estimateCostUsd) from published per-MTok
-- prices, so it drifts if prices change; treat it as an order-of-magnitude figure.
--
-- Additive & non-destructive: every column is nullable, so existing rows stay valid and
-- the app writes fine before OR after this runs (lib/proxy.ts retries without these
-- columns if they're absent).

ALTER TABLE ai_audit_log ADD COLUMN IF NOT EXISTS input_tokens      integer;
ALTER TABLE ai_audit_log ADD COLUMN IF NOT EXISTS output_tokens     integer;
ALTER TABLE ai_audit_log ADD COLUMN IF NOT EXISTS cache_read_tokens integer;
ALTER TABLE ai_audit_log ADD COLUMN IF NOT EXISTS est_cost_usd      numeric(12, 6);

-- Cost-per-module / cost-per-day queries scan by time and group by module.
CREATE INDEX IF NOT EXISTS ai_audit_log_created_module_idx
  ON ai_audit_log (created_at DESC, module);

-- Spend by module over the last 30 days:
--   SELECT module,
--          count(*)                AS calls,
--          sum(input_tokens)       AS in_tok,
--          sum(output_tokens)      AS out_tok,
--          round(sum(est_cost_usd), 4) AS usd
--     FROM ai_audit_log
--    WHERE created_at > now() - interval '30 days'
--    GROUP BY module
--    ORDER BY usd DESC NULLS LAST;
