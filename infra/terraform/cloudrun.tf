locals {
  registro = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"

  # Config NO sensible del backend. Va como variable de entorno normal: meterla en Secret
  # Manager solo anadiria ruido y coste sin proteger nada que no sea ya publico.
  #
  # Los valores de aqui son los que el codigo toma por defecto cuando faltan; cambiarlos es
  # cambiar comportamiento, asi que estan explicitos en vez de implicitos.
  config_backend = {
    NODE_ENV = "production"
    # Limites diarios de IA por plan (lib/quota.js). Sin esto, 5 y 100.
    AI_DAILY_FREE = "5"
    AI_DAILY_PRO  = "100"
    # Proveedor de modelo del backend y su respaldo (app/api/llm).
    LLM_PROVIDER = "groq"
    LLM_FALLBACK = "gemini"
    # Cuando el limitador no puede hablar con Redis: "1" devuelve 503 en vez de dejar pasar.
    # Merece la pena encenderlo en cuanto Upstash este confirmado en produccion — el que
    # protege es el gasto en Anthropic.
    RATELIMIT_FAIL_CLOSED = "0"
  }
}

# ── Backend ──────────────────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "ic_proxy" {
  name     = "ic-proxy"
  location = var.region

  # Sin esto, cualquiera con la URL del servicio puede invocarlo antes de que la IAM de abajo
  # se aplique. El control real de acceso vive en el propio codigo (requireUser + CORS).
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.ic_proxy.email

    scaling {
      min_instance_count = var.min_instances
      # Techo de gasto, no de rendimiento: si algo se descontrola, que la factura tenga tope.
      max_instance_count = 10
    }

    containers {
      image = "${local.registro}/ic-proxy:${var.image_tag}"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # La CPU solo se factura mientras se atiende una peticion. El backend es E/S casi
        # pura (espera a FMP, a Supabase, a Anthropic), asi que no necesita CPU de fondo.
        cpu_idle = true
      }

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = local.config_backend
        content {
          name  = env.key
          value = env.value
        }
      }

      # La URL publica del propio servicio y la de la app. Se rellenan tras el primer apply
      # (ver el paso 6 del runbook): Cloud Run no conoce su URL hasta existir.
      env {
        name  = "APP_URL"
        value = var.app_url
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = var.app_url
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

    # Los crons de research pueden tardar: 13f-refresh recorre cientos de posiciones.
    timeout = "900s"
  }

  depends_on = [google_project_service.enabled]
}

# ── La app ───────────────────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  name                = "scora-research"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.frontend.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 10
    }

    containers {
      image = "${local.registro}/scora-research:${var.image_tag}"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # Ojo: el frontend NO recibe aqui sus NEXT_PUBLIC_*. Esas van incrustadas en la imagen
      # al construirla (ver apps/scora-research/Dockerfile). Ponerlas aqui no haria nada.

      startup_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

# ── Acceso publico ───────────────────────────────────────────────────────────────────
# Las dos son webs abiertas. Quien decide que puede hacer cada visitante es el codigo
# (requireUser, CORS, rate limit), no la IAM de Cloud Run.
resource "google_cloud_run_v2_service_iam_member" "ic_proxy_publico" {
  name     = google_cloud_run_v2_service.ic_proxy.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_publico" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
