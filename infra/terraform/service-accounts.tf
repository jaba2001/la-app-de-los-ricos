# Una identidad propia, en vez de la cuenta por defecto de Compute (que es practicamente
# omnipotente en el proyecto). Si algun dia se compromete el servicio, lo que puede tocar es
# exactamente lo que se le concede aqui abajo y nada mas.

resource "google_service_account" "scora" {
  account_id   = "scora-app"
  display_name = "Cloud Run — Scora (la app y sus rutas API)"
}

resource "google_service_account" "scheduler" {
  account_id   = "scora-scheduler"
  display_name = "Cloud Scheduler — dispara los crons"
}

resource "google_secret_manager_secret_iam_member" "lee_secretos" {
  for_each  = google_secret_manager_secret.backend
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.scora.email}"
}
