-- Migration: quitar TRUNCATE a anon/authenticated en todo el schema public
-- Date: 2026-08-18
-- APLICADA EN PRODUCCIÓN el 2026-08-18 (proyecto ic-ai-system).
--
-- EL AGUJERO. El proyecto concede ALL por defecto a anon/authenticated en las tablas de
-- `public`. Para SELECT/INSERT/UPDATE/DELETE eso es el diseño de Supabase y RLS es quien
-- acota: sin política aplicable, la fila no se ve ni se toca.
--
-- TRUNCATE es la excepción, y es la que importa: **NO está sujeto a RLS**. Postgres lo
-- trata como una operación sobre la tabla entera, así que un rol con el grant puede
-- vaciarla aunque no pueda leer ni una sola de sus filas. Y la anon key viaja dentro del
-- bundle del frontend — es pública por diseño, cualquiera la extrae del navegador.
--
-- Alcance medido ANTES de esta migración: **32 tablas** con TRUNCATE abierto a `anon`,
-- entre ellas
--   · sl_journal, sl_watchlist, sl_analyses, sl_alerts   (datos de usuario)
--   · sl_subscriptions, sl_stripe_events                 (facturación)
--   · sl_paper_fund, sl_paper_fund_track, sl_track_summary (el track record — la prueba
--     pública sobre la que se sostiene el argumento entero del producto)
--   · macro_state, macro_state_history                   (alimenta toda la app)
--   · kb_chunks, kb_docs, kb_cards                       (50k+ filas de base de conocimiento)
--   · push_subscriptions                                 (los destinatarios de las alertas)
--
-- POR QUÉ ES SEGURO. PostgREST no expone TRUNCATE: los borrados del cliente se hacen con
-- DELETE, que sí pasa por RLS y aquí no se toca. Ningún flujo de la aplicación puede
-- notar este cambio. `service_role` tampoco se toca (salta grants y RLS de todos modos).
--
-- Verificado tras aplicar: 0 de 38 tablas conservan TRUNCATE para anon/authenticated,
-- mientras `authenticated` mantiene SELECT en 33, DELETE en 32 e INSERT en 32, y
-- `service_role` conserva INSERT en las 38. Conteos de datos sin cambios
-- (kb_chunks 50.421, sl_analyses 22, macro_state 1, push_subscriptions 1).

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Y que las tablas FUTURAS no reabran el agujero en la próxima migración que alguien
-- escriba sin acordarse de esto.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- NOTA: el equivalente `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` falla con
-- "permission denied to change default privileges" desde el rol de migraciones. Si en el
-- futuro aparece una tabla creada por ese rol, habrá que repetir el REVOKE de arriba.
-- Por eso la comprobación de abajo conviene dejarla en el checklist de despliegue.

-- Verificar:
--   select count(*) filter (where has_table_privilege('anon', c.oid, 'TRUNCATE')) as abiertas
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind='r';
--   -- Esperado: 0
--
-- Rollback (NO recomendado — reabre el agujero):
--   GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
