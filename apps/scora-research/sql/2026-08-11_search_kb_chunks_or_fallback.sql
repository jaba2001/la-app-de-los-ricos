-- Migration: search_kb_chunks — repliegue a OR cuando el AND no devuelve nada
-- Date: 2026-08-11
--
-- EL PROBLEMA, medido sobre los 5.510 chunks reales:
--   NVDA, "export controls China restrictions" -> 1 chunk
--   NVDA, "export controls China"              -> 5 chunks
--   NVDA, "export controls"                    -> 12 chunks
-- websearch_to_tsquery une los términos con AND, así que exige que los cuatro aparezcan
-- dentro del MISMO chunk (~819 caracteres de media). Cuanto mejor formulada está la
-- pregunta, menos encuentra — justo al revés de lo que espera quien la escribe. Y una
-- consulta razonable que devuelve cero pasajes deja a la tesis con IA sin nada que citar,
-- que es precisamente lo que la Fase 8 venía a resolver.
--
-- LA SOLUCIÓN, y por qué es segura:
-- se intenta primero el AND estricto. Solo si NO hay ninguna fila se reintenta con los
-- mismos términos unidos por OR. El repliegue por tanto únicamente puede activarse en los
-- casos que hoy devuelven cero resultados: ninguna consulta que ya funcione cambia de
-- comportamiento. En el peor caso se pasa de "nada" a "lo más parecido que hay".
--
-- La precisión no se pierde porque ts_rank sigue ordenando: un chunk que contiene tres de
-- los cuatro términos puntúa por encima de uno que contiene solo uno, así que lo relevante
-- sale arriba igual. Y p_per_section sigue recortando por sección, de modo que el repliegue
-- no puede inundar la respuesta.
--
-- Se conserva SET search_path (ver 2026-08-09_search_kb_chunks_search_path.sql): sin él la
-- función es vulnerable a que alguien anteponga un esquema con objetos suyos.

CREATE OR REPLACE FUNCTION public.search_kb_chunks(
  p_ticker text,
  p_query text DEFAULT NULL::text,
  p_per_section integer DEFAULT 3
)
RETURNS TABLE(
  ticker text, form text, section text, chunk_idx integer,
  text text, filed_date date, fiscal_year integer, rank real
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH q AS (
    SELECT CASE
             WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
             ELSE websearch_to_tsquery('english', p_query)
           END AS tsq_and
  ),
  q2 AS (
    SELECT
      tsq_and,
      -- Los mismos lexemas con OR. Se opera sobre la representación textual porque no hay
      -- constructor para "cambiar el operador" de una tsquery ya montada; es el modo
      -- habitual de hacerlo. Si la consulta trae un solo término, no hay ' & ' que sustituir
      -- y ambas versiones coinciden, que es lo correcto.
      CASE
        WHEN tsq_and IS NULL THEN NULL
        ELSE replace(tsq_and::text, ' & ', ' | ')::tsquery
      END AS tsq_or
    FROM q
  ),
  eff AS (
    SELECT CASE
             WHEN tsq_and IS NULL THEN NULL
             WHEN EXISTS (
               SELECT 1 FROM kb_chunks c
                WHERE c.ticker = upper(p_ticker) AND c.tsv @@ tsq_and
             ) THEN tsq_and
             ELSE tsq_or
           END AS tsq
    FROM q2
  ),
  scored AS (
    SELECT c.ticker, c.form, c.section, c.chunk_idx, c.text, c.filed_date, c.fiscal_year,
           CASE WHEN e.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, e.tsq) END AS rank,
           ROW_NUMBER() OVER (
             PARTITION BY c.section
             ORDER BY CASE WHEN e.tsq IS NULL THEN 0::real ELSE ts_rank(c.tsv, e.tsq) END DESC,
                      c.chunk_idx ASC
           ) AS rn
      FROM kb_chunks c CROSS JOIN eff e
     WHERE c.ticker = upper(p_ticker)
       AND (e.tsq IS NULL OR c.tsv @@ e.tsq)
  )
  SELECT ticker, form, section, chunk_idx, text, filed_date, fiscal_year, rank
    FROM scored
   WHERE rn <= GREATEST(p_per_section, 1)
   ORDER BY CASE section WHEN 'Risk Factors' THEN 0 WHEN 'MD&A' THEN 1 ELSE 2 END,
            rank DESC, chunk_idx ASC;
$function$;
