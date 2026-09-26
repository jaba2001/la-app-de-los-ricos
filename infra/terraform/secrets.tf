# Los valores sensibles del backend.
#
# Terraform crea AQUI el contenedor de cada secreto, pero NUNCA su contenido: los valores los
# sube `infra/set-secrets.sh` desde un fichero local que no entra en git. Esa separacion es
# deliberada — si Terraform gestionara las versiones, cada secreto quedaria en texto plano
# dentro del fichero de estado.
locals {
  secretos_backend = [
    # Proveedores de datos de mercado
    "FMP_KEY",
    "FINNHUB_KEY",
    "FRED_KEY",
    "SIMFIN_KEY",
    # Modelos de lenguaje
    "ANTHROPIC_KEY",
    "GROQ_KEY",
    "GEMINI_KEY",
    # Supabase
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_JWT_SECRET",
    # Redis (Upstash). La URL lleva el identificador de la instancia, asi que va con el token.
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "UPSTASH_CACHE_REST_URL",
    "UPSTASH_CACHE_REST_TOKEN",
    # Cobros
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    # Notificaciones
    "RESEND_KEY",
    "VAPID_PRIVATE_KEY",
    "ELEVENLABS_KEY",
    # Crons
    "CRON_SECRET",
    # Cloud SQL
    "PGPASSWORD",
  ]
}

resource "google_secret_manager_secret" "backend" {
  for_each  = toset(local.secretos_backend)
  secret_id = lower(replace(each.value, "_", "-"))

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}
