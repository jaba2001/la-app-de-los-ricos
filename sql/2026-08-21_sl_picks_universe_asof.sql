-- ─────────────────────────────────────────────────────────────────────────────
-- sl_picks_run.universe_asof — sobre QUÉ universo se decidió
--
-- El universo elegible de Scora Picks (§2 de SCORA_PICKS_REGLAS.md) es el S&P 500
-- point-in-time, y sale de un CSV público y gratuito (hanshof/sp500_constituents). Ese CSV
-- **dejó de actualizarse el 2025-08-23**: comprobado por descarga directa el 2026-08-21, su
-- última fila es esa fecha. Así que las decisiones de 2026 se toman sobre la composición del
-- índice de agosto de 2025, y esa distancia CRECE cada mes que pasa.
--
-- POR QUÉ SE GUARDA EN VEZ DE ARREGLARSE. Se buscaron sustitutos gratuitos y los dos
-- candidatos vivos (datasets/s-and-p-500-companies y fja05680/sp500) traen tickers
-- corruptos: `FISV` donde hoy es `FI`, `MRSH` donde el ticker es `MMC`, y nombres como `Q` o
-- `ECHO` que hace años que no están en el índice. Cambiar la fuente de producción por una de
-- ésas sería empeorar el dato creyendo mejorarlo. Mientras no haya feed licenciado, el
-- universo se queda congelado — y un universo FIJO y PUBLICADO es defendible para un sistema
-- de reglas preregistrado; uno que envejece en silencio, no.
--
-- Por eso esta columna no es telemetría: es parte de la decisión. §7 promete publicar cada
-- decisión con su razón, y "de entre qué nombres se eligió" es la mitad de esa razón. Sin
-- ella, dentro de dos años nadie podrá auditar por qué el sistema nunca compró una empresa
-- que llevaba año y medio en el índice.
--
-- Aditiva y reversible (`alter table public.sl_picks_run drop column universe_asof;`).
-- Nullable a propósito: no se inventa un valor para filas escritas antes de existir.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sl_picks_run
  add column if not exists universe_asof date;

comment on column public.sl_picks_run.universe_asof is
  'Fecha de la foto de miembros del S&P 500 usada en esta decisión, que NO es decision_date: la fuente gratuita del universo dejó de actualizarse el 2025-08-23. Se publica en /picks para que el desfase sea visible y auditable en lugar de silencioso.';
