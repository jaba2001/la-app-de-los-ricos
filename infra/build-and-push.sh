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
if [[ -f "$AQUI/.env.gcp" ]]; then
  set -a; source "$AQUI/.env.gcp"; set +a
fi

echo "Proyecto : $PROYECTO"
echo "Registro : $REGISTRO"
echo "Etiqueta : $TAG"
echo

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# --platform linux/amd64 es obligatorio desde un Mac con chip Apple: sin eso la imagen sale
# arm64 y Cloud Run la rechaza al desplegar, con un error que habla de la arquitectura del
# manifiesto y no de esto.
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
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
