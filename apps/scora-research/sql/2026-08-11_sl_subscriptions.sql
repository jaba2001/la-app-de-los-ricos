-- Migration: sl_subscriptions + sl_stripe_events (tier Pro de pago — Fase 11)
-- Date: 2026-08-11
--
-- Propósito: la tabla que responde "¿este usuario ha pagado?". Es la única fuente de
-- verdad de esa pregunta; lib/entitlements.ts la lee y nadie más decide.
--
-- MODELO DE SEGURIDAD — el detalle que importa más que ningún otro aquí:
-- el usuario puede LEER su suscripción y NO PUEDE ESCRIBIRLA. Hay una policy de SELECT
-- sobre la propia fila y CERO policies de INSERT/UPDATE/DELETE. Escribe únicamente el
-- webhook con SUPABASE_SERVICE_KEY, que salta RLS por diseño.
--   Si hubiera un INSERT permisivo, cualquiera con la anon key (que va en el bundle del
--   navegador, es pública) podría hacerse Pro con una línea de fetch. No es un riesgo
--   teórico: es la forma normal de romper esto. Por eso el permiso se deriva SIEMPRE de
--   lo que Stripe nos contó, nunca de lo que el cliente afirma.
-- No añadas una policy de escritura "para que funcione": si el webhook no puede escribir,
-- es que está usando la anon key, y ese es el bug que hay que arreglar.

CREATE TABLE IF NOT EXISTS sl_subscriptions (
  -- Una suscripción por usuario. Como PK evita por construcción el caso "dos filas activas
  -- para la misma persona", que convertiría isPro() en dependiente del orden de lectura.
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL UNIQUE,
  stripe_subscription_id text UNIQUE,
  -- Valores de Stripe: active | trialing | past_due | canceled | incomplete |
  -- incomplete_expired | unpaid | paused. Se guarda el string tal cual en lugar de un
  -- booleano "is_pro": qué estados dan acceso es una decisión de producto que cambiará
  -- (¿past_due sigue teniendo acceso durante el periodo de gracia?), y aplanarlo aquí
  -- destruiría la información necesaria para cambiarla luego.
  status                 text NOT NULL,
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  -- Marca temporal del evento de Stripe que dejó la fila así. Stripe NO garantiza orden de
  -- entrega: un `subscription.updated` reintentado puede llegar después de un `deleted` y
  -- resucitar una suscripción cancelada. El webhook descarta todo evento con created <=
  -- este valor, así que el desorden deja de importar.
  last_event_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- El webhook llega identificado por customer, no por user_id: es su camino de búsqueda.
CREATE INDEX IF NOT EXISTS sl_subscriptions_customer_idx
  ON sl_subscriptions (stripe_customer_id);

ALTER TABLE sl_subscriptions ENABLE ROW LEVEL SECURITY;

-- Lectura de la propia fila, y solo la propia. Sin esto la app tendría que preguntar por
-- el estado de pago a través del proxy en cada carga.
DROP POLICY IF EXISTS "own subscription readable" ON sl_subscriptions;
CREATE POLICY "own subscription readable" ON sl_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Sin policies de escritura, a propósito. Ver MODELO DE SEGURIDAD arriba.


-- Idempotencia de webhooks.
--
-- Stripe reintenta hasta que respondes 2xx, así que la MISMA entrega puede aplicarse dos
-- veces; su documentación lo dice explícitamente y hay que asumirlo. Para un cambio de
-- estado reaplicar es inofensivo, pero en cuanto esta tabla toque contadores, créditos o
-- emails deja de serlo. Registrar el id del evento antes de actuar lo cierra de una vez y
-- para todos los tipos de evento, en lugar de razonarlo caso por caso.
CREATE TABLE IF NOT EXISTS sl_stripe_events (
  event_id    text PRIMARY KEY,     -- evt_... de Stripe
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sl_stripe_events ENABLE ROW LEVEL SECURITY;
-- Sin policies: es puramente interna del webhook. El navegador no tiene nada que hacer aquí.

-- Purga: los eventos solo sirven para deduplicar reintentos, y Stripe deja de reintentar a
-- los pocos días. Conservarlos indefinidamente hace crecer la tabla sin aportar nada.
--   DELETE FROM sl_stripe_events WHERE received_at < now() - interval '30 days';

-- Quién paga hoy:
--   SELECT status, count(*) FROM sl_subscriptions GROUP BY status ORDER BY 2 DESC;
