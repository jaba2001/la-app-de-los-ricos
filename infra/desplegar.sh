#!/usr/bin/env bash
# Construye la imagen en Cloud Build y la despliega en Cloud Run. No necesita Docker local.
#
#   ./infra/desplegar.sh                  construir y desplegar
#   ./infra/desplegar.sh --solo-construir  solo la imagen (no toca producción): para comprobar
#
# Qué hace:
#   1. Se niega si hay cambios sin commit: lo desplegado tiene que ser exactamente un commit,
#      y la imagen se etiqueta con él (scora:<sha>).
#   2. Construye con las NEXT_PUBLIC_* de infra/.env.gcp. Next las incrusta AL CONSTRUIR (ver el
#      Dockerfile): cambiar una obliga a reconstruir, no basta con redesplegar.
#   3. Despliega y añade la configuración de servidor que no vive en el Dockerfile (push).
#   4. Comprueba la revisión nueva: páginas, 404 y que la API exige sesión.
#
# Volver atrás:  gcloud run services update-traffic scora --region europe-west1 --to-revisions=<anterior>=100
# (la revisión anterior se imprime al empezar).
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(dirname "$AQUI")"
APP="$RAIZ/apps/scora-research"
PROYECTO="${GOOGLE_CLOUD_PROJECT:-scora-509716}"
REGION=europe-west1
SERVICIO=scora
IMAGEN_BASE="$REGION-docker.pkg.dev/$PROYECTO/scora/scora"

cd "$RAIZ"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Hay cambios sin commit. Haz commit primero: lo desplegado debe ser un commit concreto." >&2
  exit 1
fi
TAG="$(git rev-parse --short HEAD)"

set -a; source "$AQUI/.env.gcp"; set +a
for v in NEXT_PUBLIC_FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID; do
  [[ -n "${!v:-}" ]] || { echo "Falta $v en infra/.env.gcp" >&2; exit 1; }
done

ANTERIOR="$(gcloud run services describe "$SERVICIO" --region "$REGION" --project "$PROYECTO" --format='value(status.latestReadyRevisionName)')"
echo "Revisión actual (para volver atrás): $ANTERIOR · se despliega $TAG"

# ── Construir ────────────────────────────────────────────────────────────────────────────
TMP="$(mktemp -d)"; CONFIG="$TMP/cloudbuild.yaml"
cat > "$CONFIG" <<'YAML'
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --build-arg=NEXT_PUBLIC_FIREBASE_API_KEY=${_FB_KEY}
      - --build-arg=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${_FB_DOMAIN}
      - --build-arg=NEXT_PUBLIC_FIREBASE_PROJECT_ID=${_FB_PROJECT}
      - --build-arg=NEXT_PUBLIC_POSTHOG_KEY=${_PH_KEY}
      - --build-arg=NEXT_PUBLIC_POSTHOG_HOST=${_PH_HOST}
      - --build-arg=NEXT_PUBLIC_SITE_URL=${_SITE}
      - --build-arg=NEXT_PUBLIC_VAPID_PUBLIC_KEY=${_VAPID}
      - --build-arg=NEXT_PUBLIC_EMAIL_ALERTS=${_EMAIL}
      - -t
      - ${_IMAGEN}:${_TAG}
      - .
images:
  - ${_IMAGEN}:${_TAG}
options:
  machineType: E2_HIGHCPU_8
timeout: 1800s
YAML
# Cloud Build sube lo que diga .gcloudignore; sin él subiría node_modules y .next.
cp "$APP/.dockerignore" "$APP/.gcloudignore"; printf '.gcloudignore\n' >> "$APP/.gcloudignore"
trap 'rm -f "$APP/.gcloudignore"; rm -rf "$TMP"' EXIT

gcloud builds submit "$APP" --region="$REGION" --project "$PROYECTO" --config="$CONFIG" \
  --substitutions="_IMAGEN=$IMAGEN_BASE,_TAG=$TAG,_FB_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY,_FB_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,_FB_PROJECT=$NEXT_PUBLIC_FIREBASE_PROJECT_ID,_PH_KEY=${NEXT_PUBLIC_POSTHOG_KEY:-},_PH_HOST=${NEXT_PUBLIC_POSTHOG_HOST:-https://eu.i.posthog.com},_SITE=${NEXT_PUBLIC_SITE_URL:-},_VAPID=${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-},_EMAIL=${NEXT_PUBLIC_EMAIL_ALERTS:-}"

if [[ "${1:-}" == "--solo-construir" ]]; then echo "✅ Imagen $IMAGEN_BASE:$TAG construida (no se ha desplegado)"; exit 0; fi

# ── Desplegar ────────────────────────────────────────────────────────────────────────────
EXTRA=()
if [[ -n "${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" ]]; then
  # Push: la clave pública también la necesita el servidor (crons push-alerts y ticker-alerts);
  # la privada sale de Secret Manager. El «subject» es la URL de la app, no un correo personal.
  URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --project "$PROYECTO" --format='value(status.url)')"
  EXTRA+=(--update-env-vars "VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY,VAPID_SUBJECT=$URL")
  EXTRA+=(--update-secrets "VAPID_PRIVATE_KEY=vapid-private-key:latest")
fi
gcloud run deploy "$SERVICIO" --image "$IMAGEN_BASE:$TAG" --region "$REGION" --project "$PROYECTO" --quiet ${EXTRA[@]+"${EXTRA[@]}"}

# ── Comprobar ────────────────────────────────────────────────────────────────────────────
URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --project "$PROYECTO" --format='value(status.url)')"
fallos=0
comprobar() { local ruta=$1 quiero=$2 metodo=${3:-GET}; local c; c="$(curl -s -o /dev/null -w '%{http_code}' -X "$metodo" "$URL$ruta")"
  if [[ "$c" == "$quiero" ]]; then echo "✓ $metodo $ruta → $c"; else echo "✖ $metodo $ruta → $c (se esperaba $quiero)"; fallos=$((fallos+1)); fi; }
for r in / /pricing /login /track-record /evidence /picks /daily /macro /stock/AAPL /discovery /api/publico; do comprobar "$r" 200; done
comprobar /no-existe 404
comprobar /api/batch 401 POST
comprobar /api/cron/macro-refresh 401
if (( fallos )); then
  echo "⚠ $fallos comprobaciones fallaron. Para volver atrás:"
  echo "  gcloud run services update-traffic $SERVICIO --region $REGION --to-revisions=$ANTERIOR=100"
  exit 1
fi
echo "✅ Desplegado $TAG en $URL"
