output "url" {
  description = "La URL publica. Sirve las paginas y las rutas /api/* — es una sola app."
  value       = google_cloud_run_v2_service.scora.uri
}

output "registro_docker" {
  description = "A donde empujar la imagen."
  value       = local.registro
}

output "siguiente_paso" {
  value = <<-EOT

    Desplegado en ${google_cloud_run_v2_service.scora.uri}

    Queda una cosa: poner esa URL en `app_url` dentro de terraform.tfvars y volver a
    aplicar. Alimenta los enlaces de los correos y las notificaciones push.

    (Ya NO hace falta reconstruir nada para que la app encuentre su backend: desde la
    fusion en una sola app, las llamadas son al mismo origen.)
  EOT
}
