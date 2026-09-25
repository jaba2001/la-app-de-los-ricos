#!/usr/bin/env bash
# Sube los valores de los secretos a Secret Manager desde un fichero local.
#
# POR QUE NO LO HACE TERRAFORM: porque entonces cada clave quedaria en texto plano dentro del
# fichero de estado. Terraform crea el contenedor vacio de cada secreto; los valores los pone
# este script y no pasan por el estado en ningun momento.
#
#   cp infra/.env.gcp.example infra/.env.gcp   # y rellenar
#   ./infra/set-secrets.sh
#
# Es idempotente: cada ejecucion anade una version nueva y Cloud Run usa siempre la ultima.
# Para rotar una clave, se cambia en el fichero, se vuelve a lanzar y se redespliega.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$AQUI/.env.gcp}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No encuentro $ENV_FILE." >&2
  echo "Copia infra/.env.gcp.example a infra/.env.gcp y rellenalo." >&2
  exit 1
fi

if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  GOOGLE_CLOUD_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
fi
if [[ -z "$GOOGLE_CLOUD_PROJECT" || "$GOOGLE_CLOUD_PROJECT" == "(unset)" ]]; then
  echo "No hay proyecto de GCP seleccionado. Usa: gcloud config set project TU-PROYECTO" >&2
  exit 1
fi
echo "Proyecto: $GOOGLE_CLOUD_PROJECT"

# Mismo listado que infra/terraform/secrets.tf. Si se anade uno alli, anadirlo aqui.
SECRETOS=(
  FMP_KEY FINNHUB_KEY FRED_KEY SIMFIN_KEY
  ANTHROPIC_KEY GROQ_KEY GEMINI_KEY
  SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY SUPABASE_JWT_SECRET
  UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN
  UPSTASH_CACHE_REST_URL UPSTASH_CACHE_REST_TOKEN
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  RESEND_KEY VAPID_PRIVATE_KEY ELEVENLABS_KEY
  CRON_SECRET
)

set -a; source "$ENV_FILE"; set +a

puestos=0; vacios=0
for nombre in "${SECRETOS[@]}"; do
  id="$(echo "$nombre" | tr 'A-Z_' 'a-z-')"
  valor="${!nombre:-}"

  # Un secreto SIN NINGUNA VERSION impide que Cloud Run arranque: el contenedor no levanta y
  # el error no dice "falta el secreto X". Por eso los que se dejan en blanco se suben como
  # cadena vacia, que el codigo trata igual que ausente (todas las comprobaciones son `if
  # (!process.env.X)`), y asi el servicio arranca aunque falte un proveedor opcional.
  if [[ -z "$valor" ]]; then
    vacios=$((vacios+1))
    printf '  %-26s (vacio)\n' "$nombre"
  else
    puestos=$((puestos+1))
    printf '  %-26s ✓\n' "$nombre"
  fi

  if ! gcloud secrets describe "$id" --project="$GOOGLE_CLOUD_PROJECT" >/dev/null 2>&1; then
    echo "     ⚠ el secreto '$id' no existe todavia. Lanza primero:"
    echo "       cd infra/terraform && terraform apply -target=google_secret_manager_secret.backend"
    exit 1
  fi
  printf '%s' "$valor" | gcloud secrets versions add "$id" \
    --project="$GOOGLE_CLOUD_PROJECT" --data-file=- >/dev/null
done

echo
echo "Listo: $puestos con valor, $vacios vacios."
if [[ $vacios -gt 0 ]]; then echo "Los vacios desactivan su funcion (el codigo lo tolera), no rompen el arranque."; fi
