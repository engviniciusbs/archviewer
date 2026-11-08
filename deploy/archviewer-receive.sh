#!/bin/bash
# Forced command for the `archviewer` user's GitHub Actions key (see authorized_keys).
# Receives a tar of apps/web/dist on stdin, unpacks it into a new release dir,
# swaps the `current` symlink atomically and keeps the last 5 releases.
# The only argument accepted (via SSH_ORIGINAL_COMMAND) is the commit SHA.
set -euo pipefail

BASE=/var/www/archviewer
SHA="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "uso: ssh archviewer@host <commit-sha>  (recebe o tar do dist/ pela entrada padrão)" >&2
  exit 2
fi

REL="$BASE/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"
mkdir -p "$REL"
tar -xf - -C "$REL" --no-same-owner --no-same-permissions
chmod -R u=rwX,go=rX "$REL"

if [[ ! -f "$REL/index.html" ]]; then
  echo "release sem index.html; abortando" >&2
  rm -rf "$REL"
  exit 3
fi

ln -sfn "$REL" "$BASE/current.tmp"
mv -T "$BASE/current.tmp" "$BASE/current"

ls -1dt "$BASE"/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "publicado: $REL"
