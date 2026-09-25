-- Migration: sl_alerts.one_shot (refinement #6)
-- Date: 2026-07-25
--
-- When true, the ticker-alerts cron pauses the alert (active=false) after it fires once,
-- instead of re-firing every 24h. Additive/non-destructive; defaults to the old behavior.

ALTER TABLE sl_alerts ADD COLUMN IF NOT EXISTS one_shot boolean NOT NULL DEFAULT false;
