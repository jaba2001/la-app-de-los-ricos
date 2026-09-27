-- Un rol con los permisos justos para la app, en vez de `postgres` (AUDIT_REPORT A-5).
--
-- POR QUÉ. La app conecta como `postgres`, dueño del esquema. La única barrera entre un
-- usuario y los datos de otro es lib/server/data/policy.ts: si un fallo ahí dejara pasar SQL
-- inesperado, se ejecutaría con permiso para BORRAR TABLAS. Con este rol, el mismo fallo
-- podría leer o escribir filas, pero no destruir el esquema, ni vaciar una tabla de golpe, ni
-- cambiar la estructura.
--
-- QUÉ PUEDE: SELECT/INSERT/UPDATE/DELETE en las tablas de `public`, usar sus secuencias y
-- ejecutar search_kb_chunks. QUÉ NO: CREATE, DROP, ALTER, TRUNCATE, REFERENCES, TRIGGER.
-- Las migraciones siguen corriendo como `postgres`.
--
-- NO SE HA APLICADO en producción. Para hacerlo:
--   1. Crear el usuario en Cloud SQL (fija su contraseña):
--        gcloud sql users create scora_app --instance=<instancia> --password=<nueva>
--   2. Aplicar ESTE fichero como postgres.
--   3. Cambiar PGUSER a scora_app en infra/terraform/cloudrun.tf y subir la nueva
--      contraseña como PGPASSWORD (infra/set-secrets.sh). Redesplegar.
-- En local, el `create role` de abajo crea el rol si no existe (sin contraseña: usa trust).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'scora_app') then
    create role scora_app login;
  end if;
end $$;

-- Ni heredar privilegios de PUBLIC más allá de lo necesario, ni poder crear objetos.
revoke create on schema public from scora_app;
grant usage on schema public to scora_app;

grant select, insert, update, delete on all tables in schema public to scora_app;
grant usage, select on all sequences in schema public to scora_app;
grant execute on function public.search_kb_chunks(text, text, integer) to scora_app;

-- Las tablas que creen futuras migraciones (como postgres) nacen con los mismos permisos.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to scora_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to scora_app;
