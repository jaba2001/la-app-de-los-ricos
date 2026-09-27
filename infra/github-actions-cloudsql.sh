#!/usr/bin/env bash
# Deja a los workflows de research de GitHub Actions escribir en Cloud SQL (AUDIT_REPORT C-5).
#
#   ./infra/github-actions-cloudsql.sh
#
# Qué crea (todo idempotente: relanzarlo no duplica nada ni cambia lo que ya está bien):
#   1. La cuenta de servicio scora-gh-jobs, con roles/cloudsql.client y nada más.
#   2. Un pool de Workload Identity Federation para GitHub, con un proveedor que SOLO acepta
#      tokens de este repositorio. Sin clave JSON: el token de GitHub se cambia por uno de GCP
#      de corta duración en cada ejecución (.github/actions/cloud-sql).
#   3. El usuario de base de datos scora_jobs, con una contraseña aleatoria. Sus permisos (solo
#      las tablas de research) los da sql/gcp/006_rol_jobs.sql, que hay que aplicar aparte.
#   4. Los secretos del repositorio: GCP_WIF_PROVIDER, GCP_JOBS_SA, PGUSER, PGPASSWORD, y las
#      claves de datos que usan los workflows (FINNHUB_KEY, FRED_KEY, TIINGO_TOKEN) si están
#      en infra/.env.gcp. Los valores van por stdin a `gh`: no se imprimen ni quedan en el
#      historial.
#
# Requisitos: gcloud con permiso de administrador en el proyecto y `gh` autenticado con
# permiso de administración sobre el repositorio.
set -euo pipefail

PROYECTO="${GOOGLE_CLOUD_PROJECT:-scora-509716}"
INSTANCIA="${CLOUD_SQL_INSTANCE_NAME:-scora-db}"
REPO="${GITHUB_REPO:-jaba2001/la-app-de-los-ricos}"
SA_NOMBRE="scora-gh-jobs"
SA="$SA_NOMBRE@$PROYECTO.iam.gserviceaccount.com"
POOL="github"
PROVEEDOR="la-app-de-los-ricos"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$AQUI/.env.gcp"

NUM="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')"
echo "Proyecto $PROYECTO ($NUM) · instancia $INSTANCIA · repo $REPO"

# ── 1. Cuenta de servicio ────────────────────────────────────────────────────────────────
if ! gcloud iam service-accounts describe "$SA" --project "$PROYECTO" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NOMBRE" --project "$PROYECTO" \
    --display-name "GitHub Actions — workflows de research (Cloud SQL)"
fi
gcloud projects add-iam-policy-binding "$PROYECTO" --quiet \
  --member "serviceAccount:$SA" --role roles/cloudsql.client --condition=None >/dev/null
echo "✓ cuenta de servicio $SA con roles/cloudsql.client"

# ── 2. Workload Identity Federation ──────────────────────────────────────────────────────
if ! gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROYECTO" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROYECTO" \
    --display-name "GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVEEDOR" --workload-identity-pool "$POOL" \
      --location global --project "$PROYECTO" >/dev/null 2>&1; then
  # La condición es la barrera: sin ella, CUALQUIER repositorio de GitHub podría pedir tokens
  # contra este pool.
  gcloud iam workload-identity-pools providers create-oidc "$PROVEEDOR" --project "$PROYECTO" \
    --location global --workload-identity-pool "$POOL" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository == '$REPO'"
fi
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROYECTO" --quiet \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" >/dev/null
WIF="projects/$NUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVEEDOR"
echo "✓ federación: solo $REPO puede actuar como $SA"

# ── 3. Usuario de base de datos ──────────────────────────────────────────────────────────
CLAVE="$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40)"
if gcloud sql users list --instance "$INSTANCIA" --project "$PROYECTO" --format='value(name)' | grep -qx scora_jobs; then
  gcloud sql users set-password scora_jobs --instance "$INSTANCIA" --project "$PROYECTO" --password "$CLAVE" >/dev/null
  echo "✓ usuario scora_jobs: contraseña renovada"
else
  gcloud sql users create scora_jobs --instance "$INSTANCIA" --project "$PROYECTO" --password "$CLAVE" >/dev/null
  echo "✓ usuario scora_jobs creado"
fi

# ── 4. Secretos del repositorio ──────────────────────────────────────────────────────────
printf '%s' "$WIF"       | gh secret set GCP_WIF_PROVIDER -R "$REPO"
printf '%s' "$SA"        | gh secret set GCP_JOBS_SA      -R "$REPO"
printf '%s' scora_jobs   | gh secret set PGUSER           -R "$REPO"
printf '%s' "$CLAVE"     | gh secret set PGPASSWORD       -R "$REPO"
unset CLAVE
if [[ -f "$ENV_FILE" ]]; then
  for k in FINNHUB_KEY FRED_KEY TIINGO_TOKEN; do
    v="$(grep -E "^$k=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^["'"'"']|["'"'"']$//g' || true)"
    if [[ -n "$v" ]]; then printf '%s' "$v" | gh secret set "$k" -R "$REPO"; echo "✓ secreto $k"; else echo "· $k no está en $ENV_FILE (el workflow que lo use funcionará sin él o fallará avisando)"; fi
  done
fi
echo "✓ secretos del repositorio: GCP_WIF_PROVIDER, GCP_JOBS_SA, PGUSER, PGPASSWORD"

cat <<FIN

Falta, como postgres y a través del proxy (cloud-sql-proxy --port 5433 $PROYECTO:europe-west1:$INSTANCIA):
  psql -h 127.0.0.1 -p 5433 -U postgres -d scora -f apps/scora-research/sql/gcp/004_smart_money_13f.sql
  psql -h 127.0.0.1 -p 5433 -U postgres -d scora -f apps/scora-research/sql/gcp/005_desfases_research.sql
  psql -h 127.0.0.1 -p 5433 -U postgres -d scora -f apps/scora-research/sql/gcp/006_rol_jobs.sql
y la copia de datos (scripts/migrar_supabase.mjs). El orden completo está en AUDIT_REPORT.md, C-5.
FIN
