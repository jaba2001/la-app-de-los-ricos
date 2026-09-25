-- Migration: acotar ic_snapshots — quitar UPDATE y DELETE anónimos
-- Date: 2026-08-09
--
-- Caso distinto al de las otras cinco tablas legacy (ver
-- 2026-08-09_lock_legacy_ic_tables.sql): esta SÍ está viva. Tiene 41 filas y
-- IC-DataLayer la escribe directamente desde el navegador:
--     IC_DataLayer_v2.jsx:2829  sb.from("ic_snapshots").insert(payload)
--     IC_DataLayer_v2.jsx:2849  sb.from("ic_snapshots").select("id, created_at, ...")
-- y esa app NO tiene autenticación de ningún tipo — es anónima de principio a fin, así
-- que no hay forma de exigir un usuario sin construirle un login.
--
-- La política `allow_all_snapshots` era FOR ALL con USING true / WITH CHECK true, lo que
-- daba a cualquiera con la anon key (pública) la capacidad de BORRAR o ALTERAR las 41
-- filas. Cerrarla del todo mataría el guardar/cargar de la app.
--
-- Punto medio elegido: se conservan SELECT e INSERT anónimos (la app sigue funcionando
-- igual) y desaparecen UPDATE y DELETE. En Postgres, una tabla con RLS activo y sin
-- política para un comando hace ese comando imposible — no hay que "denegar" nada
-- explícitamente. Con eso el peor caso deja de ser "alguien borra el histórico" y pasa a
-- ser "alguien inserta filas de más", que es ruido reversible, no pérdida de datos.
--
-- El trigger fn_snapshot_ic_score hace ON CONFLICT ... DO UPDATE sobre esta tabla, pero es
-- SECURITY DEFINER (se ejecuta como el dueño), así que no le afecta la ausencia de
-- política de UPDATE.

drop policy if exists allow_all_snapshots on ic_snapshots;

create policy ic_snapshots_read   on ic_snapshots for select using (true);
create policy ic_snapshots_insert on ic_snapshots for insert with check (true);
-- Sin política de UPDATE ni DELETE, a propósito.

-- Los grants NO se revocan aquí: anon necesita SELECT e INSERT para que IC-DataLayer siga
-- funcionando. RLS es quien acota, no los grants.

-- Verificar:
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='ic_snapshots';
-- Esperado: ic_snapshots_read [SELECT], ic_snapshots_insert [INSERT]. Nada más.
--
-- Smoke de la app: abrir ic-datalayer-app.vercel.app, guardar un snapshot y comprobar
-- que la lista de snapshots sigue cargando.
--
-- Rollback:
--   drop policy ic_snapshots_read on ic_snapshots;
--   drop policy ic_snapshots_insert on ic_snapshots;
--   create policy allow_all_snapshots on ic_snapshots for all using (true) with check (true);
