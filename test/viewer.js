// Second TV test: a host TV, a viewer TV showing the same game, a phone, and a
// (fake) game controller plugged into the viewer TV.
// Run: PW=/path/to/playwright-core SHOTS=/tmp/shots node test/viewer.js
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright-core');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const PORT = 8197;
const BASE = 'http://localhost:' + PORT + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(ok, msg) {
	console.log((ok ? 'PASS ' : 'FAIL ') + msg);
	if (!ok) failed++;
}

const fakePad = () => {
	const buttons = [];
	for (let i = 0; i < 17; i++) buttons.push({ pressed: false, value: 0 });
	window.fakePad = {
		index: 0, id: 'Fake Xbox Controller', connected: true, mapping: 'standard',
		axes: [0, 0, 0, 0], buttons: buttons, rumbles: 0,
		vibrationActuator: { playEffect: function () { window.fakePad.rumbles++; return Promise.resolve('complete'); } }
	};
	window.fakePadPlugged = false;
	navigator.getGamepads = function () { return [window.fakePadPlugged ? window.fakePad : null, null, null, null]; };
	window.press = function (i, down) { buttons[i].pressed = down; buttons[i].value = down ? 1 : 0; };
};

(async () => {
	const srv = spawn('node', [path.join(__dirname, '..', 'Server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }) });
	await sleep(600);
	const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
	const errors = [];

	const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	host.on('pageerror', e => errors.push('host: ' + e.message));
	await host.goto(BASE);
	await host.waitForFunction(() => SU.net.code, null, { timeout: 5000 });
	const code = await host.evaluate(() => SU.net.code);

	// a wrong code says so
	const lost = await browser.newPage({ viewport: { width: 960, height: 540 } });
	await lost.goto(BASE + 'index.html?watch=ZZZZ');
	await sleep(1200);
	check(await lost.evaluate(() => SU.net.noRoom), 'a viewer with a wrong code is told there is no such game');
	await lost.close();

	// the second TV: watch.html, type the code, Enter
	const tv2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	tv2.on('pageerror', e => errors.push('viewer: ' + e.message));
	await tv2.addInitScript(fakePad);
	await tv2.goto(BASE + 'watch.html');
	await tv2.fill('#codeInput', code.toLowerCase());
	await tv2.press('#codeInput', 'Enter');
	await tv2.waitForFunction(() => window.SU && SU.net && SU.net.vid, null, { timeout: 5000 }).catch(() => {});
	await sleep(800);
	check(await host.evaluate(() => SU.net.viewers) === 1, 'the host TV sees one viewer');
	check(await tv2.evaluate(() => SU.net.viewer && SU.net.code), 'the second TV is watching ' + code);

	// a phone at the second location joins with the same code
	const phone = await browser.newPage({ viewport: { width: 844, height: 390 } });
	await phone.goto(BASE + 'pad.html?room=' + code);
	await sleep(1000);
	const p0 = await tv2.evaluate(() => SU.G.players[0] && SU.G.players[0].name);
	check(p0 === 'Suds', 'a phone that joins shows up on the second TV (' + p0 + ')');

	// a controller on the second TV joins as player 2
	await tv2.evaluate(() => { window.fakePadPlugged = true; press(0, true); });
	await sleep(600);
	await tv2.evaluate(() => press(0, false));
	await sleep(300);
	const p1 = await host.evaluate(() => SU.G.players[1] && SU.G.players[1].id);
	check(/^v[0-9a-f]+:gp0$/.test(p1 || ''), 'a controller on the second TV joins the host game (' + p1 + ')');
	check(await host.evaluate(() => SU.G.mode) === 'lobby', 'the joining press does not start the game');
	await tv2.screenshot({ path: SHOTS + '/view_lobby.png' });
	await host.screenshot({ path: SHOTS + '/view_host_lobby.png' });

	// START on that controller starts the game on the host
	await tv2.evaluate(() => press(9, true));
	await sleep(200);
	await tv2.evaluate(() => press(9, false));
	await sleep(2200);
	check(await host.evaluate(() => SU.G.mode) === 'play', 'START on the second TV starts the game');
	check(await tv2.evaluate(() => SU.G.mode) === 'play', 'the second TV shows the game playing');
	const counts = await Promise.all([host, tv2].map(pg => pg.evaluate(() => SU.G.enemies.length)));
	check(counts[0] === counts[1] && counts[0] > 0, 'both TVs show the same lint bunnies (' + counts.join(' / ') + ')');

	// moving with the controller
	const hx0 = await host.evaluate(() => SU.G.players[1].x);
	await tv2.evaluate(() => { fakePad.axes[0] = 1; });
	await sleep(500);
	await tv2.evaluate(() => { fakePad.axes[0] = 0; });
	await sleep(400);
	const hx1 = await host.evaluate(() => SU.G.players[1].x);
	const vx1 = await tv2.evaluate(() => SU.G.players[1].x);
	check(hx1 > hx0 + 40, 'the controller on the second TV moves its player (' + Math.round(hx0) + ' -> ' + Math.round(hx1) + ')');
	check(Math.abs(vx1 - hx1) < 6, 'the second TV shows the player in the same place (' + Math.round(vx1) + ' vs ' + Math.round(hx1) + ')');

	// a bubble from it shows on both
	await tv2.evaluate(() => press(1, true));
	await sleep(120);
	await tv2.evaluate(() => press(1, false));
	await sleep(250);
	const bubs = await Promise.all([host, tv2].map(pg => pg.evaluate(() => SU.G.bubbles.length)));
	check(bubs[0] > 0 && bubs[1] > 0, 'a bubble shows on both TVs (' + bubs.join(' / ') + ')');
	await tv2.screenshot({ path: SHOTS + '/view_play.png' });

	// getting hit rumbles the controller on the second TV
	await host.evaluate(() => { const p = SU.G.players[1]; p.inv = 0; const e = SU.G.enemies[0]; e.spawnT = 0; e.state = 'walk'; e.x = p.x; e.y = p.y + p.h - e.h; });
	await sleep(500);
	const rum = await tv2.evaluate(() => fakePad.rumbles);
	check(rum > 0, 'getting hit rumbles the controller on the second TV (' + rum + ')');

	// smooth motion: the viewer moves things between snapshots
	await sleep(2500);
	await host.evaluate(() => { SU.G.players[1].inv = 99; });
	await tv2.evaluate(() => { fakePad.axes[0] = -1; });
	await sleep(400);
	const smooth = await tv2.evaluate(() => new Promise(res => {
		const xs = [];
		const t0 = performance.now();
		(function tick() {
			xs.push(Math.round(SU.G.players[1].x * 2));
			if (performance.now() - t0 < 300) requestAnimationFrame(tick);
			else res({ frames: xs.length, distinct: new Set(xs).size });
		})();
	}));
	await tv2.evaluate(() => { fakePad.axes[0] = 0; });
	// 0.3 s is only 6 snapshots; smooth motion changes nearly every frame
	check(smooth.distinct > 8 && smooth.distinct >= smooth.frames * 0.5, 'motion on the second TV is smooth between snapshots (' + smooth.distinct + ' positions in ' + smooth.frames + ' frames)');

	// the level change slides on the second TV too
	await host.evaluate(() => { SU.G.enemies = []; SU.G.items = []; });
	await tv2.waitForFunction(() => SU.G.mode === 'transition', null, { timeout: 8000 }).catch(() => {});
	await sleep(1200);
	check(await tv2.evaluate(() => SU.G.mode) === 'transition', 'the second TV shows the level slide');
	await tv2.screenshot({ path: SHOTS + '/view_slide.png' });
	await tv2.waitForFunction(() => SU.G.mode === 'play' && SU.G.levelNum === 2, null, { timeout: 6000 }).catch(() => {});
	check(await tv2.evaluate(() => SU.G.levelNum + ' ' + SU.G.level.name) === '2 Rinse', 'the second TV moves on to level 2');

	// snapshot size
	const size = await host.evaluate(() => JSON.stringify({ t: 'view', m: SU.G && 1 }).length);
	const snapBytes = await host.evaluate(() => {
		let n = 0;
		const real = SU.net.view;
		return new Promise(res => {
			SU.net.view = function (s) { n = JSON.stringify(s).length; SU.net.view = real; real(s); res(n); };
		});
	});
	console.log('     snapshot ' + snapBytes + ' bytes, about ' + Math.round(snapBytes * 20 / 1024) + ' KB/s per second TV');
	void size;

	// the second TV closing: its controller's player goes away on the host
	await tv2.close();
	await sleep(800);
	check(await host.evaluate(() => SU.net.viewers) === 0, 'the host sees the viewer leave');
	check(await host.evaluate(() => SU.G.players[1].connected) === false, 'the second TV\'s controller player is marked away');

	check(errors.length === 0, 'no page errors' + (errors.length ? ' (' + errors[0] + ')' : ''));
	await browser.close();
	srv.kill();
	console.log(failed ? failed + ' FAILED' : 'ALL PASS');
	process.exit(failed ? 1 : 0);
})();
