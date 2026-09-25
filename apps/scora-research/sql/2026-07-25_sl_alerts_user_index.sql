-- Migration: sl_alerts user/ticker covering index (perf advisory follow-up)
-- Date: 2026-07-25
--
-- Covers the sl_alerts(user_id) foreign key + the AlertConfig load query (user_id + ticker),
-- matching sl_journal's (user_id, ticker) index. Resolves the unindexed_foreign_keys advisory
-- for sl_alerts. Additive; the table is tiny so the build is instant.

CREATE INDEX IF NOT EXISTS sl_alerts_user_ticker_idx ON sl_alerts (user_id, ticker);
