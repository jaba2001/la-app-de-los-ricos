output "url_app" {
  description = "URL publica de la app. Es la que hay que poner en var.app_url y reconstruir el frontend apuntando a ella."
  value       = google_cloud_run_v2_service.frontend.uri
}

output "url_backend" {
  description = "URL publica del backend. Es el NEXT_PUBLIC_PROXY_URL con el que hay que construir la imagen del frontend."
  value       = google_cloud_run_v2_service.ic_proxy.uri
}

output "registro_docker" {
  description = "A donde empujar las imagenes."
  value       = local.registro
}

output "siguiente_paso" {
  value = <<-EOT

    Las URLs ya existen. Quedan dos cosas que no se pueden hacer antes (huevo y gallina):

      1. Reconstruir la imagen del frontend con
         NEXT_PUBLIC_PROXY_URL=${google_cloud_run_v2_service.ic_proxy.uri}
         Esa variable se incrusta al compilar; no basta con redesplegar.

      2. Poner app_url = "${google_cloud_run_v2_service.frontend.uri}" en terraform.tfvars
         y volver a aplicar, para que el CORS del backend acepte a la app.

    Detalle en DEPLOY_GCP.md.
  EOT
}
