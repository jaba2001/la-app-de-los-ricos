-- ─────────────────────────────────────────────────────────────────────────────
-- sl_picks_run.signal — guardar el panel de señal de cada decisión
--
-- No es un adorno de auditoría: es lo que hace que el sistema pueda funcionar SIN estado
-- oculto y que las decisiones publicadas sean REPRODUCIBLES.
--
-- 1) LA MECÁNICA LO NECESITA. La regla de persistencia (§3) exige saber si un valor estuvo
--    sobre el umbral en TODAS las fechas de decisión de los últimos 60 días, y la de salida
--    (§5.1) exige dos evaluaciones consecutivas por debajo. Guardando el panel, todo el
--    estado del motor —cartera, cuarentenas y contadores— se DERIVA de esta tabla más
--    `sl_picks_position`. No hay ningún contador escondido que pueda desincronizarse.
--
-- 2) LA ALTERNATIVA ERA PEOR. Se podría recalcular la señal pasada desde EDGAR, que es
--    point-in-time. Pero EDGAR **restatea**: si una empresa reformula un trimestre, el
--    percentil de aquella fecha cambia y la decisión publicada dejaría de reproducirse.
--    Guardar el panel congela la foto que se usó de verdad. Un track record que no se puede
--    reproducir es una afirmación, no una prueba.
--
-- Coste: ~350 nombres × ~15 bytes ≈ 6 KB por fecha, 24 fechas al año. Nada.
--
-- Aditiva y reversible (`alter table public.sl_picks_run drop column signal;`).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sl_picks_run
  add column if not exists signal jsonb not null default '{}'::jsonb;

comment on column public.sl_picks_run.signal is
  'Panel de señal usado en esta decisión: {ticker: percentil de calidad 0..1}, congelado. De aquí se derivan la persistencia de 60 días y el contador de salida, así que el motor no guarda estado propio. Se congela porque EDGAR restatea: recalcularlo haría irreproducible una decisión ya publicada.';
