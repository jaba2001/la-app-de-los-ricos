-- Migration: sl_alerts (per-ticker per-user alerts — P0-4)
-- Date: 2026-07-24
--
-- Per-user price / rating / valuation alerts on a ticker. RLS mirrors sl_watchlist (owner-only
-- ALL). The ticker-alerts cron reads this with the SERVICE key (bypasses RLS) to evaluate the
-- price_* kinds against live quotes and Web-Push to that user's subscriptions. The in-app UI
-- also evaluates rating_buy / rdcf_cheap live on the stock page. Additive/non-destructive.

CREATE TABLE IF NOT EXISTS sl_alerts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker            text NOT NULL,
  kind              text NOT NULL,        -- 'price_above' | 'price_below' | 'rating_buy' | 'rdcf_cheap'
  threshold         numeric,              -- price for price_* kinds; null otherwise
  note              text,
  active            boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  last_value        numeric,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sl_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sl_alerts_owner ON sl_alerts;
CREATE POLICY sl_alerts_owner ON sl_alerts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS sl_alerts_active_idx ON sl_alerts (active, ticker) WHERE active;
