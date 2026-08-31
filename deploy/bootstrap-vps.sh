#!/usr/bin/env bash
# One-time VPS bootstrap + deploy. Run from repo root as root:
#   sudo bash deploy/bootstrap-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing Nginx site (miogen.iranexpedia.ir) if missing..."
if [ ! -f /etc/nginx/sites-available/miogen ]; then
  cp deploy/nginx-miogen.example.conf /etc/nginx/sites-available/miogen
  ln -sf /etc/nginx/sites-available/miogen /etc/nginx/sites-enabled/miogen
  nginx -t
  systemctl reload nginx
  echo "    Nginx site installed."
else
  echo "    Nginx site already exists — skipping."
fi

echo "==> Starting Docker stack..."
docker compose up -d --build

echo "==> Done. Check:"
echo "    curl -s https://miogen.iranexpedia.ir/api/health"
echo "    curl -s https://miogen.iranexpedia.ir/api/auth/demo/status"
