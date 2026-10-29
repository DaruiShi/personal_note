#!/usr/bin/env bash
# Post-upload helper — run ON THE SERVER as root after copying new app files
# into /opt/notes (see deploy/DEPLOY-ALIYUN.md, "Updating the deployed app").
#
#   sudo /opt/notes/deploy/update.sh
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%F-%H%M%S)"

# 1. Back up the data directory (accounts, sessions, notes, uploads).
if [ -d "$APP_DIR/data" ]; then
  cp -a "$APP_DIR/data" "/root/notes-data-backup-$STAMP"
  echo "backup: /root/notes-data-backup-$STAMP"
fi

# 2. Fix ownership for the service user.
chown -R notes:notes "$APP_DIR"

# 3. Restart and health-check.
systemctl restart notes
sleep 1
systemctl is-active --quiet notes && echo "service: active"
curl -fsS http://127.0.0.1:3000/api/session >/dev/null && echo "health check: OK"
