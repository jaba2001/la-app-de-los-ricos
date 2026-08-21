-- ─────────────────────────────────────────────────────────────────────────────
-- SCORA PICKS — el registro inmutable de decisiones (SCORA_PICKS_REGLAS.md v2)
--
-- Dos tablas y no una, y el motivo es §7 del documento de reglas: se publica **cada
-- decisión, incluidas las fechas en que no se compró nada**. Si sólo se guardaran las
-- posiciones, un hueco vacío sería indistinguible de un cron que no llegó a correr — y esa
-- ambigüedad es justo por donde se cuela un track record maquillado. `sl_picks_run` deja
-- constancia de que el sistema miró y decidió no comprar.
--
--   sl_picks_run       una fila por FECHA DE DECISIÓN (día 1 y día 15). Siempre se escribe.
--   sl_picks_position  una fila por POSICIÓN, con su apertura, su cierre y su motivo.
--
-- `rules_version` va en las dos. Un cambio de reglas ABRE UNA SERIE NUEVA: las versiones no
-- se mezclan jamás al medir, igual que `score_version` en `sl_cohort`. Esta es la columna
-- que hace que "cambiamos una regla a mitad" sea visible en lugar de invisible.
--
-- Aditiva: no toca ninguna tabla existente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · Las decisiones ──────────────────────────────────────────────────────────────────
create table if not exists public.sl_picks_run (
  id               bigserial primary key,
  decision_date    date        not null,
  rules_version    smallint    not null default 2,
  -- Nº de nombres del universo elegible con señal esa fecha. Sirve para detectar de un
  -- vistazo que la cobertura de datos se ha degradado: si cae, las decisiones valen menos.
  universe_size    integer     not null,
  -- Candidatos que cumplían TODO (umbral + persistencia + no cuarentena) antes del tope.
  eligible_count   integer     not null,
  bought_count     integer     not null,
  sold_count       integer     not null,
  positions_after  integer     not null,
  -- Los elegibles que no cupieron, con su percentil. Sin esto no se puede auditar por qué
  -- se compró A y no B, que es la mitad de lo que hace creíble a un track record.
  not_bought       jsonb       not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  unique (decision_date, rules_version)
);

comment on table public.sl_picks_run is
  'Una fila por fecha de decisión de Scora Picks, SIEMPRE, también cuando no se compró nada. Un hueco vacío es un resultado legítimo (§4) y tiene que quedar registrado como tal, no como ausencia de fila.';
comment on column public.sl_picks_run.rules_version is
  'Versión de las reglas (lib/picks.ts PICKS_RULES_VERSION). Las series de versiones distintas NO se mezclan al medir el track record.';

create index if not exists sl_picks_run_date_idx
  on public.sl_picks_run (rules_version, decision_date desc);

-- ── 2 · Las posiciones ──────────────────────────────────────────────────────────────────
create table if not exists public.sl_picks_position (
  id             bigserial   primary key,
  ticker         text        not null,
  rules_version  smallint    not null default 2,
  opened_on      date        not null,
  -- Percentil de calidad EN EL MOMENTO DE COMPRAR. Se congela a propósito: recalcularlo
  -- después sería reescribir la razón por la que se compró.
  open_pctl      numeric(6,4) not null,
  open_price     numeric(18,6),
  closed_on      date,
  close_price    numeric(18,6),
  -- Debe coincidir con SellReason de lib/picks.ts. El check impide que una razón nueva
  -- entre sin pasar por el motor.
  close_reason   text        check (close_reason in ('senal_bajo_umbral','descalificador','fuera_del_universo')),
  created_at     timestamptz not null default now(),
  -- Una posición abierta por ticker y versión: la cuarentena de 12 meses (§5) impide
  -- reentrar antes, así que dos abiertas a la vez sólo pueden venir de un bug.
  constraint sl_picks_position_una_abierta
    exclude (ticker with =, rules_version with =) where (closed_on is null)
);

comment on table public.sl_picks_position is
  'Posiciones de Scora Picks. Las cerradas NO se borran: §7 promete publicar todas las posiciones cerradas con su resultado, incluidas las que salieron mal.';

create index if not exists sl_picks_position_abiertas_idx
  on public.sl_picks_position (rules_version, ticker) where closed_on is null;
create index if not exists sl_picks_position_cerradas_idx
  on public.sl_picks_position (rules_version, closed_on desc) where closed_on is not null;

-- ── 3 · Acceso ──────────────────────────────────────────────────────────────────────────
-- El producto es público por diseño (§7: todo a la vista desde el primer día), así que
-- LECTURA para cualquiera. Escritura, sólo el cron con la service_role.
alter table public.sl_picks_run      enable row level security;
alter table public.sl_picks_position enable row level security;

drop policy if exists sl_picks_run_lectura_publica on public.sl_picks_run;
create policy sl_picks_run_lectura_publica on public.sl_picks_run
  for select using (true);

drop policy if exists sl_picks_position_lectura_publica on public.sl_picks_position;
create policy sl_picks_position_lectura_publica on public.sl_picks_position
  for select using (true);

-- ⚠️ TRUNCATE NO PASA POR RLS. Sin este revoke, un rol con la política de "sólo lectura"
-- puede vaciar la tabla entera. Ya se encontraron 32 de 38 tablas abiertas así en este
-- proyecto; toda tabla nueva lo revoca desde el minuto uno.
revoke truncate on public.sl_picks_run      from anon, authenticated;
revoke truncate on public.sl_picks_position from anon, authenticated;
revoke insert, update, delete on public.sl_picks_run      from anon, authenticated;
revoke insert, update, delete on public.sl_picks_position from anon, authenticated;
