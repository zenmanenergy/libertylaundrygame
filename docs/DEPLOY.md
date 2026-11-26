# Deploying Liberty Laundry

Same setup as Plumbus: nginx in front, the app in /opt/liberty-laundry-game, updates with git pull and deploy.sh. The game lives at https://games.socrates.guru/libertylaundry/ and the Node server listens on port 8091. nginx strips the /libertylaundry part before passing requests on, so other games can share games.socrates.guru at their own paths.

## One-time setup on the server

1. Point a DNS A record for games.socrates.guru at the server (skip this if it already exists).
2. Make sure Node is installed (node -v). Any recent version works, and no npm install is needed.
3. Clone the repo into /opt/liberty-laundry-game and make deploy.sh runnable:

```
cd /opt
git clone <your repo url> liberty-laundry-game
chmod +x /opt/liberty-laundry-game/deploy.sh
```

4. Create /etc/systemd/system/liberty-laundry-game.service:

```
[Unit]
Description=Liberty Laundry game server
After=network.target

[Service]
WorkingDirectory=/opt/liberty-laundry-game
ExecStart=/usr/bin/node Server/server.js
Environment=PORT=8091
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Then run:

```
systemctl daemon-reload
systemctl enable --now liberty-laundry-game
```

5. Set up nginx.

If games.socrates.guru doesn't have a server block yet, create /etc/nginx/sites-available/games with this:

```
server {
	listen 80;
	server_name games.socrates.guru;

	include /etc/nginx/snippets/libertylaundry.conf;
}
```

Then put the Liberty Laundry part in its own file, /etc/nginx/snippets/libertylaundry.conf, so the next game just gets its own snippet:

```
location = /libertylaundry {
	return 301 /libertylaundry/;
}

location /libertylaundry/ {
	proxy_pass http://127.0.0.1:8091/;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
	proxy_read_timeout 3600s;
}
```

The slash at the end of proxy_pass is what strips /libertylaundry, so keep it. If games.socrates.guru already has a server block (including the HTTPS one certbot adds), just add the include line inside it.

Then run:

```
ln -s /etc/nginx/sites-available/games /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d games.socrates.guru
```

Open https://games.socrates.guru/libertylaundry/ on the TV. The QR code points phones at https://games.socrates.guru/libertylaundry/pad.html automatically.

HTTPS matters for the phones: keeping the screen awake only works on a secure page.

## Every update

On your laptop, commit and push as usual. Then on the server:

```
cd /opt/liberty-laundry-game
./deploy.sh
```

## Running it at home on Windows

1. Install Node.js from nodejs.org if you don't have it.
2. Open PowerShell in the liberty-laundry-game folder and run: node Server\server.js
3. Allow it through Windows Firewall when Windows asks (Private networks).
4. Find your PC's address: run ipconfig and look for the IPv4 Address, for example 192.168.1.50.
5. On the TV (or a laptop plugged into it), open http://192.168.1.50:8091 and press F11 for fullscreen. Phones on the same Wi-Fi scan the QR code.

Opening http://localhost:8091 works for testing on the PC itself, but the QR code then points at localhost, which phones can't reach.
