-- Migration: sl_daily_close — el informe de cierre diario (TANDA S-B)
-- Date: 2026-08-18
--
-- Una fila por día de mercado con el informe ya construido (lib/dailyClose.js) en `payload`.
-- Lo escribe el cron /api/cron/daily-close con la SERVICE key; lo lee /daily en
-- scora-research SIN sesión.
--
-- POR QUÉ LECTURA PÚBLICA. Este informe es la pieza de adquisición: tiene que ser
-- compartible, indexable y legible sin registro, igual que /demo y /track-record. No
-- contiene datos de ningún usuario — se construye desde macro_state y cotizaciones de 12
-- ETFs, nada de sl_analyses ni de carteras. No hay nada que aislar por usuario aquí.
--
-- POR QUÉ NO HAY POLÍTICA DE INSERT/UPDATE/DELETE. En Postgres, una tabla con RLS activo y
-- sin política para un comando hace ese comando imposible para los roles sujetos a RLS.
-- El cron usa la service key, que salta RLS, así que puede escribir sin necesitar política.
-- Resultado: `anon` puede leer y NADA más — ni siquiera insertar ruido, a diferencia de
-- ic_snapshots (que arrastra un cliente anónimo sin login y por eso conserva INSERT).
--
-- Aditiva y no destructiva.

CREATE TABLE IF NOT EXISTS sl_daily_close (
  close_date  date PRIMARY KEY,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sl_daily_close IS
  'Informe de cierre diario, construido de forma determinista por lib/dailyClose.js. Lectura pública (contenido), escritura solo con service key.';

ALTER TABLE sl_daily_close ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sl_daily_close_read ON sl_daily_close;
CREATE POLICY sl_daily_close_read ON sl_daily_close FOR SELECT USING (true);
-- Sin políticas de INSERT / UPDATE / DELETE, a propósito: solo la service key escribe.

-- `anon` y `authenticated` necesitan el grant de SELECT; RLS es quien acota el resto.
GRANT SELECT ON sl_daily_close TO anon, authenticated;

-- Índice para "los últimos N días" (la portada de /daily y el sitemap).
CREATE INDEX IF NOT EXISTS sl_daily_close_date_idx ON sl_daily_close (close_date DESC);

-- Verificar:
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='sl_daily_close';
-- Esperado: sl_daily_close_read [SELECT]. Nada más.
--
--   -- con la anon key debe devolver filas:
--   select close_date from sl_daily_close order by close_date desc limit 5;
--   -- con la anon key debe FALLAR (sin política de insert):
--   insert into sl_daily_close (close_date, payload) values (current_date, '{}'::jsonb);
--
-- Rollback:
--   drop index if exists sl_daily_close_date_idx;
--   drop policy if exists sl_daily_close_read on sl_daily_close;
--   drop table if exists sl_daily_close;
