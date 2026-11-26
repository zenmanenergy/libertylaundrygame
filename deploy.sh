#!/bin/bash
# Liberty Laundry deploy. Run on the server from /opt/games/libertylaundry:  ./deploy.sh
set -e

APP_DIR=/opt/games/libertylaundry
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
