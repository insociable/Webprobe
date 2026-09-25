#!/usr/bin/env bash
set -euo pipefail

umask 077

BACKUP_DIR="${WEBPROBE_BACKUP_DIR:-/var/backups/webprobe}"
KEY_DIR="${WEBPROBE_BACKUP_KEY_DIR:-/etc/webprobe-backup}"
IDENTITY_FILE="${KEY_DIR}/identity.txt"
POSTGRES_CONTAINER="${WEBPROBE_POSTGRES_CONTAINER:-agency-saas-postgres-1}"

for command in age docker sha256sum tar; do
  command -v "${command}" >/dev/null || {
    echo "missing required command: ${command}" >&2
    exit 1
  }
done

[[ -r "${IDENTITY_FILE}" ]] || {
  echo "missing age identity: ${IDENTITY_FILE}" >&2
  exit 1
}

backup="${1:-}"
if [[ -z "${backup}" ]]; then
  backup="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'webprobe-*.tar.age'     -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
fi
[[ -n "${backup}" && -r "${backup}" ]] || {
  echo "no readable backup found" >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
restore_db="webprobe_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
created_db=0

cleanup() {
  if [[ "${created_db}" == "1" ]]; then
    docker exec "${POSTGRES_CONTAINER}" sh -ceu '
      dropdb -U "$POSTGRES_USER" --if-exists "$1"
    ' sh "${restore_db}" >/dev/null 2>&1 || true
  fi
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

age -d -i "${IDENTITY_FILE}" -o "${tmp_dir}/payload.tar" "${backup}"
tar -C "${tmp_dir}" -xf "${tmp_dir}/payload.tar"

(
  cd "${tmp_dir}"
  sha256sum -c manifest.sha256
)

docker exec "${POSTGRES_CONTAINER}" sh -ceu '
  createdb -U "$POSTGRES_USER" "$1"
' sh "${restore_db}"
created_db=1

docker exec -i "${POSTGRES_CONTAINER}" sh -ceu '
  pg_restore -U "$POSTGRES_USER" -d "$1"     --exit-on-error --no-owner --no-privileges
' sh "${restore_db}" < "${tmp_dir}/database.dump"

table_count="$(docker exec "${POSTGRES_CONTAINER}" sh -ceu '
  psql -U "$POSTGRES_USER" -d "$1" -Atqc     "select count(*) from pg_tables where schemaname = current_schema();"
' sh "${restore_db}")"

if [[ ! "${table_count}" =~ ^[0-9]+$ || "${table_count}" -lt 1 ]]; then
  echo "restore check failed: no public tables restored" >&2
  exit 1
fi

mkdir "${tmp_dir}/artifacts"
tar -C "${tmp_dir}/artifacts" -xzf "${tmp_dir}/artifacts.tar.gz"
artifact_count="$(find "${tmp_dir}/artifacts" -type f | wc -l)"

echo "restore_check=ok backup=${backup} tables=${table_count} artifacts=${artifact_count}"
