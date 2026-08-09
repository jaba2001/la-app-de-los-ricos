-- Migration: cerrar las tablas legacy ic_* abiertas a anon
-- Date: 2026-08-09
--
-- Estas cinco tablas quedaron de la etapa IC-DataLayer con una política
-- `allow_all_*` FOR ALL a PUBLIC con USING true / WITH CHECK true. Como la anon key es
-- pública por diseño (va en el bundle de cada front-end, y está hardcodeada en
-- IC_DataLayer_v2.jsx:7), eso significaba que CUALQUIERA en internet podía leer, insertar,
-- modificar y BORRAR su contenido sin autenticarse.
--
-- Por qué es seguro cerrarlas ahora — medido, no supuesto:
--   · pg_stat_user_tables: las cinco tienen 0 filas.
--   · Ninguna de las cuatro apps que comparten esta base las referencia
--     (scora-research, ic-suite, ic-datalayer-app, stock-analyzer).
--   · Ojo con el falso positivo: IC-DataLayer sí menciona "ic_api_keys", pero es
--     localStorage.getItem("ic_api_keys") — la clave de un almacén en el navegador,
--     no esta tabla. La tabla no la usa nadie.
--
-- ic_api_keys es el caso más feo de los cinco: una tabla llamada "api keys", con una
-- columna `vault_key`, escribible por el mundo entero. Está vacía, así que no se ha
-- filtrado nada, pero cualquier clave que se hubiera guardado ahí habría sido pública
-- desde el primer día. Si algún día hacen falta claves, van en variables de entorno de
-- Vercel, nunca en una fila de Postgres.
--
-- NOTA: ic_snapshots NO se toca aquí — tiene 41 filas y IC-DataLayer la escribe desde el
-- navegador. Se trata aparte en 2026-08-09_narrow_ic_snapshots.sql.

drop policy if exists allow_all_keys        on ic_api_keys;
drop policy if exists allow_all_thresholds  on ic_thresholds;
drop policy if exists allow_all_news        on ic_news_cache;
drop policy if exists allow_all_calibration on ic_calibration_log;
drop policy if exists allow_all_divergences on ic_divergence_log;

-- RLS sin políticas ya bloquea a anon/authenticated, pero los grants por defecto de
-- Supabase siguen dejando la tabla visible en el esquema GraphQL. Revocarlos la quita
-- también de ahí (defensa en profundidad, y silencia los avisos pg_graphql_*_exposed).
revoke all on ic_api_keys        from anon, authenticated;
revoke all on ic_thresholds      from anon, authenticated;
revoke all on ic_news_cache      from anon, authenticated;
revoke all on ic_calibration_log from anon, authenticated;
revoke all on ic_divergence_log  from anon, authenticated;

-- Verificar:
--   select tablename, policyname from pg_policies
--   where schemaname='public' and tablename like 'ic\_%';
-- Esperado: solo ic_briefs, ic_synthesis (por dueño) e ic_snapshots (read/insert).
--
-- Rollback (si algo dependía de ellas, cosa que la medición descarta):
--   grant all on <tabla> to anon, authenticated;
--   create policy allow_all_x on <tabla> for all using (true) with check (true);
