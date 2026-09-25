variable "project_id" {
  description = "ID del proyecto de Google Cloud (no el nombre: el id, que es unico)."
  type        = string
}

variable "region" {
  description = <<-EOT
    Region de Cloud Run y Cloud Scheduler.

    Por defecto europe-west1 (Belgica) porque el resto de la pila ya esta en Europa:
    PostHog apunta a eu.i.posthog.com y Supabase suele estar en eu-*. Cuanto mas cerca
    esten entre si, menos latencia paga cada peticion del proxy a la base de datos.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "cron_secret" {
  description = <<-EOT
    El mismo valor que la variable CRON_SECRET del backend. Cloud Scheduler lo manda en la
    cabecera Authorization y lib/cron.js lo comprueba.

    Queda en el estado de Terraform: de ahi que el backend deba ser un bucket privado.
    Alternativa mas dura, si algun dia compensa: cambiar lib/cron.js para validar un token
    OIDC firmado por Google y quitar el secreto compartido del todo.
  EOT
  type        = string
  sensitive   = true
}

variable "min_instances" {
  description = <<-EOT
    Instancias siempre encendidas por servicio.

    0 = no se paga nada mientras nadie usa la app, a cambio de un arranque en frio de unos
    segundos en la primera peticion. Es lo correcto mientras no haya usuarios. Subir a 1 el
    del backend en cuanto los haya: es quien recibe la reaccion del usuario al abrir un
    ticker, y el arranque en frio se nota ahi.
  EOT
  type        = number
  default     = 0
}

variable "image_tag" {
  description = "Etiqueta de las imagenes a desplegar. `latest` vale para empezar; para poder volver atras, usar el SHA del commit."
  type        = string
  default     = "latest"
}

variable "app_url" {
  description = <<-EOT
    URL publica de la app. Alimenta los enlaces de los correos y de las notificaciones push.

    Ya NO es critica para que la app funcione: desde que las paginas y las rutas /api/* estan
    en la misma app, el navegador llama al mismo origen y no hay CORS que acertar. Si esta
    mal, lo unico que sale mal son los enlaces de los avisos.
  EOT
  type        = string
  default     = "https://PENDIENTE-tras-el-primer-apply"
}

variable "allowed_origins" {
  description = <<-EOT
    Origenes EXTERNOS que pueden llamar a /api/* desde un navegador, separados por comas.

    La propia app no necesita estar aqui (mismo origen). Esto existe por las otras apps del
    ecosistema que comparten estas rutas — ic-suite, ic-datalayer-app y stock-lens-app —, que
    siguen viviendo fuera de este repo. Vaciarlo si dejan de usarse.
  EOT
  type        = string
  default     = ""
}

variable "supabase_url" {
  description = "URL del proyecto de Supabase (https://xxxx.supabase.co). No es secreta: aparece en el bundle del navegador."
  type        = string
}

variable "vapid_public_key" {
  description = "Clave publica VAPID de las notificaciones push. Publica por definicion — la privada va en Secret Manager."
  type        = string
  default     = ""
}

variable "vapid_subject" {
  description = "Contacto VAPID, en formato mailto:. Los servicios de push lo exigen para poder avisar si algo va mal."
  type        = string
  default     = "mailto:alerts@scora.app"
}
