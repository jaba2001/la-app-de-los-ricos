# Una identidad por servicio, en vez de la cuenta por defecto de Compute (que es
# practicamente omnipotente en el proyecto). Si algun dia se compromete el backend, lo que
# puede tocar es exactamente lo que se le concede aqui abajo y nada mas.

resource "google_service_account" "ic_proxy" {
  account_id   = "scora-ic-proxy"
  display_name = "Cloud Run — ic-proxy (backend de datos)"
}

resource "google_service_account" "frontend" {
  account_id   = "scora-frontend"
  display_name = "Cloud Run — scora-research (la app)"
}

resource "google_service_account" "scheduler" {
  account_id   = "scora-scheduler"
  display_name = "Cloud Scheduler — dispara los crons del backend"
}

# El backend lee secretos; el frontend no necesita ninguno en ejecucion, porque sus
# NEXT_PUBLIC_* se incrustan al construir la imagen (ver su Dockerfile).
resource "google_secret_manager_secret_iam_member" "ic_proxy_lee" {
  for_each  = google_secret_manager_secret.backend
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ic_proxy.email}"
}
