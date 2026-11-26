#!/bin/bash
# Liberty Laundry deploy. Run on the server:  ./deploy.sh
# Works from wherever the repo is cloned (normally /opt/games/libertylaundry).
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=libertylaundry
PORT=8091

cd "$APP_DIR"

echo "== Pulling latest code"
git pull

echo "== Checking server code"
node --check Server/server.js
for f in Client/js/*.js; do node --check "$f"; done

echo "== Restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 1

echo "== Health check"
if curl -fsS "http://127.0.0.1:$PORT/health"; then
	echo
	echo "Deployed. Hard refresh the TV page (Ctrl+F5)."
else
	echo "Health check failed. Logs: journalctl -u $SERVICE -n 50"
	exit 1
fi
