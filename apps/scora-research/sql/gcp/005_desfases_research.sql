-- Dos desfases entre lo que escriben los procesos de research y el esquema (AUDIT_REPORT C-5).
--
-- Salieron al ejecutar los 9 scripts de los workflows contra una copia de Cloud SQL. El código
-- de este repo había evolucionado sin migración, y el esquema de Supabase (del que sale
-- 001_schema.sql) tampoco los tenía: estos workflows nunca habían llegado a ejecutarse aquí.
--
--   · research/cron-measure.mjs  → sl_track_summary.months_live es ahora un span en meses con
--     un decimal (41.9); antes era un entero que contaba cohortes, no meses. Con `integer` el
--     upsert fallaba entero y el track record en vivo dejaba de actualizarse.
--   · research/paperfund_measure.mjs → escribe los costes cobrados al fondo (diferencial y
--     comisión, en puntos básicos). Sin las columnas el upsert fallaba entero.
--
-- Aditiva e idempotente: ampliar integer → numeric no pierde nada, y se puede aplicar dos veces.
--   psql "$DATABASE_URL" -f sql/gcp/005_desfases_research.sql

alter table public.sl_track_summary
  alter column months_live type numeric(6,1) using months_live::numeric;

alter table public.sl_paper_fund_track
  add column if not exists coste_spread_pb   numeric,
  add column if not exists coste_comision_pb numeric;
