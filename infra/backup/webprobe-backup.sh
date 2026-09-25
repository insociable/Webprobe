#!/usr/bin/env bash
set -euo pipefail

umask 077

APP_ROOT="${WEBPROBE_APP_ROOT:-/srv/agency-saas}"
ENV_FILE="${WEBPROBE_ENV_FILE:-${APP_ROOT}/.env}"
BACKUP_DIR="${WEBPROBE_BACKUP_DIR:-/var/backups/webprobe}"
KEY_DIR="${WEBPROBE_BACKUP_KEY_DIR:-/etc/webprobe-backup}"
RECIPIENT_FILE="${KEY_DIR}/recipient.txt"
POSTGRES_CONTAINER="${WEBPROBE_POSTGRES_CONTAINER:-agency-saas-postgres-1}"
RETENTION_DAYS="${WEBPROBE_BACKUP_RETENTION_DAYS:-14}"
LOCK_FILE="${WEBPROBE_BACKUP_LOCK_FILE:-/run/lock/webprobe-backup.lock}"

for command in age docker sha256sum tar flock; do
  command -v "${command}" >/dev/null || {
    echo "missing required command: ${command}" >&2
    exit 1
  }
done

[[ -r "${ENV_FILE}" ]] || { echo "missing environment file: ${ENV_FILE}" >&2; exit 1; }
[[ -r "${RECIPIENT_FILE}" ]] || { echo "missing age recipient: ${RECIPIENT_FILE}" >&2; exit 1; }

install -d -o root -g root -m 0700 "${BACKUP_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "another backup is already running" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

ARTIFACTS_DIR="${SCAN_ARTIFACTS_DIR:-${APP_ROOT}/storage/scan-artifacts}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${BACKUP_DIR}/webprobe-${timestamp}.tar.age"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

docker exec "${POSTGRES_CONTAINER}" sh -ceu '
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"     --format=custom --no-owner --no-privileges
' > "${tmp_dir}/database.dump"

if [[ -d "${ARTIFACTS_DIR}" ]]; then
  tar -C "${ARTIFACTS_DIR}" -czf "${tmp_dir}/artifacts.tar.gz" .
else
  tar -czf "${tmp_dir}/artifacts.tar.gz" --files-from /dev/null
fi

(
  cd "${tmp_dir}"
  sha256sum database.dump artifacts.tar.gz > manifest.sha256
)

git_sha="unknown"
if [[ -d "${APP_ROOT}/.git" ]]; then
  git_sha="$(git -c safe.directory="${APP_ROOT}" -C "${APP_ROOT}" rev-parse HEAD 2>/dev/null || true)"
fi

cat > "${tmp_dir}/metadata.txt" <<EOF
created_at=${timestamp}
git_sha=${git_sha}
artifacts_dir=${ARTIFACTS_DIR}
postgres_container=${POSTGRES_CONTAINER}
EOF

tar -C "${tmp_dir}" -cf "${tmp_dir}/payload.tar"   database.dump artifacts.tar.gz manifest.sha256 metadata.txt

recipient="$(tr -d '[:space:]' < "${RECIPIENT_FILE}")"
age -r "${recipient}" -o "${output}.tmp" "${tmp_dir}/payload.tar"
mv "${output}.tmp" "${output}"

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'webprobe-*.tar.age'   -mtime "+${RETENTION_DAYS}" -delete

echo "backup_created=${output}"
