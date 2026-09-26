locals {
  registro = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"

  # Config NO sensible. Va como variable de entorno normal: meterla en Secret Manager solo
  # anadiria ruido y coste sin proteger nada que no sea ya publico.
  config = {
    NODE_ENV = "production"
    # Limites diarios de IA por plan (lib/server/quota.js). Sin esto, 5 y 100.
    AI_DAILY_FREE = "5"
    AI_DAILY_PRO  = "100"
    # Proveedor de modelo de /api/llm y su respaldo.
    LLM_PROVIDER = "groq"
    LLM_FALLBACK = "gemini"
    # Cuando el limitador no puede hablar con Redis: "1" devuelve 503 en vez de dejar pasar.
    # Merece la pena encenderlo en cuanto Upstash este confirmado: lo que protege es el gasto.
    RATELIMIT_FAIL_CLOSED = "0"
  }
}

# ── El servicio ──────────────────────────────────────────────────────────────────────
#
# UNO SOLO. Las paginas y las rutas /api/* viven en la misma app Next, asi que tambien en el
# mismo contenedor. Eso elimina de golpe tres cosas que existian cuando eran dos: el CORS
# entre dominios, el salto de red entre la app y su backend, y la dependencia circular del
# despliegue (la imagen de la app ya no necesita saber la URL del backend, porque es ella).
resource "google_cloud_run_v2_service" "scora" {
  name                = "scora"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.scora.email

    scaling {
      min_instance_count = var.min_instances
      # Techo de gasto, no de rendimiento: si algo se descontrola, que la factura tenga tope.
      max_instance_count = 10
    }

    containers {
      image = "${local.registro}/scora:${var.image_tag}"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi" # 1 Gi y no 512 Mi: ahora el mismo proceso sirve las paginas y las 25 rutas
        }
        # La CPU solo se factura mientras se atiende una peticion. Esta app es E/S casi pura
        # (espera a FMP, a Supabase, a Anthropic), no necesita CPU de fondo.
        cpu_idle = true
      }

      ports {
        container_port = 8080
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.config
        content {
          name  = env.key
          value = env.value
        }
      }

      // La conexion a Cloud SQL. Cloud Run monta un socket en /cloudsql/<instancia> y el
      // trafico va cifrado por el proxy de Google: no hay contraseña por la red abierta ni
      // IP que autorizar en el cortafuegos de la base.
      env {
        name  = "CLOUD_SQL_INSTANCE"
        value = var.cloud_sql_instance
      }
      env {
        name  = "PGDATABASE"
        value = "scora"
      }
      env {
        name  = "PGUSER"
        value = "postgres"
      }

      env {
        name  = "APP_URL"
        value = var.app_url
      }
      # El CORS ya no hace falta para la propia app (mismo origen). Sigue aqui por las OTRAS
      # apps del ecosistema que consumen estas rutas: ic-suite, ic-datalayer-app y
      # stock-lens-app. Si dejan de existir, esta variable se puede vaciar.
      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }
      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "VAPID_PUBLIC_KEY"
        value = var.vapid_public_key
      }
      env {
        name  = "VAPID_SUBJECT"
        value = var.vapid_subject
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.backend
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        # Next tarda un par de segundos en levantar. Con un margen corto, Cloud Run mata el
        # contenedor antes de que arranque y el despliegue entra en bucle sin explicar nada.
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
        tcp_socket {
          port = 8080
        }
      }
    }

    # Sin esto el socket /cloudsql/... no existe dentro del contenedor y cada consulta
    # falla con ENOENT — un error que no menciona Cloud SQL por ninguna parte.
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_instance]
      }
    }

    # Los crons pueden tardar: 13f-refresh recorre cientos de posiciones.
    timeout = "900s"
  }

  depends_on = [google_project_service.enabled]
}

# Web abierta. Quien decide que puede hacer cada visitante es el codigo (requireUser, CORS,
# rate limit), no la IAM de Cloud Run.
resource "google_cloud_run_v2_service_iam_member" "publico" {
  name     = google_cloud_run_v2_service.scora.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
