-- Migration: fijar el search_path de search_kb_chunks
-- Date: 2026-08-09
--
-- El linter de Supabase marca `function_search_path_mutable`. Una función sin search_path
-- fijo resuelve los nombres sin cualificar usando el search_path de QUIEN la llama, así
-- que quien pueda crear objetos en un esquema que vaya antes puede secuestrar a qué tabla
-- o función apunta realmente el cuerpo.
--
-- Aquí el riesgo real es BAJO, no alto: la función es SECURITY INVOKER (se ejecuta con los
-- permisos de quien llama, y por tanto bajo su RLS), y ni anon ni authenticated tienen
-- CREATE en public en una instalación moderna de Supabase. Esto es higiene, no un
-- incendio. Se arregla porque es una línea.
--
-- IMPORTANTE — por qué `public, pg_temp` y no la forma más estricta `''`:
-- el cuerpo referencia `kb_chunks` SIN cualificar por esquema. Con search_path = '' esa
-- referencia dejaría de resolverse y la función se rompería en tiempo de ejecución, que
-- es justo el tipo de "arreglo de seguridad" que tira una feature abajo. `public, pg_temp`
-- fija la resolución sin tocar el cuerpo. (La alternativa —cualificar todo como
-- public.kb_chunks y usar ''— queda como mejora futura si se reescribe la función.)

alter function public.search_kb_chunks(p_ticker text, p_query text, p_per_section integer)
  set search_path = public, pg_temp;

-- Verificar que sigue resolviendo y devolviendo filas:
--   select count(*) from search_kb_chunks('AAPL', 'competition risk', 2);
--
-- Rollback:
--   alter function public.search_kb_chunks(text, text, integer) reset search_path;
