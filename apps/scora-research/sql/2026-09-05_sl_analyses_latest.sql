-- Vista: la fila MÁS RECIENTE de sl_analyses por (usuario, ticker).
--
-- QUÉ PROBLEMA RESUELVE: cinco sitios del cliente pedían el historial COMPLETO de los
-- tickers en seguimiento —`select("*")` + `.in("ticker", […])` + `order`, sin límite— y
-- luego se quedaban en JavaScript con la primera fila de cada ticker. Con 22 filas en la
-- tabla eso no se nota. Con 20 tickers y un análisis diario durante un año son ~7.300 filas
-- descargadas al navegador para pintar 20. Crece de forma lineal y en silencio: nada falla,
-- solo va cada vez más lento.
--
-- DISTINCT ON es la forma nativa de Postgres de decir «una fila por grupo»: ordena por
-- (user_id, ticker, analysis_date DESC) y se queda con la primera de cada par. El trabajo
-- lo hace el servidor, que es donde están los datos y el índice.
--
-- ⚠ security_invoker NO ES OPCIONAL. Por defecto una vista de Postgres se ejecuta con los
-- permisos de QUIEN LA CREÓ, no de quien la consulta — es decir, se saltaría la política RLS
-- «solo el dueño» de sl_analyses y cada usuario vería los análisis de todos los demás. Con
-- security_invoker = on la vista se evalúa como el usuario que pregunta y la RLS de la tabla
-- sigue aplicándose igual que hoy. Requiere PostgreSQL 15+ (Supabase lo cumple desde 2023).

create or replace view public.sl_analyses_latest
with (security_invoker = on) as
select distinct on (user_id, ticker) *
from public.sl_analyses
order by user_id, ticker, analysis_date desc;

comment on view public.sl_analyses_latest is
  'Una fila por (user_id, ticker): el análisis más reciente. Respeta la RLS de sl_analyses '
  'vía security_invoker. Para el HISTORIAL (gráficos de evolución del score) hay que seguir '
  'consultando sl_analyses directamente — esta vista, por definición, no lo tiene.';

-- El índice que hace barato el DISTINCT ON: mismo orden que el ORDER BY de la vista, así
-- Postgres lo recorre y para, en vez de ordenar la tabla entera en memoria.
create index if not exists sl_analyses_user_ticker_date_idx
  on public.sl_analyses (user_id, ticker, analysis_date desc);

-- Las vistas no heredan los grants de la tabla; sin esto, el cliente recibiría un permission
-- denied. La RLS de sl_analyses sigue siendo la que decide QUÉ filas devuelve.
grant select on public.sl_analyses_latest to authenticated;
