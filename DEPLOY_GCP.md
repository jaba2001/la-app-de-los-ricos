# Despliegue en Google Cloud

Todo el código está listo. Esto es lo que hay que hacer cuando exista la cuenta.

**Piezas:** Cloud Run (las dos apps), Artifact Registry (imágenes), Secret Manager
(credenciales) y Cloud Scheduler (los 8 crons que antes corrían en Vercel).

**Lo que NO se mueve:** Supabase, Upstash Redis, Stripe, Resend, Sentry y PostHog siguen
donde están. Solo cambia dónde corre el código.

---

## Antes de empezar

```bash
brew install --cask google-cloud-sdk
brew install terraform
# Docker Desktop tiene que estar arrancado
```

Y en Google Cloud: crear un proyecto y **activarle la facturación** (sin eso, Cloud Run
ni siquiera aparece).

```bash
gcloud auth login
gcloud auth application-default login     # el que usa Terraform, es otro distinto
gcloud config set project TU-PROYECTO
```

---

## El orden importa, y no es evidente

Hay una dependencia circular: **la imagen del frontend lleva incrustada la URL del
backend** (las `NEXT_PUBLIC_*` se sustituyen al compilar, no se leen al arrancar), y esa
URL no existe hasta que el backend está desplegado.

Por eso son tres `apply` y no uno:

```
1. registro + secretos  →  2. imagen del backend  →  3. desplegar backend (nace la URL)
                        →  4. imagen del frontend con esa URL  →  5. desplegar todo
```

Saltarse el orden no da un error claro: la app arranca perfectamente y luego no encuentra
el backend, sin un solo error en los logs del servidor porque el fallo está en el navegador.

---

## Paso 1 — Credenciales

```bash
cp infra/.env.gcp.example infra/.env.gcp
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

Rellenar los dos. Lo mínimo para que arranque: `FMP_KEY`, `FINNHUB_KEY`, `FRED_KEY`, las
tres de Supabase y `CRON_SECRET`. El resto puede ir en blanco — el código lo tolera y
simplemente desactiva esa función.

`CRON_SECRET` tiene que ser **el mismo** en los dos ficheros. Si no coinciden, los 8 crons
reciben 401 y los datos macro dejan de actualizarse sin que nada avise.

```bash
openssl rand -hex 32     # para CRON_SECRET
npx web-push generate-vapid-keys   # para el par VAPID
```

Los dos ficheros están en `.gitignore`. Verificado.

## Paso 2 — Registro y secretos

```bash
cd infra/terraform
terraform init
terraform apply -target=google_project_service.enabled \
                -target=google_artifact_registry_repository.docker \
                -target=google_secret_manager_secret.backend
```

```bash
cd ../.. && ./infra/set-secrets.sh
```

Sube los valores a Secret Manager. Terraform crea los contenedores vacíos pero nunca los
valores: si los gestionara él, cada clave quedaría en texto plano en el fichero de estado.

## Paso 3 — Backend

```bash
./infra/build-and-push.sh latest ic-proxy
cd infra/terraform && terraform apply -target=google_cloud_run_v2_service.ic_proxy
terraform output url_backend
```

Comprobación rápida — tiene que responder **401**, que significa "la ruta existe y exige
autenticación":

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$(terraform output -raw url_backend)/api/fmp/quote?symbol=AAPL"
```

## Paso 4 — Frontend

```bash
cd ../.. && ./infra/build-and-push.sh latest scora-research
```

El script lee la URL del backend de Cloud Run y la incrusta. No hace falta pasarla a mano.

## Paso 5 — Todo lo demás

```bash
cd infra/terraform && terraform apply
```

Crea el servicio del frontend y los 8 trabajos de Cloud Scheduler.

## Paso 6 — Cerrar el círculo del CORS

Ahora ya se conoce la URL de la app, y el backend necesita saberla para dejarla entrar:

```bash
terraform output url_app
```

Poner ese valor en `app_url` dentro de `terraform.tfvars` y:

```bash
terraform apply
```

Sin esto, el navegador recibe un error de CORS en cada llamada — y en la consola del
navegador, no en los logs del servidor.

## Paso 7 — La migración de Supabase

```sql
-- apps/scora-research/sql/2026-09-05_sl_analyses_latest.sql
```

Ejecutarla en el editor SQL de Supabase. Sin ella la app funciona igual, solo que las
consultas siguen trayendo el historial entero en vez de una fila (hay un respaldo en el
código que lo detecta).

---

## Comprobar que funciona

```bash
# El contrato del backend: cada ruta que llama el frontend existe
PROXY_URL="$(cd infra/terraform && terraform output -raw url_backend)" \
  node apps/scora-research/scripts/smoke-proxy.mjs

# Un cron a mano
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$(cd infra/terraform && terraform output -raw url_backend)/api/cron/macro-refresh"
```

---

## Cosas que conviene saber

**Arranque en frío.** `min_instances = 0` significa que no se paga nada mientras nadie
entra, a cambio de unos segundos en la primera petición. Cuando haya usuarios, subir a 1 el
del backend: es quien responde al abrir un ticker y ahí el retraso se nota.

**Las rutas edge funcionan.** Las 20 rutas del backend declaran `runtime = 'edge'` y se
ejecutan bien en el Node de Cloud Run — comprobado arrancando la salida standalone y
llamándolas. No hubo que reescribir ninguna.

**Cambiar una `NEXT_PUBLIC_*` obliga a reconstruir** la imagen del frontend. Redesplegar no
basta; esos valores están dentro del JavaScript que va al navegador.

**El estado de Terraform contiene el `CRON_SECRET`** (viaja en la cabecera de los
schedulers). En cuanto exista el proyecto, descomentar el backend GCS en `versions.tf` y
apuntarlo a un bucket privado.

**Volver atrás.** Las imágenes se etiquetan con el SHA del commit:

```bash
terraform apply -var="image_tag=abc1234"
```

**Lo que queda de Vercel en el código.** `vercel.json`, `@vercel/analytics` y
`@vercel/speed-insights` siguen ahí. No estorban en Cloud Run —los dos paquetes no hacen
nada fuera de Vercel— pero se pueden quitar cuando apetezca.
