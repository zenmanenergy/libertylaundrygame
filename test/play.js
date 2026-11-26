// End-to-end test: TV + two phones in headless Chrome.
// node test/play.js   (needs playwright-core and Chrome)
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright-core');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const PORT = 8199;
// PREFIX=/libertylaundry runs the game behind a small proxy that strips /libertylaundry, like nginx does
const PREFIX = process.env.PREFIX || '';
const base = PREFIX ? 'http://localhost:' + (PORT + 1) + PREFIX : 'http://localhost:' + PORT;

function startPrefixProxy() {
	const http = require('http');
	const net = require('net');
	const px = http.createServer(function (req, res) {
		if (!req.url.startsWith(PREFIX + '/')) { res.writeHead(404); res.end(); return; }
		const up = http.request({ port: PORT, path: req.url.slice(PREFIX.length), method: req.method, headers: req.headers }, function (r) {
			res.writeHead(r.statusCode, r.headers);
			r.pipe(res);
		});
		req.pipe(up);
	});
	px.on('upgrade', function (req, sock, head) {
		const up = net.connect(PORT, '127.0.0.1', function () {
			let h = req.method + ' ' + req.url.slice(PREFIX.length) + ' HTTP/1.1\r\n';
			for (let i = 0; i < req.rawHeaders.length; i += 2) h += req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1] + '\r\n';
			up.write(h + '\r\n');
			up.write(head);
			up.pipe(sock);
			sock.pipe(up);
		});
		up.on('error', function () { sock.destroy(); });
		sock.on('error', function () { up.destroy(); });
	});
	px.listen(PORT + 1);
	return px;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(ok, what) { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; }

(async () => {
	const srv = spawn('node', [path.join(__dirname, '..', 'Server', 'server.js')], { env: { ...process.env, PORT: String(PORT) } });
	const proxy = PREFIX ? startPrefixProxy() : null;
	await sleep(500);
	const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
	const errors = [];
	const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	const tv = await tvCtx.newPage();
	tv.on('pageerror', e => errors.push('tv: ' + e.message));
	await tv.goto(base + '/');
	await tv.waitForFunction(() => window.SU && SU.net.code, null, { timeout: 5000 });
	const code = await tv.evaluate(() => SU.net.code);
	check(/^[A-Z]{4}$/.test(code), 'TV got room code ' + code);
	const padUrl = await tv.evaluate(() => SU.net.padUrl());
	check(padUrl === base + '/pad.html?room=' + code, 'QR points at ' + padUrl);
	await sleep(300);
	await tv.screenshot({ path: SHOTS + '/1_lobby.png' });

	const pads = [];
	for (let i = 0; i < 2; i++) {
		const c = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
		const p = await c.newPage();
		p.on('pageerror', e => errors.push('pad' + i + ': ' + e.message));
		await p.goto(base + '/?pad=' + code);
		pads.push(p);
	}
	await sleep(800);
	const n = await tv.evaluate(() => SU.G.players.filter(p => p).length);
	check(n === 2, 'two phones joined (' + n + ')');
	const name0 = await pads[0].textContent('#name');
	check(name0 === 'Suds', 'phone 1 shows its player name (' + name0 + ')');
	await pads[0].screenshot({ path: SHOTS + '/2_pad.png' });
	await tv.screenshot({ path: SHOTS + '/3_lobby_joined.png' });

	// JUMP on phone 1 starts the game
	const jb = await pads[0].$('#jumpBtn');
	const box = await jb.boundingBox();
	async function hold(page, sel, ms) {
		await page.dispatchEvent(sel, 'pointerdown', { pointerId: 7, isPrimary: true });
		await sleep(ms);
		await page.dispatchEvent(sel, 'pointerup', { pointerId: 7, isPrimary: true });
	}
	await hold(pads[0], '#jumpBtn', 120);
	await sleep(300);
	const mode = await tv.evaluate(() => SU.G.mode);
	check(mode === 'play', 'JUMP on phone starts the game (' + mode + ')');
	const alive = await tv.evaluate(() => SU.G.players.filter(p => p && p.state === 'alive').length);
	check(alive === 2, 'both players spawned (' + alive + ')');

	// stick: drag right on phone 2 and check the player moves right
	const x0 = await tv.evaluate(() => SU.G.players[1].x);
	await pads[1].dispatchEvent('#stick', 'pointerdown', { pointerId: 3, clientX: 150, clientY: 200 });
	await pads[1].dispatchEvent('#stick', 'pointermove', { pointerId: 3, clientX: 110, clientY: 200 });
	await sleep(500);
	await pads[1].dispatchEvent('#stick', 'pointerup', { pointerId: 3, clientX: 110, clientY: 200 });
	const x1 = await tv.evaluate(() => SU.G.players[1].x);
	check(x1 < x0 - 40, 'phone stick moves player 2 left (' + Math.round(x0) + ' -> ' + Math.round(x1) + ')');

	// fire a bubble from phone 1
	await hold(pads[0], '#fireBtn', 80);
	await sleep(150);
	const nb = await tv.evaluate(() => SU.G.bubbles.length);
	check(nb >= 1, 'BUBBLE button blows a bubble (' + nb + ')');
	await sleep(1500);
	await tv.screenshot({ path: SHOTS + '/4_play.png' });

	// trap test: put an enemy in front of player 1 and fire
	const trapped = await tv.evaluate(async () => {
		const G = SU.G, p = G.players[0];
		const e = G.enemies[0];
		e.spawnT = 0; e.x = p.x + 60; e.y = p.y + p.h - e.h; e.vx = 0;
		p.dir = 1; p.inv = 5;
		p.input = { l: 0, r: 0, j: 0, f: 1 };
		await new Promise(r => setTimeout(r, 60));
		p.input = { l: 0, r: 0, j: 0, f: 0 };
		await new Promise(r => setTimeout(r, 200));
		return e.state;
	});
	check(trapped === 'trapped', 'bubble traps an enemy (' + trapped + ')');
	await sleep(1200);
	await tv.screenshot({ path: SHOTS + '/5_trapped.png' });

	// pop it: move player onto the bubble
	const popped = await tv.evaluate(async () => {
		const G = SU.G, p = G.players[0];
		const b = G.bubbles.find(b => b.enemy);
		const before = p.score;
		p.x = b.x - p.w / 2; p.y = b.y - p.h / 2; p.vy = 0;
		await new Promise(r => setTimeout(r, 100));
		return { score: p.score - before, flung: G.enemies.filter(e => e.state === 'flung').length };
	});
	check(popped.score >= 1000 && popped.flung === 1, 'popping a trapped enemy scores and flings it (' + JSON.stringify(popped) + ')');
	await sleep(2500);
	const items = await tv.evaluate(() => SU.G.items.length);
	check(items === 1, 'flung enemy lands as a treat (' + items + ')');

	// clear the level: pop everything
	await tv.evaluate(() => {
		const G = SU.G;
		G.enemies.forEach(e => { if (e.state === 'walk') { e.state = 'flung'; e.vy = -300; e.vx = 100; e.flyT = 0; e.chain = 1; } });
	});
	await sleep(3000);
	await tv.evaluate(() => { SU.G.items.forEach(it => { const p = SU.G.players[0]; it.x = p.x; it.y = p.y; }); });
	await sleep(2500);
	const m2 = await tv.evaluate(() => SU.G.mode + ' ' + SU.G.round);
	check(/clear|play 2/.test(m2), 'clearing all enemies shows the clear banner (' + m2 + ')');
	await tv.screenshot({ path: SHOTS + '/6_clear.png' });
	await sleep(3500);
	const m3 = await tv.evaluate(() => SU.G.mode + ' ' + SU.G.round + ' ' + SU.G.enemies.length);
	check(m3 === 'play 2 5', 'round 2 starts with all enemies back (' + m3 + ')');

	// pad gets score updates
	const sc = await pads[0].textContent('#score');
	check(/Score: [1-9]/.test(sc), 'phone shows score (' + sc + ')');

	// reconnect: reload phone 2, it keeps its slot
	await pads[1].reload();
	await sleep(1000);
	const slots = await tv.evaluate(() => SU.G.players.filter(p => p).map(p => p.name + ':' + p.connected).join(','));
	check(slots === 'Suds:true,Rinse:true', 'reloaded phone keeps its player (' + slots + ')');

	// death and game over
	await tv.evaluate(() => { SU.G.players.filter(p => p).forEach(p => { p.lives = 1; p.inv = 0; }); });
	await tv.evaluate(() => {
		const G = SU.G;
		G.players.filter(p => p).forEach((p, i) => { const e = G.enemies[i]; e.spawnT = 0; e.state = 'walk'; e.x = p.x; e.y = p.y; });
	});
	await sleep(1800);
	const st = await tv.evaluate(() => SU.G.mode + ' ' + SU.G.players.map(p => p && p.state).join(','));
	check(/gameover/.test(st), 'losing all lives ends the game (' + st + ')');
	await tv.screenshot({ path: SHOTS + '/7_gameover.png' });
	await sleep(4500);
	const st2 = await tv.evaluate(() => SU.G.mode);
	check(st2 === 'lobby', 'game over returns to the lobby (' + st2 + ')');

	// a different screen shape still fills the screen
	await tv.setViewportSize({ width: 1280, height: 800 });
	await sleep(300);
	await tv.screenshot({ path: SHOTS + '/8_1280x800.png' });

	check(errors.length === 0, 'no page errors ' + errors.join(' | '));
	await browser.close();
	srv.kill();
	if (proxy) proxy.close();
	console.log(fails ? fails + ' FAILED' : 'ALL PASS');
	process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
