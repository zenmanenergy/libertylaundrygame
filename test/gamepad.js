// Game controller test: fakes a Bluetooth gamepad on the TV page and plays with it.
// Run: PW=/path/to/playwright-core SHOTS=/tmp/shots node test/gamepad.js
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright-core');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const PORT = 8198;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(ok, msg) {
	console.log((ok ? 'PASS ' : 'FAIL ') + msg);
	if (!ok) failed++;
}

(async () => {
	const srv = spawn('node', [path.join(__dirname, '..', 'Server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }) });
	await sleep(600);
	const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
	const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	const errors = [];
	tv.on('pageerror', e => errors.push(e.message));

	// a fake standard-mapping controller the test can press buttons on
	await tv.addInitScript(() => {
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
	});
	await tv.goto('http://localhost:' + PORT + '/');
	await sleep(1200);

	const noPad = await tv.evaluate(() => SU.G.players.filter(p => p).length);
	check(noPad === 0, 'no players before a controller is used');

	await tv.evaluate(() => { window.fakePadPlugged = true; });
	await sleep(200);
	const idle = await tv.evaluate(() => SU.G.players.filter(p => p).length);
	check(idle === 0, 'a connected controller does not join until a button is pressed');

	// press A: joins, but doesn't start the game on the same press
	await tv.evaluate(() => press(0, true));
	await sleep(200);
	let s = await tv.evaluate(() => { const p = SU.G.players[0]; return { mode: SU.G.mode, id: p && p.id, name: p && p.name }; });
	check(s.id === 'gp0' && s.mode === 'lobby', 'pressing A joins as player 1 and stays in the lobby (' + JSON.stringify(s) + ')');
	await tv.evaluate(() => press(0, false));
	await sleep(150);
	await tv.screenshot({ path: SHOTS + '/gp_lobby.png' });

	// START starts the game
	await tv.evaluate(() => press(9, true));
	await sleep(150);
	await tv.evaluate(() => press(9, false));
	await sleep(1800);
	s = await tv.evaluate(() => SU.G.mode + ' ' + SU.G.players[0].state);
	check(s === 'play alive', 'START begins the game (' + s + ')');

	// stick right moves
	const x0 = await tv.evaluate(() => SU.G.players[0].x);
	await tv.evaluate(() => { fakePad.axes[0] = 1; });
	await sleep(500);
	await tv.evaluate(() => { fakePad.axes[0] = 0; });
	const x1 = await tv.evaluate(() => SU.G.players[0].x);
	check(x1 > x0 + 40, 'stick right moves the player (' + Math.round(x0) + ' -> ' + Math.round(x1) + ')');

	// D-pad left moves back
	await tv.evaluate(() => press(14, true));
	await sleep(400);
	await tv.evaluate(() => press(14, false));
	const x2 = await tv.evaluate(() => SU.G.players[0].x);
	check(x2 < x1 - 30, 'D-pad left moves the player (' + Math.round(x1) + ' -> ' + Math.round(x2) + ')');

	// B blows a bubble
	const b0 = await tv.evaluate(() => SU.G.bubbles.length);
	await tv.evaluate(() => press(1, true));
	await sleep(100);
	await tv.evaluate(() => press(1, false));
	await sleep(50);
	const b1 = await tv.evaluate(() => SU.G.bubbles.length);
	check(b1 > b0, 'B blows a bubble (' + b0 + ' -> ' + b1 + ')');

	// A jumps
	await sleep(600);
	const y0 = await tv.evaluate(() => SU.G.players[0].y);
	await tv.evaluate(() => press(0, true));
	await sleep(200);
	const y1 = await tv.evaluate(() => SU.G.players[0].y);
	await tv.evaluate(() => press(0, false));
	check(y1 < y0 - 30, 'A jumps (' + Math.round(y0) + ' -> ' + Math.round(y1) + ')');

	// getting hit rumbles the controller
	await sleep(1500);
	await tv.evaluate(() => { const p = SU.G.players[0]; p.inv = 0; const e = SU.G.enemies[0]; e.spawnT = 0; e.state = 'walk'; e.x = p.x; e.y = p.y + p.h - e.h; });
	await sleep(300);
	const rumbles = await tv.evaluate(() => fakePad.rumbles);
	check(rumbles > 0, 'getting hit rumbles the controller (' + rumbles + ')');

	// switching the controller off marks the player away; back on reclaims the slot
	await tv.evaluate(() => { window.fakePadPlugged = false; });
	await sleep(200);
	const away = await tv.evaluate(() => SU.G.players[0].connected);
	check(away === false, 'turning the controller off marks the player as away');
	await tv.evaluate(() => { window.fakePadPlugged = true; press(1, true); });
	await sleep(200);
	await tv.evaluate(() => press(1, false));
	s = await tv.evaluate(() => SU.G.players.filter(p => p).length + ' ' + SU.G.players[0].connected);
	check(s === '1 true', 'turning it back on returns to the same player (' + s + ')');

	await tv.screenshot({ path: SHOTS + '/gp_play.png' });
	check(errors.length === 0, 'no page errors' + (errors.length ? ' (' + errors[0] + ')' : ''));

	await browser.close();
	srv.kill();
	console.log(failed ? failed + ' FAILED' : 'ALL PASS');
	process.exit(failed ? 1 : 0);
})();
