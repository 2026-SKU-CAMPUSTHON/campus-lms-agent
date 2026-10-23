#!/usr/bin/env bash
# Upload the committed application and a private production environment over SSH.
set -euo pipefail
if [[ $# -ne 3 ]]; then echo 'Usage: scripts/deploy-oracle.sh user@host /absolute/ssh-key /absolute/.env.production' >&2; exit 1; fi
target=$1
key=$2
environment=$3
if [[ ! $target =~ ^[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+$ || $key != /* || $environment != /* ]]; then echo 'Use user@host and absolute local file paths.' >&2; exit 1; fi
cd "$(dirname "$0")/.."
[[ -f $key && -f $environment ]]
if [[ -n $(git status --porcelain) ]]; then echo 'Commit the reviewed changes before deployment.' >&2; exit 1; fi
commit=$(git rev-parse HEAD)
connection=(-i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
ssh "${connection[@]}" "$target" "umask 077; mkdir -p campus-lms/releases/$commit"
git archive HEAD | ssh "${connection[@]}" "$target" "tar -xf - -C campus-lms/releases/$commit"
scp "${connection[@]}" "$environment" "$target:campus-lms/releases/$commit/.env.production"
ssh "${connection[@]}" "$target" "cd campus-lms/releases/$commit && chmod 600 .env.production && sudo -n bash deploy/install-docker-ubuntu.sh && sudo -n docker compose --env-file .env.production up -d --build --wait --wait-timeout 180 && ln -sfn releases/$commit ../../current"
echo "Deployment started from commit $commit. Verify the HTTPS URL and live login before reporting completion."
