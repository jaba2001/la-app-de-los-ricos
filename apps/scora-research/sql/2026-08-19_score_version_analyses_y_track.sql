-- ─────────────────────────────────────────────────────────────────────────────
-- Cerrar el versionado del score en los DOS sitios que faltaban (F2)
--
-- La migración anterior selló la versión en `sl_cohort`, pero el score vive en tres sitios
-- y sólo se arregló uno. Los otros dos seguían mezclando metodologías en silencio:
--
--  1. `sl_analyses` — los análisis que GUARDA EL USUARIO. Un análisis de julio (bandas
--     absolutas) y uno de hoy (percentiles sectoriales) se ven idénticos en pantalla y no
--     son comparables. Si alguien mira su historial y ve que "la nota de X bajó", tiene
--     derecho a saber si bajó la empresa o cambió la regla.
--
--  2. `sl_track_summary` — el resumen del track record. Su `information_coefficient`
--     correlaciona score contra retorno mezclando cohortes v1 y v2, que no están en la
--     misma escala. `by_version` guarda el desglose para poder mirarlo por separado.
--
-- Ambas aditivas y reversibles.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sl_analyses
  add column if not exists score_version smallint not null default 1;

comment on column public.sl_analyses.score_version is
  'Versión de la fórmula del score con la que se calculó ESTE análisis: 1 = bandas absolutas · 2 = percentiles sector-relativos (F2, 2026-08). Análisis de versiones distintas no son comparables entre sí.';

alter table public.sl_track_summary
  add column if not exists by_version jsonb;

comment on column public.sl_track_summary.by_version is
  'Métricas del track record desglosadas por versión del score (IC, retorno, acierto y nº de nombres de cada una). El agregado de la fila mezcla versiones y por eso no basta por sí solo.';
