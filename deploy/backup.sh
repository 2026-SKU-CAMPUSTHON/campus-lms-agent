#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
target=${1:-"$HOME/campus-backups/$(date -u +%Y%m%dT%H%M%SZ)"}
mkdir -p "$target"
compose=(sudo -n docker compose --env-file .env.production)
"${compose[@]}" stop app
trap '"${compose[@]}" start app >/dev/null' EXIT
"${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' | gzip > "$target/database.sql.gz"
"${compose[@]}" run --rm --no-deps --entrypoint tar app --exclude=./models -C /data -czf - . > "$target/materials.tar.gz"
(git rev-parse HEAD 2>/dev/null || basename "$PWD") > "$target/commit.txt"
echo "Backup saved: $target"
