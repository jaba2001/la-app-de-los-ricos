#!/usr/bin/env bash
# Construye las dos imagenes y las sube a Artifact Registry.
#
#   ./infra/build-and-push.sh                     # las dos, etiqueta = SHA del commit
#   ./infra/build-and-push.sh v1                  # las dos, etiqueta a mano
#   ./infra/build-and-push.sh v1 ic-proxy         # solo el backend
#   ./infra/build-and-push.sh v1 scora-research   # solo la app
#
# Poder construir solo una no es comodidad: en el primer despliegue hace falta. La imagen del
# frontend lleva incrustada la URL del backend, y esa URL no existe hasta que el backend esta
# desplegado. El orden obligado es backend -> desplegar -> frontend.
#
# El SHA por defecto no es capricho: con `latest` no hay forma de volver a la version
# anterior cuando un despliegue sale mal, porque la etiqueta ya apunta a la nueva.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
TAG="${1:-$(git -C "$RAIZ" rev-parse --short HEAD)}"
APP="${2:-ambas}"
REGION="${REGION:-europe-west1}"

PROYECTO="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "$PROYECTO" || "$PROYECTO" == "(unset)" ]]; then
  echo "No hay proyecto. Usa: gcloud config set project TU-PROYECTO" >&2; exit 1
fi
REGISTRO="${REGION}-docker.pkg.dev/${PROYECTO}/scora"

# La URL del backend tiene que conocerse ANTES de construir el frontend: se incrusta en el
# bundle del navegador. Se lee de Cloud Run si el servicio ya existe.
if [[ "$APP" != "ic-proxy" && -z "${NEXT_PUBLIC_PROXY_URL:-}" ]]; then
  NEXT_PUBLIC_PROXY_URL="$(gcloud run services describe ic-proxy \
    --region="$REGION" --project="$PROYECTO" --format='value(status.url)' 2>/dev/null || true)"
fi
if [[ "$APP" != "ic-proxy" && -z "${NEXT_PUBLIC_PROXY_URL:-}" ]]; then
  echo "No se sabe la URL del backend, y hace falta para construir el frontend." >&2
  echo "Despliega primero ic-proxy, o pasala a mano:" >&2
  echo "  NEXT_PUBLIC_PROXY_URL=https://... ./infra/build-and-push.sh" >&2
  exit 1
fi

# Las NEXT_PUBLIC_* del frontend salen del mismo fichero que los secretos.
[[ -f "$AQUI/.env.gcp" ]] && { set -a; source "$AQUI/.env.gcp"; set +a; }

echo "Proyecto : $PROYECTO"
echo "Registro : $REGISTRO"
echo "Etiqueta : $TAG"
echo "Apps     : $APP"
if [[ "$APP" != "ic-proxy" ]]; then echo "Backend  : $NEXT_PUBLIC_PROXY_URL"; fi
echo

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

if [[ "$APP" == "ambas" || "$APP" == "ic-proxy" ]]; then
echo "── ic-proxy ──────────────────────────────────────────"
docker build \
  --platform linux/amd64 \
  -t "$REGISTRO/ic-proxy:$TAG" -t "$REGISTRO/ic-proxy:latest" \
  "$RAIZ/apps/ic-proxy"
docker push "$REGISTRO/ic-proxy:$TAG"
docker push "$REGISTRO/ic-proxy:latest"
fi

if [[ "$APP" == "ambas" || "$APP" == "scora-research" ]]; then
echo
echo "── scora-research ────────────────────────────────────"
# --platform linux/amd64 es obligatorio desde un Mac con chip Apple: sin eso la imagen sale
# arm64 y Cloud Run la rechaza al desplegar, con un error que habla de la arquitectura del
# manifiesto y no de esto.
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_PROXY_URL="$NEXT_PUBLIC_PROXY_URL" \
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
  -t "$REGISTRO/scora-research:$TAG" -t "$REGISTRO/scora-research:latest" \
  "$RAIZ/apps/scora-research"
docker push "$REGISTRO/scora-research:$TAG"
docker push "$REGISTRO/scora-research:latest"
fi

echo
echo "Subidas con la etiqueta $TAG."
echo "Para desplegarlas:  cd infra/terraform && terraform apply -var=\"image_tag=$TAG\""
