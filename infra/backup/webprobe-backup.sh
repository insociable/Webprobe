#!/usr/bin/env bash
set -euo pipefail

umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin

APP_ROOT=/srv/agency-saas
BACKUP_DIR=/var/backups/webprobe
KEY_DIR=/etc/webprobe-backup
RECIPIENT_FILE="${KEY_DIR}/recipient.txt"
POSTGRES_CONTAINER="${WEBPROBE_POSTGRES_CONTAINER:?root-owned backup.env required}"
RETENTION_DAYS="${WEBPROBE_BACKUP_RETENTION_DAYS:?root-owned backup.env required}"
ARTIFACTS_DIR="${WEBPROBE_ARTIFACTS_DIR:?root-owned backup.env required}"
LOCK_FILE=/run/lock/webprobe-backup.lock

for command in age docker sha256sum tar flock; do
  command -v "${command}" >/dev/null || {
    echo "missing required command: ${command}" >&2
    exit 1
  }
done

[[ -r "${RECIPIENT_FILE}" ]] || { echo "missing age recipient: ${RECIPIENT_FILE}" >&2; exit 1; }
[[ "${RETENTION_DAYS}" =~ ^[0-9]{1,3}$ && "${RETENTION_DAYS}" -ge 1 && "${RETENTION_DAYS}" -le 365 ]] || exit 1
[[ "${POSTGRES_CONTAINER}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 1
[[ "${ARTIFACTS_DIR}" == /* && -d "${ARTIFACTS_DIR}" ]] || exit 1

install -d -o root -g root -m 0700 "${BACKUP_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "another backup is already running" >&2; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${BACKUP_DIR}/webprobe-${timestamp}.tar.age"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

docker exec "${POSTGRES_CONTAINER}" sh -ceu '
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"     --format=custom --no-owner --no-privileges
' > "${tmp_dir}/database.dump"

# The artifact tree is maintained by vboxuser. Read it with that account,
# even when the configured directory contains links to other locations.
runuser -u vboxuser -- tar -C "${ARTIFACTS_DIR}" -czf - . > "${tmp_dir}/artifacts.tar.gz"

(
  cd "${tmp_dir}"
  sha256sum database.dump artifacts.tar.gz > manifest.sha256
)

git_sha="$(runuser -u vboxuser -- git -C "${APP_ROOT}" rev-parse HEAD 2>/dev/null || printf unknown)"

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
