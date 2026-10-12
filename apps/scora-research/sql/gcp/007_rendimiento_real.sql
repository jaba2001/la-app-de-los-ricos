-- macro_state.real_yield_10y como columna GENERADA: bono a 10 años − PCE subyacente.
--
-- La leían Metals (Macro) y los motores de oro, metales, TIPS y cripto de la ficha de cada
-- instrumento, pero no existía: salía siempre «—» (recorrido con sesión, 12-10-2026). Misma
-- derivación que la pestaña Indicators y que lib/dolar.ts (rendimientoReal), que cubre las bases
-- donde esto aún no se ha aplicado.
--
-- Generada = nadie la escribe ni puede desincronizarse; el cron no cambia. Aditiva e idempotente.
alter table public.macro_state
  add column if not exists real_yield_10y numeric generated always as (dgs10 - core_pce_yoy) stored;
