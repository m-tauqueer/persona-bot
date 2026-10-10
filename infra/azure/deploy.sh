#!/usr/bin/env bash
set -euo pipefail

export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=yes_without_prompt

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AZURE_DIR="$ROOT/infra/azure"
RENDER=(python3 "$AZURE_DIR/render.py")
STATE_FILE="$AZURE_DIR/.state"
TMP_DIR="$AZURE_DIR/.tmp"
REPO_ENV="$ROOT/.env"
AZURE_ENV="$AZURE_DIR/env"

usage() {
  cat <<'EOF'
Usage: infra/azure/deploy.sh check|up|bind

  check  Confirm Azure login, the resource group, and write access.
  up     Use the configured group, build images, deploy the current tree.
  bind   Attach the public hostname after the GoDaddy CNAME exists.

Copy infra/azure/env.example to infra/azure/env to change names or the origin.
App secrets come from the repo-root .env. Nothing from that file is printed.
EOF
}

load_defaults() {
  AZURE_LOCATION="${AZURE_LOCATION:-centralus}"
  AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-cognora-alpha-rg}"
  PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://bot.metacog.in}"
  AZURE_CONTAINER_ENV="${AZURE_CONTAINER_ENV:-cae-bot-metacog}"
  AZURE_APP_WEB="${AZURE_APP_WEB:-bot-web}"
  AZURE_APP_GATEWAY="${AZURE_APP_GATEWAY:-bot-gateway}"
  AZURE_APP_WORKER="${AZURE_APP_WORKER:-bot-worker}"
  AZURE_LOG_WORKSPACE="${AZURE_LOG_WORKSPACE:-law-bot-metacog}"
  AZURE_POSTGRES_ADMIN="${AZURE_POSTGRES_ADMIN:-voicebot}"
  AZURE_POSTGRES_DB="${AZURE_POSTGRES_DB:-voicebot}"
  AZURE_POSTGRES_EXTENSIONS="${AZURE_POSTGRES_EXTENSIONS:-pgcrypto}"
  AZURE_REDIS_SKU="${AZURE_REDIS_SKU:-Balanced_B0}"
  AZURE_REDIS_PORT="${AZURE_REDIS_PORT:-10000}"
  AZURE_REDIS_PUBLIC_ACCESS="${AZURE_REDIS_PUBLIC_ACCESS:-Enabled}"
}

source_optional() {
  local path="$1"
  if [[ -f "$path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$path"
    set +a
  fi
}

state_get() {
  local key="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  python3 - "$STATE_FILE" "$key" <<'PY'
from pathlib import Path
import sys
path, key = sys.argv[1], sys.argv[2]
for raw in Path(path).read_text(encoding="utf-8").splitlines():
    if raw.startswith(key + "="):
        print(raw.split("=", 1)[1], end="")
        break
PY
}

state_set() {
  local key="$1"
  local value="$2"
  python3 - "$STATE_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys
path, key, value = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
rows = []
if path.exists():
    rows = path.read_text(encoding="utf-8").splitlines()
out = []
found = False
for raw in rows:
    if raw.startswith(key + "="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(raw)
if not found:
    out.append(f"{key}={value}")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text("\n".join(out) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
}

random_token() {
  python3 - <<'PY'
import secrets
print(secrets.token_hex(4))
PY
}

quote_url() {
  python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

public_host() {
  python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).hostname or "")' "$PUBLIC_ORIGIN"
}

require_tools() {
  command -v az >/dev/null || { echo "az is not installed" >&2; exit 1; }
  command -v python3 >/dev/null || { echo "python3 is not installed" >&2; exit 1; }
}

account_json() {
  az account show -o json
}

signed_in_id() {
  az ad signed-in-user show --query id -o tsv
}

fail_closed_write() {
  echo "This login cannot create or write ${AZURE_RESOURCE_GROUP}." >&2
  echo "Have the subscription owner run:" >&2
  echo "  az group create --name ${AZURE_RESOURCE_GROUP} --location ${AZURE_LOCATION}" >&2
  echo "  az role assignment create --assignee $(signed_in_id) --role Contributor --scope /subscriptions/$(az account show --query id -o tsv)/resourceGroups/${AZURE_RESOURCE_GROUP}" >&2
  exit 1
}

ensure_group() {
  if az group show --name "$AZURE_RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "resource group ${AZURE_RESOURCE_GROUP} exists"
    return 0
  fi
  echo "creating resource group ${AZURE_RESOURCE_GROUP} in ${AZURE_LOCATION}"
  if ! az group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" >/dev/null; then
    fail_closed_write
  fi
}

can_write_group() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<'JSON'
{"$schema":"https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#","contentVersion":"10.0.0.1","resources":[]}
JSON
  if az deployment group create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name deploy-write-check \
      --mode Incremental \
      --template-file "$tmp" >/dev/null; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

cmd_check() {
  require_tools
  if [[ ! -f "$REPO_ENV" ]]; then
    echo "repo-root .env is missing" >&2
    exit 1
  fi
  "${RENDER[@]}" require --source "$REPO_ENV"
  account_json >/dev/null
  echo "subscription $(az account show --query name -o tsv)"
  echo "origin ${PUBLIC_ORIGIN}"
  echo "group ${AZURE_RESOURCE_GROUP}"
  if ! az group show --name "$AZURE_RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "resource group is not there yet; up will create it"
    return 0
  fi
  if can_write_group; then
    echo "write access ok"
  else
    fail_closed_write
  fi
}

ensure_names() {
  if [[ -z "${AZURE_ACR_NAME:-}" ]]; then
    AZURE_ACR_NAME="$(state_get AZURE_ACR_NAME)"
  fi
  if [[ -z "${AZURE_ACR_NAME:-}" ]]; then
    AZURE_ACR_NAME="acrbot$(random_token)"
  fi
  if [[ -z "${AZURE_POSTGRES_NAME:-}" ]]; then
    AZURE_POSTGRES_NAME="$(state_get AZURE_POSTGRES_NAME)"
  fi
  if [[ -z "${AZURE_POSTGRES_NAME:-}" ]]; then
    AZURE_POSTGRES_NAME="psql-bot-$(random_token)"
  fi
  if [[ -z "${AZURE_REDIS_NAME:-}" ]]; then
    AZURE_REDIS_NAME="$(state_get AZURE_REDIS_NAME)"
  fi
  if [[ -z "${AZURE_REDIS_NAME:-}" ]]; then
    AZURE_REDIS_NAME="redis-bot-$(random_token)"
  fi
  state_set AZURE_ACR_NAME "$AZURE_ACR_NAME"
  state_set AZURE_POSTGRES_NAME "$AZURE_POSTGRES_NAME"
  state_set AZURE_REDIS_NAME "$AZURE_REDIS_NAME"
}

ensure_postgres() {
  local password host
  password="$(state_get POSTGRES_PASSWORD)"
  if [[ -z "$password" ]]; then
    password="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
    state_set POSTGRES_PASSWORD "$password"
  fi
  if ! az postgres flexible-server show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_POSTGRES_NAME" >/dev/null 2>&1; then
    echo "creating postgres ${AZURE_POSTGRES_NAME}"
    az postgres flexible-server create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_POSTGRES_NAME" \
      --location "$AZURE_LOCATION" \
      --admin-user "$AZURE_POSTGRES_ADMIN" \
      --admin-password "$password" \
      --sku-name Standard_B1ms \
      --tier Burstable \
      --storage-size 32 \
      --version 16 \
      --public-access 0.0.0.0 \
      --yes >/dev/null
  else
    echo "postgres ${AZURE_POSTGRES_NAME} exists"
  fi
  az postgres flexible-server parameter set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --server-name "$AZURE_POSTGRES_NAME" \
    --name azure.extensions \
    --value "$AZURE_POSTGRES_EXTENSIONS" >/dev/null
  if ! az postgres flexible-server db show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --server-name "$AZURE_POSTGRES_NAME" \
      --name "$AZURE_POSTGRES_DB" >/dev/null 2>&1; then
    echo "creating database ${AZURE_POSTGRES_DB}"
    az postgres flexible-server db create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --server-name "$AZURE_POSTGRES_NAME" \
      --name "$AZURE_POSTGRES_DB" >/dev/null
  fi
  host="$(az postgres flexible-server show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_POSTGRES_NAME" \
    --query fullyQualifiedDomainName -o tsv)"
  DATABASE_URL="postgresql://${AZURE_POSTGRES_ADMIN}:$(quote_url "$password")@${host}:5432/${AZURE_POSTGRES_DB}?sslmode=require"
}

ensure_redis() {
  local key host
  if ! az redisenterprise show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_REDIS_NAME" >/dev/null 2>&1; then
    echo "creating redis ${AZURE_REDIS_NAME}"
    az redisenterprise create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_REDIS_NAME" \
      --location "$AZURE_LOCATION" \
      --sku "$AZURE_REDIS_SKU" \
      --access-keys-authentication Enabled \
      --public-network-access "$AZURE_REDIS_PUBLIC_ACCESS" \
      --minimum-tls-version 1.2 \
      --client-protocol Encrypted \
      --clustering-policy EnterpriseCluster \
      --port "$AZURE_REDIS_PORT" >/dev/null
  else
    echo "redis ${AZURE_REDIS_NAME} exists"
  fi
  host="$(az redisenterprise show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_REDIS_NAME" \
    --query hostName -o tsv)"
  if [[ -z "$host" ]]; then
    host="$(az redisenterprise show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_REDIS_NAME" \
      --query properties.hostName -o tsv)"
  fi
  key="$(az redisenterprise database list-keys \
    --cluster-name "$AZURE_REDIS_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query primaryKey -o tsv)"
  REDIS_URL="rediss://:$(quote_url "$key")@${host}:${AZURE_REDIS_PORT}/0"
}

ensure_logs_and_env() {
  local workspace_id
  if ! az monitor log-analytics workspace show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --workspace-name "$AZURE_LOG_WORKSPACE" >/dev/null 2>&1; then
    echo "creating log workspace ${AZURE_LOG_WORKSPACE}"
    az monitor log-analytics workspace create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --workspace-name "$AZURE_LOG_WORKSPACE" \
      --location "$AZURE_LOCATION" >/dev/null
  fi
  workspace_id="$(az monitor log-analytics workspace show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --workspace-name "$AZURE_LOG_WORKSPACE" \
    --query customerId -o tsv)"
  if ! az containerapp env show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_CONTAINER_ENV" >/dev/null 2>&1; then
    echo "creating container apps env ${AZURE_CONTAINER_ENV}"
    az containerapp env create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_CONTAINER_ENV" \
      --location "$AZURE_LOCATION" \
      --logs-workspace-id "$workspace_id" >/dev/null
  else
    echo "container apps env ${AZURE_CONTAINER_ENV} exists"
  fi
  ENVIRONMENT_ID="$(az containerapp env show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_CONTAINER_ENV" \
    --query id -o tsv)"
}

ensure_acr() {
  if ! az acr show --name "$AZURE_ACR_NAME" >/dev/null 2>&1; then
    echo "creating registry ${AZURE_ACR_NAME}"
    az acr create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_ACR_NAME" \
      --sku Basic \
      --admin-enabled true \
      --location "$AZURE_LOCATION" >/dev/null
  else
    echo "registry ${AZURE_ACR_NAME} exists"
  fi
  ACR_SERVER="$(az acr show --name "$AZURE_ACR_NAME" --query loginServer -o tsv)"
  ACR_USERNAME="$(az acr credential show --name "$AZURE_ACR_NAME" --query username -o tsv)"
  ACR_PASSWORD="$(az acr credential show --name "$AZURE_ACR_NAME" --query passwords[0].value -o tsv)"
}

build_images() {
  local tag="$1"
  mkdir -p "$TMP_DIR"
  echo "building images as ${tag}"
  az acr build \
    --registry "$AZURE_ACR_NAME" \
    --image "web:${tag}" \
    --file "$AZURE_DIR/Dockerfile.web" \
    "$ROOT"
  az acr build \
    --registry "$AZURE_ACR_NAME" \
    --image "gateway:${tag}" \
    --file "$AZURE_DIR/Dockerfile.gateway" \
    "$ROOT"
  az acr build \
    --registry "$AZURE_ACR_NAME" \
    --image "worker:${tag}" \
    --file "$AZURE_DIR/Dockerfile.worker" \
    "$ROOT"
}

apply_app() {
  local yaml="$1"
  local name="$2"
  if az containerapp show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$name" >/dev/null 2>&1; then
    if [[ "${FORCE_RECREATE:-}" == "1" ]]; then
      az containerapp delete --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --yes >/dev/null
      local waited=0
      while az containerapp show --resource-group "$AZURE_RESOURCE_GROUP" --name "$name" >/dev/null 2>&1; do
        if (( waited >= 180 )); then
          echo "timed out waiting for ${name} to delete" >&2
          exit 1
        fi
        sleep 5
        waited=$((waited + 5))
      done
      az containerapp create --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --yaml "$yaml" >/dev/null
    else
      az containerapp update --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --yaml "$yaml" >/dev/null
    fi
  else
    az containerapp create --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --yaml "$yaml" >/dev/null
  fi
}

cmd_up() {
  require_tools
  if [[ ! -f "$REPO_ENV" ]]; then
    echo "repo-root .env is missing" >&2
    exit 1
  fi
  "${RENDER[@]}" require --source "$REPO_ENV"
  account_json >/dev/null
  ensure_group
  if ! can_write_group; then
    fail_closed_write
  fi
  ensure_names
  ensure_postgres
  ensure_redis
  ensure_logs_and_env
  ensure_acr
  mkdir -p "$TMP_DIR"
  chmod 700 "$TMP_DIR"
  local worker_url_port
  worker_url_port="$(python3 -c 'from pathlib import Path; import sys; sys.path.insert(0, sys.argv[1]); from render import parse_dotenv; print(parse_dotenv(Path(sys.argv[2]).read_text()).get("WORKER_PORT","8000"))' "$AZURE_DIR" "$REPO_ENV")"
  "${RENDER[@]}" merge \
    --source "$REPO_ENV" \
    --public-origin "$PUBLIC_ORIGIN" \
    --worker-url "http://127.0.0.1:${worker_url_port}" \
    --database-url "$DATABASE_URL" \
    --redis-url "$REDIS_URL" \
    --app-env "$TMP_DIR/app.env" \
    --build-env "$AZURE_DIR/.build.env" \
    --meta "$TMP_DIR/meta.json"
  local tag think voice_ws body gateway_port worker_port
  tag="$(python3 -c 'import time; print(time.strftime("%Y%m%d%H%M%S"))')"
  if [[ "${SKIP_BUILD:-}" == "1" ]]; then
    tag="$(az containerapp show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_APP_WEB" \
      --query properties.template.containers[0].image -o tsv | python3 -c 'import sys; print(sys.stdin.read().rsplit(":",1)[-1].strip())')"
    echo "reusing image tag ${tag}"
  else
    build_images "$tag"
  fi
  think="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["think_path"])' "$TMP_DIR/meta.json")"
  voice_ws="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["voice_ws_path"])' "$TMP_DIR/meta.json")"
  body="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["nginx_client_max_body"])' "$TMP_DIR/meta.json")"
  gateway_port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["gateway_port"])' "$TMP_DIR/meta.json")"
  worker_port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["worker_port"])' "$TMP_DIR/meta.json")"
  echo "applying container app"
  "${RENDER[@]}" sidecar-yaml \
    --out "$TMP_DIR/web.yaml" \
    --name "$AZURE_APP_WEB" \
    --location "$AZURE_LOCATION" \
    --environment-id "$ENVIRONMENT_ID" \
    --web-image "${ACR_SERVER}/web:${tag}" \
    --gateway-image "${ACR_SERVER}/gateway:${tag}" \
    --worker-image "${ACR_SERVER}/worker:${tag}" \
    --acr-server "$ACR_SERVER" \
    --acr-username "$ACR_USERNAME" \
    --acr-password "$ACR_PASSWORD" \
    --app-env "$TMP_DIR/app.env" \
    --extra-env "$(python3 -c 'import json,sys; print(json.dumps({"GATEWAY_PORT":sys.argv[1],"WORKER_PORT":sys.argv[2],"THINK_PATH":sys.argv[3],"VOICE_WS_PATH":sys.argv[4],"NGINX_CLIENT_MAX_BODY":sys.argv[5]}))' "$gateway_port" "$worker_port" "$think" "$voice_ws" "$body")" \
    --gateway-port "$gateway_port" \
    --worker-port "$worker_port"
  apply_app "$TMP_DIR/web.yaml" "$AZURE_APP_WEB"
  if az containerapp show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_APP_GATEWAY" >/dev/null 2>&1; then
    az containerapp delete --name "$AZURE_APP_GATEWAY" --resource-group "$AZURE_RESOURCE_GROUP" --yes >/dev/null || true
  fi
  if az containerapp show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_APP_WORKER" >/dev/null 2>&1; then
    az containerapp delete --name "$AZURE_APP_WORKER" --resource-group "$AZURE_RESOURCE_GROUP" --yes >/dev/null || true
  fi
  rm -f "$TMP_DIR/app.env" "$TMP_DIR/web.yaml"
  local fqdn host
  fqdn="$(az containerapp show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_APP_WEB" \
    --query properties.configuration.ingress.fqdn -o tsv)"
  host="$(public_host)"
  echo
  echo "edge is up at https://${fqdn}"
  echo "sign-in stays on ${PUBLIC_ORIGIN} until DNS and Google are updated."
  echo
  echo "GoDaddy CNAME"
  echo "  name: ${host%%.*}"
  echo "  value: ${fqdn}"
  echo
  echo "Google OAuth (same client)"
  echo "  origin: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["frontend_origin"])' "$TMP_DIR/meta.json")"
  echo "  callback: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["google_callback_url"])' "$TMP_DIR/meta.json")"
  echo
  echo "After the CNAME answers, run: infra/azure/deploy.sh bind"
}

cmd_bind() {
  require_tools
  local host fqdn
  host="$(public_host)"
  if [[ -z "$host" ]]; then
    echo "PUBLIC_ORIGIN is missing a hostname" >&2
    exit 1
  fi
  if ! az containerapp show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_APP_WEB" >/dev/null 2>&1; then
    echo "web app is not deployed yet; run up first" >&2
    exit 1
  fi
  fqdn="$(az containerapp show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_APP_WEB" \
    --query properties.configuration.ingress.fqdn -o tsv)"
  echo "binding ${host} on ${AZURE_APP_WEB} (CNAME should already point at ${fqdn})"
  az containerapp hostname add \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_APP_WEB" \
    --hostname "$host" >/dev/null
  az containerapp hostname bind \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_APP_WEB" \
    --hostname "$host" \
    --environment "$AZURE_CONTAINER_ENV" \
    --validation-method CNAME >/dev/null
  echo "certificate bind requested for https://${host}"
}

load_defaults
source_optional "$AZURE_ENV"
load_defaults

cmd="${1:-}"
case "$cmd" in
  check) cmd_check ;;
  up) cmd_up ;;
  bind) cmd_bind ;;
  -h|--help|help|"") usage ;;
  *) usage >&2; exit 1 ;;
esac
