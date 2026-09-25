terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # El estado guarda valores sensibles (entre otros, CRON_SECRET, que viaja en la cabecera
  # de los trabajos de Cloud Scheduler). NO dejarlo en local ni en el repo: descomentar esto
  # apuntando a un bucket privado en cuanto exista el proyecto.
  #
  # backend "gcs" {
  #   bucket = "TU-BUCKET-DE-ESTADO"
  #   prefix = "scora/terraform"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
