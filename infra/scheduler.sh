#!/usr/bin/env bash
# Programa los 8 crons de la app en Cloud Scheduler (crea o actualiza; idempotente).
#
#   ./infra/scheduler.sh
#
# POR QUÉ ESTE SCRIPT (12-10-2026). infra/terraform/scheduler.tf define los crons, pero
# Terraform nunca se aplicó en este proyecto y nadie los creó a mano: en producción no corría
# NINGUNO. macro_state se quedó en la foto del 26-09, /daily no tenía ni un cierre y no salía
# ninguna alerta. Este script hace lo mismo que scheduler.tf, con los mismos horarios.
#
# El secreto se lee de Secret Manager (cron-secret), que es el que usa el servicio: el de
# infra/.env.gcp NO coincide. No se imprime. Queda en la configuración del job, visible para
# quien tenga permiso de leer Cloud Scheduler en el proyecto — el mismo compromiso que
# documenta scheduler.tf.
set -euo pipefail

PROYECTO="${GOOGLE_CLOUD_PROJECT:-scora-509716}"
REGION="${REGION:-europe-west1}"
SERVICIO="${SERVICIO:-scora}"

URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --project "$PROYECTO" --format='value(status.url)')"
SECRETO="$(gcloud secrets versions access latest --secret=cron-secret --project "$PROYECTO")"
[[ -n "$URL" && -n "$SECRETO" ]] || { echo "Falta la URL del servicio o el secreto" >&2; exit 1; }

# Horarios en UTC, idénticos a scheduler.tf (que explica por qué el orden importa:
# macro-refresh 11:00 → push-alerts 11:30 → alerts-check 13:00).
declare -a CRONS=(
  "13f-refresh|0 12 15 * *"
  "alerts-check|0 13 * * *"
  "macro-refresh|0 11 * * *"
  "insider-refresh|0 10 * * 1"
  "push-alerts|30 11 * * *"
  "ticker-alerts|0 14 * * 1-5"
  "macro-brief|0 12 * * 1"
  "daily-close|30 21 * * 1-5"
)

for entrada in "${CRONS[@]}"; do
  nombre="${entrada%%|*}"; horario="${entrada#*|}"
  job="scora-cron-$nombre"
  comunes=(--location "$REGION" --project "$PROYECTO" --schedule "$horario" --time-zone UTC
           --uri "$URL/api/cron/$nombre" --http-method GET
           --attempt-deadline 600s --max-retry-attempts 2 --min-backoff 60s --max-retry-duration 600s
           --description "Dispara /api/cron/$nombre")
  if gcloud scheduler jobs describe "$job" --location "$REGION" --project "$PROYECTO" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$job" "${comunes[@]}" \
      --update-headers "Authorization=Bearer $SECRETO" --quiet >/dev/null
    echo "✓ actualizado  $job  ($horario UTC)"
  else
    gcloud scheduler jobs create http "$job" "${comunes[@]}" \
      --headers "Authorization=Bearer $SECRETO" --quiet >/dev/null
    echo "✓ creado       $job  ($horario UTC)"
  fi
done
unset SECRETO
echo
echo "Para probar uno ahora:  gcloud scheduler jobs run scora-cron-macro-refresh --location $REGION"
