#!/usr/bin/env bash
# La mudanza de datos a Cloud SQL (AUDIT_REPORT C-5), de principio a fin y en el orden bueno:
# COPIAR PRIMERO, ACTIVAR DESPUÉS.
#
#   ./infra/migrar-produccion.sh              la mudanza entera
#   ./infra/migrar-produccion.sh --sin-pisar  más adelante: SOLO la copia, sin tocar ninguna fila
#                                             que ya exista (para lo que Supabase escriba hasta
#                                             que se paren sus crons). No reactiva nada.
#
#   1. Abre un túnel a la base de producción (cloud-sql-proxy con tu sesión de gcloud: no hace
#      falta `gcloud auth application-default login`).
#   2. Aplica sql/gcp/004–007. Aditivas e idempotentes: relanzarlas no cambia nada.
#   3. Copia los datos de Supabase: primero un SIMULACRO que no escribe, te enseña el resumen
#      y te pregunta antes de copiar de verdad.
#   4. Activa los workflows de GitHub contra Cloud SQL (infra/github-actions-cloudsql.sh:
#      cuenta de servicio, federación con GitHub, usuario scora_jobs y secretos del repo).
#   5. Lanza un workflow de prueba y espera a ver cómo acaba.
#
# Si algo falla se para ahí mismo y el túnel se cierra igual. Ninguna clave se imprime.
#
# Lo prepara Claude porque el control de permisos de su sesión no le deja conectarse a la
# base de producción: esto lo lanza Jorge, con sus credenciales.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(dirname "$AQUI")"
APP="$RAIZ/apps/scora-research"
PROYECTO="${GOOGLE_CLOUD_PROJECT:-scora-509716}"
INSTANCIA="$PROYECTO:europe-west1:scora-db"
PUERTO="${C5_PUERTO:-5433}"
SIN_PISAR=""; [[ "${1:-}" == "--sin-pisar" ]] && SIN_PISAR="--sin-pisar"
# Para probar el script contra un Postgres local sin tocar producción:
#   C5_SIN_TUNEL=1 C5_PUERTO=5544 C5_DB=scora_mig C5_SOLO_HASTA_COPIA=1 ./infra/migrar-produccion.sh
REPO="${GITHUB_REPO:-jaba2001/la-app-de-los-ricos}"
ENV_FILE="$AQUI/.env.gcp"

paso() { printf '\n\033[1m%s\033[0m\n' "$*"; }

for t in cloud-sql-proxy psql pg_isready node gh gcloud; do
  command -v "$t" >/dev/null || { echo "Falta $t en este ordenador." >&2; exit 1; }
done
[[ -f "$ENV_FILE" ]] || { echo "No encuentro $ENV_FILE" >&2; exit 1; }
[[ -d "$APP/node_modules/pg" ]] || { echo "Falta instalar dependencias: cd apps/scora-research && npm ci" >&2; exit 1; }

set -a; source "$ENV_FILE"; set +a
[[ -n "${SUPABASE_SERVICE_KEY:-}" ]] || { echo "Falta SUPABASE_SERVICE_KEY en infra/.env.gcp" >&2; exit 1; }
[[ -n "${PGPASSWORD:-}" ]] || { echo "Falta PGPASSWORD en infra/.env.gcp" >&2; exit 1; }
export PGHOST=127.0.0.1 PGPORT=$PUERTO PGUSER=postgres PGDATABASE="${C5_DB:-scora}"

# ── 1. Túnel ─────────────────────────────────────────────────────────────────────────────
paso "1/5 · Túnel a $INSTANCIA (puerto $PUERTO)"
LOG_PROXY=/dev/null
if [[ -z "${C5_SIN_TUNEL:-}" ]]; then
  if pg_isready -h 127.0.0.1 -p "$PUERTO" -q 2>/dev/null; then
    echo "Ya hay algo escuchando en el puerto $PUERTO. Ciérralo (¿otro cloud-sql-proxy?) y vuelve a lanzar." >&2
    exit 1
  fi
  LOG_PROXY="$(mktemp -t cloud-sql-proxy)"
  cloud-sql-proxy --gcloud-auth --port "$PUERTO" "$INSTANCIA" >"$LOG_PROXY" 2>&1 &
  PROXY=$!
  trap 'kill "$PROXY" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PUERTO" -q 2>/dev/null && break; sleep 1; done
else
  echo "(prueba: sin túnel, contra 127.0.0.1:$PUERTO/$PGDATABASE)"
fi
if ! psql -Atc 'select 1' >/dev/null; then
  echo "No conecta. Log del túnel:" >&2; cat "$LOG_PROXY" >&2; exit 1
fi
echo "✓ conectado como postgres a la base $PGDATABASE"

# ── 2. Esquema ───────────────────────────────────────────────────────────────────────────
if [[ -z "$SIN_PISAR" ]]; then
  paso "2/5 · Migraciones 004–007 (aditivas)"
  for f in 004_smart_money_13f 005_desfases_research 006_rol_jobs 007_rendimiento_real; do
    PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -f "$APP/sql/gcp/$f.sql"
    echo "✓ $f"
  done
fi

# ── 3. Copia ─────────────────────────────────────────────────────────────────────────────
paso "3/5 · Copia de Supabase → Cloud SQL${SIN_PISAR:+ (sin pisar filas existentes)}"
echo "Primero un simulacro: lee y cuenta, no escribe nada."
(cd "$APP" && node --experimental-strip-types --no-warnings scripts/migrar_supabase.mjs --dry-run $SIN_PISAR)
echo
read -r -p "¿Copiar de verdad? Escribe «si» para seguir: " r
if [[ "$r" != "si" ]]; then
  echo "Parado. No se ha copiado nada.${SIN_PISAR:- Las migraciones del paso 2 sí quedan (no cambian datos).}"
  exit 0
fi
(cd "$APP" && node --experimental-strip-types --no-warnings scripts/migrar_supabase.mjs $SIN_PISAR)
if [[ -n "$SIN_PISAR" ]]; then echo; echo "✅ Copia sin pisar hecha."; exit 0; fi
[[ -n "${C5_SOLO_HASTA_COPIA:-}" ]] && { echo "(prueba: se para antes de activar)"; exit 0; }

# ── 4. Activar ───────────────────────────────────────────────────────────────────────────
paso "4/5 · Activar los workflows de GitHub contra Cloud SQL"
C5_DESDE_MIGRAR=1 "$AQUI/github-actions-cloudsql.sh"

# ── 5. Prueba ────────────────────────────────────────────────────────────────────────────
paso "5/5 · Workflow de prueba (scora-weekly-measure)"
DESDE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run scora-weekly-measure.yml -R "$REPO"
# La ejecución tarda unos segundos en aparecer; se busca la creada DESPUÉS de lanzarla, no la
# última de la lista (que podría ser la del lunes).
ID=""
for _ in $(seq 1 20); do
  ID="$(gh run list -R "$REPO" --workflow scora-weekly-measure.yml --limit 5 --json databaseId,createdAt \
        --jq "[.[] | select(.createdAt >= \"$DESDE\")][0].databaseId // empty")"
  [[ -n "$ID" ]] && break; sleep 3
done
[[ -n "$ID" ]] || { echo "No encuentro la ejecución del workflow; míralo en GitHub → Actions." >&2; exit 1; }
if gh run watch "$ID" -R "$REPO" --exit-status; then
  echo "✓ el workflow escribió en Cloud SQL"
else
  echo "✖ el workflow falló — gh run view $ID -R $REPO --log-failed" >&2
  exit 1
fi

cat <<FIN

✅ Mudanza hecha. Queda una cosa que no es de este ordenador:
   pedir a Alejandro que PARE los crons del repo antiguo (siguen escribiendo en Supabase).
   Si pasan días entre esta copia y eso, relanza solo la copia sin pisar lo nuevo:
     ./infra/migrar-produccion.sh --sin-pisar
FIN
