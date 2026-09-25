# Los 8 crons que Vercel ejecutaba desde vercel.json.
#
# Los horarios son EXACTAMENTE los mismos, y eso importa mas de lo que parece: varios estan
# encadenados a proposito (macro-refresh a las 11:00 escribe macro_state; push-alerts a las
# 11:30 lo lee; alerts-check a las 13:00 va despues de ambos). Moverlos de sitio rompe esa
# cadena sin que nada falle — simplemente se envian alertas con datos de ayer.
#
# La zona horaria es UTC, igual que en Vercel. Cambiarla a Europe/Madrid desplazaria todos
# los trabajos una o dos horas segun la epoca del ano, y los que van "tras el cierre de Nueva
# York" dejarian de ir tras el cierre la mitad del ano.
locals {
  crons = {
    "13f-refresh"     = "0 12 15 * *"
    "alerts-check"    = "0 13 * * *"
    "macro-refresh"   = "0 11 * * *"
    "insider-refresh" = "0 10 * * 1"
    "push-alerts"     = "30 11 * * *"
    "ticker-alerts"   = "0 14 * * 1-5"
    "macro-brief"     = "0 12 * * 1"
    "daily-close"     = "30 21 * * 1-5"
  }
}

resource "google_cloud_scheduler_job" "crons" {
  for_each = local.crons

  name        = "scora-cron-${each.key}"
  description = "Dispara /api/cron/${each.key} en el backend"
  schedule    = each.value
  time_zone   = "UTC"
  region      = var.region

  # Un cron que falla se reintenta, pero sin insistir: casi todos son idempotentes por fecha
  # y el siguiente disparo arreglara lo que quedara a medias.
  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_retry_duration   = "600s"
  }

  http_target {
    http_method = "GET"
    uri         = "${google_cloud_run_v2_service.ic_proxy.uri}/api/cron/${each.key}"

    headers = {
      # lib/cron.js compara esto con CRON_SECRET. Es un secreto compartido, asi que queda en
      # el estado de Terraform: de ahi la insistencia en un backend GCS privado.
      Authorization = "Bearer ${var.cron_secret}"
    }
  }

  depends_on = [google_project_service.enabled]
}
