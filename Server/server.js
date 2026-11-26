// Liberty Laundry server: serves the Client folder and relays WebSocket messages
// between the TV (host) and the phones (pads). No npm packages needed.
//
//   node server.js            (port 8091, or PORT from the environment)
//
// TV:    ws /ws?role=host[&room=ABCD]   -> gets {t:'room', code}
// Phone: ws /ws?role=pad&room=ABCD&id=X -> host gets {t:'join', id}
// Phone -> host: anything the pad sends arrives as {t:'in', id, m}
// Host -> phone: host sends {t:'to', id, m}, the pad receives m

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8091', 10);
const CLIENT_DIR = path.resolve(__dirname, '..', 'Client');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json'
};

// ---------- static files ----------

const server = http.createServer(function (req, res) {
	let urlPath = decodeURIComponent(req.url.split('?')[0]);
	if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
	if (urlPath === '/health') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('ok ' + rooms.size + ' rooms');
		return;
	}
	const filePath = path.resolve(CLIENT_DIR, '.' + urlPath);
	if (!filePath.startsWith(CLIENT_DIR + path.sep)) {
		res.writeHead(403);
		res.end('forbidden');
		return;
	}
	fs.readFile(filePath, function (err, data) {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('not found');
			return;
		}
		res.writeHead(200, {
			'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
			'Cache-Control': 'no-cache'
		});
		res.end(data);
	});
});

// ---------- tiny WebSocket implementation ----------

function wsAccept(req, socket) {
	const key = req.headers['sec-websocket-key'];
	if (!key) {
		socket.destroy();
		return null;
	}
	const accept = crypto.createHash('sha1')
		.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
		.digest('base64');
	socket.write(
		'HTTP/1.1 101 Switching Protocols\r\n' +
		'Upgrade: websocket\r\n' +
		'Connection: Upgrade\r\n' +
		'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
	);
	socket.setNoDelay(true);
	const conn = {
		socket: socket,
		buf: Buffer.alloc(0),
		frag: null,
		open: true,
		onmessage: null,
		onclose: null,
		lastSeen: Date.now()
	};
	socket.on('data', function (chunk) {
		conn.lastSeen = Date.now();
		conn.buf = Buffer.concat([conn.buf, chunk]);
		wsParse(conn);
	});
	socket.on('close', function () { wsClosed(conn); });
	socket.on('error', function () { wsClosed(conn); });
	return conn;
}

function wsClosed(conn) {
	if (!conn.open) return;
	conn.open = false;
	if (conn.onclose) conn.onclose();
}

function wsParse(conn) {
	while (conn.buf.length >= 2) {
		const b0 = conn.buf[0];
		const b1 = conn.buf[1];
		const fin = (b0 & 0x80) !== 0;
		const op = b0 & 0x0f;
		const masked = (b1 & 0x80) !== 0;
		let len = b1 & 0x7f;
		let off = 2;
		if (len === 126) {
			if (conn.buf.length < 4) return;
			len = conn.buf.readUInt16BE(2);
			off = 4;
		} else if (len === 127) {
			if (conn.buf.length < 10) return;
			len = Number(conn.buf.readBigUInt64BE(2));
			off = 10;
		}
		if (len > 1 << 20) {
			conn.socket.destroy();
			return;
		}
		const maskLen = masked ? 4 : 0;
		if (conn.buf.length < off + maskLen + len) return;
		let payload = conn.buf.slice(off + maskLen, off + maskLen + len);
		if (masked) {
			const mask = conn.buf.slice(off, off + 4);
			payload = Buffer.from(payload);
			for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
		}
		conn.buf = conn.buf.slice(off + maskLen + len);

		if (op === 0x8) {
			wsSendRaw(conn, 0x8, Buffer.alloc(0));
			conn.socket.end();
			wsClosed(conn);
			return;
		} else if (op === 0x9) {
			wsSendRaw(conn, 0xA, payload);
		} else if (op === 0xA) {
			// pong
		} else if (op === 0x1 || op === 0x2 || op === 0x0) {
			if (op !== 0x0) conn.frag = [];
			if (!conn.frag) conn.frag = [];
			conn.frag.push(payload);
			if (fin) {
				const text = Buffer.concat(conn.frag).toString('utf8');
				conn.frag = null;
				if (conn.onmessage) conn.onmessage(text);
			}
		}
	}
}

function wsSendRaw(conn, op, payload) {
	if (!conn.open) return;
	const len = payload.length;
	let header;
	if (len < 126) {
		header = Buffer.from([0x80 | op, len]);
	} else if (len < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | op;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | op;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	try {
		conn.socket.write(Buffer.concat([header, payload]));
	} catch (e) {
		wsClosed(conn);
	}
}

function wsSend(conn, obj) {
	wsSendRaw(conn, 0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
}

// ---------- rooms ----------

// code -> { host: conn|null, pads: Map(id -> conn), hostGoneAt: ms }
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
	for (;;) {
		let c = '';
		for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
		if (!rooms.has(c)) return c;
	}
}

function attachHost(conn, wanted) {
	let code = (wanted || '').toUpperCase();
	let room = rooms.get(code);
	if (!room || (room.host && room.host.open)) {
		// a room the TV asked for but that is gone or taken gets a fresh code
		if (!/^[A-Z]{4}$/.test(code) || rooms.has(code)) code = newCode();
		room = { host: null, pads: new Map(), hostGoneAt: 0 };
		rooms.set(code, room);
	}
	room.host = conn;
	room.hostGoneAt = 0;
	wsSend(conn, { t: 'room', code: code });
	// tell the TV about phones already waiting in the room
	room.pads.forEach(function (padConn, id) {
		wsSend(conn, { t: 'join', id: id });
	});
	conn.onmessage = function (text) {
		let msg;
		try { msg = JSON.parse(text); } catch (e) { return; }
		if (msg.t === 'to') {
			const pad = room.pads.get(msg.id);
			if (pad) wsSend(pad, msg.m);
		} else if (msg.t === 'all') {
			room.pads.forEach(function (pad) { wsSend(pad, msg.m); });
		} else if (msg.t === 'kick') {
			const pad = room.pads.get(msg.id);
			if (pad) {
				wsSend(pad, { t: 'kicked', why: msg.why || '' });
				pad.socket.end();
			}
		}
	};
	conn.onclose = function () {
		if (room.host === conn) {
			room.host = null;
			room.hostGoneAt = Date.now();
			room.pads.forEach(function (pad) { wsSend(pad, { t: 'hostgone' }); });
		}
	};
}

function attachPad(conn, code, id) {
	code = (code || '').toUpperCase();
	const room = rooms.get(code);
	if (!room) {
		wsSend(conn, { t: 'noroom' });
		setTimeout(function () { conn.socket.end(); }, 200);
		return;
	}
	if (!/^[A-Za-z0-9_-]{4,40}$/.test(id || '')) id = crypto.randomBytes(6).toString('hex');
	const old = room.pads.get(id);
	if (old && old !== conn) {
		old.onclose = null;
		try { old.socket.end(); } catch (e) {}
	}
	room.pads.set(id, conn);
	wsSend(conn, { t: 'joined', code: code, id: id, host: !!(room.host && room.host.open) });
	if (room.host) wsSend(room.host, { t: 'join', id: id });
	conn.onmessage = function (text) {
		let msg;
		try { msg = JSON.parse(text); } catch (e) { return; }
		if (room.host) wsSend(room.host, { t: 'in', id: id, m: msg });
	};
	conn.onclose = function () {
		if (room.pads.get(id) === conn) {
			room.pads.delete(id);
			if (room.host) wsSend(room.host, { t: 'leave', id: id });
		}
	};
}

server.on('upgrade', function (req, socket) {
	const u = new URL(req.url, 'http://x');
	if (u.pathname !== '/ws') {
		socket.destroy();
		return;
	}
	const conn = wsAccept(req, socket);
	if (!conn) return;
	const role = u.searchParams.get('role');
	if (role === 'host') attachHost(conn, u.searchParams.get('room'));
	else if (role === 'pad') attachPad(conn, u.searchParams.get('room'), u.searchParams.get('id'));
	else conn.socket.end();
});

// keep connections alive through proxies, drop dead ones, clean up empty rooms
setInterval(function () {
	const now = Date.now();
	rooms.forEach(function (room, code) {
		const all = [];
		if (room.host) all.push(room.host);
		room.pads.forEach(function (p) { all.push(p); });
		all.forEach(function (c) {
			if (now - c.lastSeen > 45000) {
				try { c.socket.destroy(); } catch (e) {}
				wsClosed(c);
			} else {
				wsSendRaw(c, 0x9, Buffer.alloc(0));
			}
		});
		if (!room.host && room.pads.size === 0 && now - room.hostGoneAt > 10 * 60 * 1000) rooms.delete(code);
		else if (!room.host && now - room.hostGoneAt > 60 * 60 * 1000) rooms.delete(code);
	});
}, 15000);

server.listen(PORT, function () {
	console.log('Liberty Laundry running on http://localhost:' + PORT);
});
