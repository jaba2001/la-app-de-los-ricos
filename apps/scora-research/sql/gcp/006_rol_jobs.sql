-- El rol con el que escriben los workflows de research desde GitHub Actions (AUDIT_REPORT C-5).
--
-- POR QUÉ UNO PROPIO y no `postgres` ni `scora_app`. La contraseña de este rol vive en los
-- secretos de GitHub, fuera de GCP: si se filtrara, lo que expone debe ser lo mínimo. Así que
-- NO puede leer ninguna tabla con datos de usuarios (diarios, alertas, correos, análisis),
-- ni borrar, ni tocar el esquema. Solo lo que escriben los 9 workflows, y lo que leen.
--
--   tabla                     lo usa                                   permiso
--   sl_revisions              cron-revisions                           leer + escribir
--   sl_cohort                 cron-score, cron-measure                 leer + escribir
--   sl_track_summary          cron-measure                             leer + escribir
--   sl_discovery              discovery                                leer + escribir
--   sl_paper_fund(_track)     paperfund_rebalance, paperfund_measure   leer + escribir
--   sl_picks_run / _position  cron-picks                               leer + escribir
--   kb_docs / kb_chunks       ingest_filings                           leer + escribir
--   macro_state               macro_breadth (PATCH), paperfund_rebalance (lee risk_on)
--
-- Si un workflow nuevo escribe otra tabla, hay que añadirla aquí: fallará con «permission
-- denied», que es lo que se quiere — ruidoso y en el primer día.
--
-- APLICAR (una vez, como postgres):
--   1. gcloud sql users create scora_jobs --instance=scora-db --password=<nueva>
--      (lo hace infra/github-actions-cloudsql.sh, que además guarda la contraseña en GitHub)
--   2. psql … -U postgres -d scora -f sql/gcp/006_rol_jobs.sql
-- En local, el `create role` de abajo crea el rol si no existe (sin contraseña).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'scora_jobs') then
    create role scora_jobs login;
  end if;
end $$;

revoke create on schema public from scora_jobs;
grant usage on schema public to scora_jobs;

grant select, insert, update on
  public.sl_revisions, public.sl_cohort, public.sl_track_summary, public.sl_discovery,
  public.sl_paper_fund, public.sl_paper_fund_track, public.sl_picks_run, public.sl_picks_position,
  public.kb_docs, public.kb_chunks, public.macro_state
to scora_jobs;

-- Las tablas con `id` serial/identity necesitan su secuencia para insertar.
grant usage, select on
  sequence public.sl_cohort_id_seq, public.sl_paper_fund_id_seq,
  public.sl_picks_run_id_seq, public.sl_picks_position_id_seq
to scora_jobs;
