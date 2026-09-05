-- ─────────────────────────────────────────────────────────────────────────────
-- sl_cohort: sellar la VERSIÓN de la fórmula del score en cada cohorte (F2)
--
-- Por qué es imprescindible y no un adorno: `cron-score.mjs` sella una cohorte inmutable
-- cada mes, y de esas cohortes sale el track record. Al cambiar el criterio del score
-- (bandas absolutas → percentiles sector-relativos) las cohortes nuevas dejan de ser
-- comparables con las 127 filas ya guardadas. Sin esta columna, esa incomparabilidad
-- quedaría INVISIBLE: nada fallaría, los números seguirían saliendo, y el track record
-- estaría mezclando dos metodologías sin que nadie pudiera notarlo.
--
-- El DEFAULT 1 es lo que etiqueta correctamente todo el histórico ya existente: se calculó
-- con bandas absolutas, que es exactamente la versión 1.
--
-- Aditiva y reversible (`alter table public.sl_cohort drop column score_version;`).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sl_cohort
  add column if not exists score_version smallint not null default 1;

comment on column public.sl_cohort.score_version is
  'Versión de la fórmula del score (lib/scoring.ts): 1 = bandas absolutas · 2 = percentiles sector-relativos (F2, 2026-08). Las cohortes de versiones distintas NO son comparables entre sí: al medir el track record hay que segmentar por esta columna.';

-- Índice para poder segmentar el track record por versión sin escanear la tabla entera.
create index if not exists sl_cohort_score_version_idx
  on public.sl_cohort (score_version, score_date desc);
