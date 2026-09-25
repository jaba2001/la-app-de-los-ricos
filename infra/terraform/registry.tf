resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = "scora"
  description   = "Imagenes de contenedor de las dos apps"
  format        = "DOCKER"

  # Las imagenes viejas se acumulan y se pagan. Se conservan las 10 ultimas de cada app, que
  # es holgado para volver atras sin guardar meses de builds.
  cleanup_policies {
    id     = "conservar-10-ultimas"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.enabled]
}
