-- El identificador de usuario pasa de uuid a texto.
--
-- POR QUE. En Supabase el dueño de cada fila era un uuid que generaba `auth.users`. Identity
-- Platform emite un `uid` distinto: una cadena de 28 caracteres alfanumericos que NO es un
-- uuid. Dejar las columnas en uuid haria fallar cada insercion con "invalid input syntax for
-- type uuid" — no en el arranque, sino la primera vez que alguien guarda algo.
--
-- Se usa text y no un uuid derivado a proposito: convertir el uid a uuid con un hash seria
-- reversible solo de ida, y al depurar una fila nadie podria relacionarla con el usuario que
-- ve en la consola de Identity Platform.
--
-- NO HAY DATOS QUE CONVERTIR: la base se creo vacia para esta migracion. Si algun dia
-- hubiera filas, este ALTER las convertiria a su representacion en texto y habria que
-- reasignarlas a los uid nuevos, que es otro problema.

alter table public.ai_audit_log        alter column user_id type text using user_id::text;
alter table public.alerts_log          alter column user_id type text using user_id::text;
alter table public.ic_briefs           alter column user_id type text using user_id::text;
alter table public.push_subscriptions  alter column user_id type text using user_id::text;
alter table public.sl_alert_prefs      alter column user_id type text using user_id::text;
alter table public.sl_alerts           alter column user_id type text using user_id::text;
alter table public.sl_analyses         alter column user_id type text using user_id::text;
alter table public.sl_journal          alter column user_id type text using user_id::text;
alter table public.sl_score_log        alter column user_id type text using user_id::text;
alter table public.sl_subscriptions    alter column user_id type text using user_id::text;
alter table public.sl_waitlist         alter column user_id type text using user_id::text;
alter table public.sl_watchlist        alter column user_id type text using user_id::text;
alter table public.stock_snapshot      alter column user_id type text using user_id::text;

-- La vista depende de sl_analyses y hay que rehacerla despues del cambio de tipo.
drop view if exists public.sl_analyses_latest;
create or replace view public.sl_analyses_latest
with (security_invoker = on) as
select distinct on (user_id, ticker) *
from public.sl_analyses
order by user_id, ticker, analysis_date desc;
-- Sin GRANT: `authenticated` era un rol de Supabase (lo creaba PostgREST para las peticiones
-- del navegador) y en Cloud SQL no existe. Aqui la app conecta como `postgres`, que es dueño
-- del esquema, y quien filtra por usuario es lib/server/data/policy.ts.
