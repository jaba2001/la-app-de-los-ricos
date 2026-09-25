# Despliegue en Google Cloud

Todo el código está listo. Esto es lo que hay que hacer cuando exista la cuenta.

**Una sola app, un solo contenedor, un solo servicio.** Las páginas y las rutas `/api/*`
son la misma aplicación Next, así que lo que se despliega es una cosa.

**Piezas:** Cloud Run (la app), Artifact Registry (la imagen), Secret Manager (las claves)
y Cloud Scheduler (los 8 crons que antes corrían en `vercel.json`).

**Lo que NO se mueve:** Supabase, Upstash Redis, Stripe, Resend, Sentry y PostHog siguen
donde están. Solo cambia dónde corre el código.

---

## Antes de empezar

```bash
brew install --cask google-cloud-sdk
brew install terraform
# Docker Desktop tiene que estar arrancado
```

En Google Cloud: crear un proyecto y **activarle la facturación** (sin eso, Cloud Run ni
siquiera aparece).

```bash
gcloud auth login
gcloud auth application-default login     # el que usa Terraform, es otro distinto
gcloud config set project TU-PROYECTO
```

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
openssl rand -hex 32                 # para CRON_SECRET
npx web-push generate-vapid-keys     # para el par VAPID
```

Los dos ficheros están en `.gitignore`. Verificado.

## Paso 2 — Registro y secretos

```bash
cd infra/terraform
terraform init
terraform apply -target=google_project_service.enabled \
                -target=google_artifact_registry_repository.docker \
                -target=google_secret_manager_secret.backend
cd ../.. && ./infra/set-secrets.sh
```

Terraform crea los contenedores de los secretos; el script sube los valores. Esa separación
es a propósito: si Terraform gestionara las versiones, cada clave quedaría en texto plano
dentro del fichero de estado.

## Paso 3 — Construir y desplegar

```bash
./infra/build-and-push.sh
cd infra/terraform && terraform apply
terraform output url
```

Esto crea el servicio y los 8 trabajos de Cloud Scheduler.

## Paso 4 — Los enlaces de los avisos

Poner la URL que dio el paso anterior en `app_url` dentro de `terraform.tfvars` y:

```bash
terraform apply
```

Solo alimenta los enlaces de los correos y las notificaciones push. **La app funciona sin
esto**: al ser una sola aplicación, el navegador llama a su propio origen y no hay ninguna
URL que acertar.

## Paso 5 — La migración de Supabase

Ejecutar `apps/scora-research/sql/2026-09-05_sl_analyses_latest.sql` en el editor SQL de
Supabase. Sin ella la app funciona igual, solo que las consultas siguen trayendo el
historial entero en vez de una fila (hay un respaldo en el código que lo detecta).

---

## Comprobar que funciona

```bash
URL="$(cd infra/terraform && terraform output -raw url)"

# Las páginas
curl -s -o /dev/null -w "%{http_code}\n" "$URL"

# El contrato de las rutas: cada una que llama el cliente existe
PROXY_URL="$URL" node apps/scora-research/scripts/smoke-proxy.mjs

# Un cron a mano
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/macro-refresh"
```

Conviene además poner esa URL como variable `PROXY_URL` del repositorio en GitHub
(Settings → Secrets and variables → Actions → Variables), para que el CI vuelva a
comprobar el contrato en cada push. Sin ella ese paso se salta y lo dice.

---

## Cosas que conviene saber

**Arranque en frío.** `min_instances = 0` significa que no se paga nada mientras nadie
entra, a cambio de unos segundos en la primera petición. Cuando haya usuarios, subirlo a 1.

**Las rutas edge funcionan.** Las 20 rutas declaran `runtime = 'edge'` y se ejecutan bien en
el Node de Cloud Run — comprobado arrancando la salida standalone y llamándolas.

**Cambiar una `NEXT_PUBLIC_*` obliga a reconstruir** la imagen. Redesplegar no basta: esos
valores están dentro del JavaScript que va al navegador.

**El estado de Terraform contiene el `CRON_SECRET`** (viaja en la cabecera de los
schedulers). En cuanto exista el proyecto, descomentar el backend GCS en `versions.tf` y
apuntarlo a un bucket privado.

**Volver atrás.** La imagen se etiqueta con el SHA del commit:

```bash
terraform apply -var="image_tag=abc1234"
```

**Las otras apps del ecosistema.** `ic-suite`, `ic-datalayer-app` y `stock-lens-app` viven
fuera de este repo y consumían estas rutas en la URL antigua del proxy. Si siguen en uso,
hay que apuntarlas a la nueva y poner sus dominios en `allowed_origins`.
