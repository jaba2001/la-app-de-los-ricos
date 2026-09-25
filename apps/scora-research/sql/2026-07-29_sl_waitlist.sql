-- Migration: sl_waitlist (Pro-tier intent capture — Fase 3)
-- Date: 2026-07-29
--
-- Purpose: /pricing's "Notify me" button on the Pro tier used to call router.push("/macro")
-- and store nothing. It is the ONLY place in the product where someone declares intent to
-- pay, and every one of those signals was being thrown away. This table is what decides
-- whether the Pro tier (and therefore Stripe) ever gets built.
--
-- SECURITY MODEL — deliberately different from the other sl_* tables.
-- The visitor is NOT logged in when they declare interest, so there is no auth.uid() to
-- own the row. Rather than reopen anonymous INSERT (which the 2026-07-26 hardening pass
-- deliberately closed), writes go through ic-proxy's /api/waitlist route using
-- SUPABASE_SERVICE_KEY. Therefore: RLS ON with NO POLICIES AT ALL.
--   - anon / authenticated: no policy → no read, no write. Correct: this is a list of
--     email addresses and nothing in the browser should ever be able to read it.
--   - service_role: bypasses RLS by design → the proxy route can insert.
-- Do NOT add a permissive policy here "to make it work" — if inserts fail, the route is
-- using the wrong key, which is the bug worth fixing.

CREATE TABLE IF NOT EXISTS sl_waitlist (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- null when logged out
  tier        text NOT NULL DEFAULT 'pro',
  source      text,          -- 'pricing' | 'landing' | ...
  referrer    text,
  notified_at timestamptz,   -- set when we actually email them about launch
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: signing up twice is a no-op, not an error the user sees,
-- and it stops the endpoint being used to inflate the list with one address.
CREATE UNIQUE INDEX IF NOT EXISTS sl_waitlist_email_idx ON sl_waitlist (lower(email));

ALTER TABLE sl_waitlist ENABLE ROW LEVEL SECURITY;
-- No policies, on purpose. See SECURITY MODEL above.

-- How many people are waiting, and where they came from:
--   SELECT source, count(*) FROM sl_waitlist GROUP BY source ORDER BY count DESC;
