-- macro_state: remove write access from signed-in users.
--
-- macro_state is a single global row (id=1) that MacroContext serves to the whole app:
-- regime, getMacroTilt(), the C3 allocation, the AI briefs and the public /demo page.
-- The policy below granted FOR ALL to `authenticated` with USING true / WITH CHECK true,
-- so any user who signed up could UPDATE or DELETE it and poison every other user's view.
--
-- Nothing legitimate needs it: every writer uses SUPABASE_SERVICE_KEY, which bypasses RLS
--   · ic-proxy /api/cron/macro-refresh   (Vercel cron)
--   · research/macro_breadth.mjs         (GitHub Actions)
--   · research/paperfund_rebalance.mjs   (reads only)
-- The scora-research client only ever SELECTs it.
--
-- Public read stays: /demo renders macro_state for logged-out visitors.

drop policy if exists macro_state_write_authenticated on macro_state;

-- Verify:
--   select policyname, cmd, roles::text from pg_policies
--   where schemaname='public' and tablename='macro_state';
-- Expected: only macro_state_read_public [SELECT] remains.
