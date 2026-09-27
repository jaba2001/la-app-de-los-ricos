#!/usr/bin/env bash
# Construye la imagen y la sube a Artifact Registry.
#
#   ./infra/build-and-push.sh          # etiqueta: el SHA del commit actual
#   ./infra/build-and-push.sh v1       # etiqueta a mano
#
# UNA sola imagen: las paginas y las rutas /api/* son la misma app Next. Antes eran dos, y
# habia que construirlas en un orden concreto porque la del frontend llevaba dentro la URL
# del backend. Eso ya no pasa: llama a su propio origen.
#
# El SHA por defecto no es capricho: con `latest` no hay forma de volver a la version
# anterior cuando un despliegue sale mal, porque la etiqueta ya apunta a la nueva.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
APP="$RAIZ/apps/scora-research"
TAG="${1:-$(git -C "$RAIZ" rev-parse --short HEAD)}"
REGION="${REGION:-europe-west1}"

PROYECTO="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "$PROYECTO" || "$PROYECTO" == "(unset)" ]]; then
  echo "No hay proyecto. Usa: gcloud config set project TU-PROYECTO" >&2; exit 1
fi
REGISTRO="${REGION}-docker.pkg.dev/${PROYECTO}/scora"

# Las NEXT_PUBLIC_* salen del mismo fichero que los secretos. Se INCRUSTAN en el bundle del
# navegador al compilar, asi que cambiarlas obliga a reconstruir; redesplegar no basta.
#
# Las tres de Identity Platform van con ${VAR:?...}: si faltan, el build PARA. Aqui se
# pasaban las de Supabase —muertas desde la migracion— y las de Firebase no se pasaban
# en absoluto, aunque el Dockerfile las declara. Una reconstruccion con eso habria dejado
# el bundle sin clave y el login caido, con un "auth/invalid-api-key" que no apunta aqui.
if [[ -f "$AQUI/.env.gcp" ]]; then
  set -a; source "$AQUI/.env.gcp"; set +a
fi

echo "Proyecto : $PROYECTO"
echo "Registro : $REGISTRO"
echo "Etiqueta : $TAG"
echo

# ── El lock tiene que traer los binarios de LINUX ────────────────────────────────────
# `npm install` en macOS PODA las dependencias opcionales de otras plataformas, asi que el
# lock se queda sin los binarios de Linux (rollup, napi-rs, swc...) y el `npm ci` de dentro
# del contenedor falla con "Missing: rollup@x from lock file".
#
# Ha pasado DOS veces: cada vez que se instala o quita un paquete desde el Mac. Se comprueba
# aqui para que el fallo salga en dos segundos y con una explicacion, en vez de a los cinco
# minutos de build con un mensaje que no menciona la causa.
echo "Comprobando que el lock sirve para Linux..."
if ! docker run --rm --platform linux/amd64 -v "$APP":/app:ro -w /tmp \
       -v "$APP/package.json":/tmp/package.json:ro -v "$APP/package-lock.json":/tmp/package-lock.json:ro \
       node:22-alpine sh -c 'npm ci --ignore-scripts --dry-run >/dev/null 2>&1'; then
  echo "" >&2
  echo "El package-lock.json no tiene los paquetes de Linux. Se regenera asi:" >&2
  echo "  docker run --rm --platform linux/amd64 -v \"\$PWD\":/app -w /app node:22-alpine \\" >&2
  echo "    npm install --package-lock-only --ignore-scripts" >&2
  echo "" >&2
  echo "Hay que rehacerlo cada vez que se instala o quita un paquete desde macOS." >&2
  exit 1
fi

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# --platform linux/amd64 es obligatorio desde un Mac con chip Apple: sin eso la imagen sale
# arm64 y Cloud Run la rechaza al desplegar, con un error que habla de la arquitectura del
# manifiesto y no de esto.
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="${NEXT_PUBLIC_FIREBASE_API_KEY:?falta en infra/.env.gcp — sin ella el bundle sale sin configuracion de Identity Platform y NADIE puede entrar}" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:?falta en infra/.env.gcp}" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="${NEXT_PUBLIC_FIREBASE_PROJECT_ID:?falta en infra/.env.gcp}" \
  --build-arg NEXT_PUBLIC_PROXY_URL="${NEXT_PUBLIC_PROXY_URL:-}" \
  --build-arg NEXT_PUBLIC_POSTHOG_KEY="${NEXT_PUBLIC_POSTHOG_KEY:-}" \
  --build-arg NEXT_PUBLIC_POSTHOG_HOST="${NEXT_PUBLIC_POSTHOG_HOST:-https://eu.i.posthog.com}" \
  --build-arg NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN:-}" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" \
  --build-arg NEXT_PUBLIC_AI_PROVIDER="${NEXT_PUBLIC_AI_PROVIDER:-}" \
  --build-arg NEXT_PUBLIC_BATCH_DISABLED="${NEXT_PUBLIC_BATCH_DISABLED:-}" \
  --build-arg SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}" \
  --build-arg SENTRY_ORG="${SENTRY_ORG:-}" \
  --build-arg SENTRY_PROJECT="${SENTRY_PROJECT:-}" \
  -t "$REGISTRO/scora:$TAG" -t "$REGISTRO/scora:latest" \
  "$APP"

docker push "$REGISTRO/scora:$TAG"
docker push "$REGISTRO/scora:latest"

echo
echo "Subida con la etiqueta $TAG."
echo "Para desplegarla:  cd infra/terraform && terraform apply -var=\"image_tag=$TAG\""
