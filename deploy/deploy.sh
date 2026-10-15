#!/usr/bin/env bash
# Deploys / updates PatientPulse on the dev server (callingapp-dev.zensark.com).
#
#   Backend  -> Docker container "patientpulse-api" on 127.0.0.1:8010
#   Frontend -> static files in /usr/share/nginx/html/patientpulse
#   Database -> /home/ec2-user/patientpulse-data/patient_engagement.db (kept between deploys)
#
# Usage (from the repo folder on the server):  bash deploy/deploy.sh
# Swaasa (ports 3001 / 8000) is not touched.

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR=/usr/share/nginx/html/patientpulse
DATA_DIR="$HOME/patientpulse-data"
NGINX_SNIPPET=/etc/nginx/patientpulse.locations
NGINX_SITE=/etc/nginx/conf.d/calling-agent.conf
PORT=8010
IMAGE=patientpulse-api
CONTAINER=patientpulse-api

cd "$APP_DIR"
echo "==> Deploying from $APP_DIR (branch: $(git rev-parse --abbrev-ref HEAD))"

if [ ! -f backend/.env ]; then
  echo "ERROR: backend/.env not found. Create it first (see SETUP_GUIDE.txt Part H)." >&2
  exit 1
fi

echo "==> [1/5] Getting latest code"
git pull --ff-only

echo "==> [2/5] Building and starting the backend container"
sudo docker build -t "$IMAGE" ./backend
mkdir -p "$DATA_DIR"
sudo docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
sudo docker run -d --name "$CONTAINER" --restart always \
  -p "127.0.0.1:$PORT:10000" \
  --env-file backend/.env \
  -e ROOT_PATH=/patientpulse-api \
  -e DATABASE_URL=sqlite+aiosqlite:////data/patient_engagement.db \
  -v "$DATA_DIR:/data" \
  "$IMAGE"

echo "    waiting for the backend to start..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "ERROR: backend did not start. Logs:"; sudo docker logs --tail 50 "$CONTAINER"; exit 1; }

# Demo login + patients (skips itself if the database is already seeded)
sudo docker exec "$CONTAINER" python seed.py || true

echo "==> [3/5] Building the frontend"
cd frontend
npm ci
npm run build
cd ..

echo "==> [4/5] Publishing the frontend"
sudo rm -rf "$WEB_DIR"
sudo mkdir -p "$WEB_DIR"
sudo cp -r frontend/dist/. "$WEB_DIR/"

echo "==> [5/5] Updating nginx routes"
sudo cp deploy/patientpulse-nginx.conf "$NGINX_SNIPPET"
if ! sudo grep -q "include $NGINX_SNIPPET;" "$NGINX_SITE"; then
  echo "WARNING: $NGINX_SITE does not include $NGINX_SNIPPET yet."
  echo "         Do the one-time nginx step in SETUP_GUIDE.txt Part H, then re-run this script."
  exit 1
fi
sudo nginx -t
sudo systemctl reload nginx

echo
echo "DONE. Open https://callingapp-dev.zensark.com/patientpulse/"
echo "Backend health: https://callingapp-dev.zensark.com/patientpulse-api/health"
