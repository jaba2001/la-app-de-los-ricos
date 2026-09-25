-- Migration: sl_journal (Trade Journal — P1-7)
-- Date: 2026-07-24
--
-- Purpose: the user's REAL trades, grouped by thesis, for P&L + attribution vs the regime
-- allocator (Scora's PaperFund is paper; this is the user's own book). RLS mirrors
-- sl_watchlist / sl_analyses exactly: a single owner-only ALL policy (auth.uid() = user_id).
-- Additive & non-destructive.

CREATE TABLE IF NOT EXISTS sl_journal (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      text NOT NULL,
  side        text NOT NULL DEFAULT 'buy',         -- 'buy' | 'sell'
  shares      numeric NOT NULL CHECK (shares > 0),
  price       numeric NOT NULL CHECK (price >= 0), -- execution price
  trade_date  date NOT NULL DEFAULT current_date,
  thesis      text,                                 -- grouping / rationale
  sector      text,
  status      text NOT NULL DEFAULT 'open',         -- 'open' | 'closed'
  exit_price  numeric,
  exit_date   date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sl_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sl_journal_owner ON sl_journal;
CREATE POLICY sl_journal_owner ON sl_journal FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS sl_journal_user_idx ON sl_journal (user_id, ticker);
