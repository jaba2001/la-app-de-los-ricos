# Las APIs que hay que habilitar en el proyecto. Sin esto, el primer `apply` falla con un
# error que no dice "habilita la API" sino un 403 generico, y se pierde un rato averiguandolo.
locals {
  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.apis)
  service  = each.value

  # No deshabilitar la API al destruir: apagar Secret Manager o Artifact Registry por un
  # `terraform destroy` afectaria a cualquier otra cosa del proyecto que las use.
  disable_on_destroy = false
}
