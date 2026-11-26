// Liberty Laundry game logic and drawing. Runs on the TV.
(function () {
	const SU = window.SU;

	// ---------- constants ----------

	const W = 1024;
	const H = 576;
	const T = 32;
	const COLS = 32;
	const ROWS = 18;
	const MAX_PLAYERS = 4;

	const GRAV = 1700;
	const JUMP_V = -640;
	const MAX_FALL = 380;
	const P_SPEED = 165;
	const E_SPEED = 70;
	const E_SPEED_ANGRY = 125;

	const BUBBLE_R = 15;
	const SHOT_TIME = 0.32;
	const SHOT_SPEED = 540;
	const EMPTY_LIFE = 9;
	const TRAP_LIFE = 7;
	const CEIL_Y = T + 4;
	const PLAYER_BUBBLE_R = 21;
	// how long you can stand on a bubble before your weight pops it
	const STAND_LIMIT = 0.45;
	const PLAYER_RISE = 170;

	const COLORS = ['#4fc3ff', '#ff8a3d', '#7ee07e', '#e58cff'];
	const NAMES = ['Suds', 'Rinse', 'Spin', 'Fluff'];
	// color shift used when a player has no art of their own and borrows p1's
	const HUE = ['', 'hue-rotate(180deg) saturate(1.4)', 'hue-rotate(260deg)', 'hue-rotate(80deg)'];

	// ---------- state ----------

	const G = SU.G = {
		mode: 'lobby',
		level: SU.LEVELS[0],
		levelNum: 1,
		map: null,
		trans: null,
		players: [null, null, null, null],
		padSlot: new Map(),
		enemies: [],
		bubbles: [],
		items: [],
		fx: [],
		levelTime: 0,
		hurry: false,
		clearT: 0,
		modeT: 0,
		banner: null,
		time: 0
	};

	function rand(a, b) {
		return a + Math.random() * (b - a);
	}

	function clamp(v, a, b) {
		return v < a ? a : v > b ? b : v;
	}

	// ---------- levels ----------

	// placeholder colors per level (hue), so each screen looks different until real art exists
	const HUES = [205, 190, 265, 25, 140, 300, 45, 340, 170, 225];

	function layoutIndex(num) {
		return (num - 1) % SU.LEVELS.length;
	}

	function setLevel(num) {
		G.levelNum = num;
		G.level = SU.LEVELS[layoutIndex(num)];
		G.map = G.level.map;
	}

	// ---------- tiles ----------

	function tileAt(c, r) {
		if (c < 0 || c >= COLS) return '#';
		if (r < 0 || r >= ROWS) return '.';
		const ch = G.map[r][c];
		if (ch === '#' || ch === '=') return ch;
		return '.';
	}

	function findTiles(ch, map) {
		const m = map || G.map;
		const out = [];
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				if (m[r][c] === ch) out.push({ c: c, r: r });
			}
		}
		return out;
	}

	// Moves a box {x, y, w, h, vx, vy} through the level.
	// Walls (#) block everything. Platforms (=) only stop things falling onto them.
	function moveBody(b, dt) {
		b.hitWall = false;
		let nx = b.x + b.vx * dt;
		const r0 = Math.floor(b.y / T);
		const r1 = Math.floor((b.y + b.h - 0.001) / T);
		if (b.vx > 0) {
			const c = Math.floor((nx + b.w - 0.001) / T);
			for (let r = r0; r <= r1; r++) {
				if (tileAt(c, r) === '#') {
					nx = c * T - b.w;
					b.hitWall = true;
					break;
				}
			}
		} else if (b.vx < 0) {
			const c = Math.floor(nx / T);
			for (let r = r0; r <= r1; r++) {
				if (tileAt(c, r) === '#') {
					nx = (c + 1) * T;
					b.hitWall = true;
					break;
				}
			}
		}
		b.x = nx;

		const prevBottom = b.y + b.h;
		let ny = b.y + b.vy * dt;
		const c0 = Math.floor(b.x / T);
		const c1 = Math.floor((b.x + b.w - 0.001) / T);
		b.onGround = false;
		if (b.vy >= 0) {
			const row = Math.floor((ny + b.h) / T);
			const top = row * T;
			if (ny + b.h >= top && prevBottom <= top + 0.5) {
				for (let c = c0; c <= c1; c++) {
					const t = tileAt(c, row);
					if (t === '#' || (t === '=' && !(b.dropT > 0))) {
						ny = top - b.h;
						b.vy = 0;
						b.onGround = true;
						break;
					}
				}
			}
		} else {
			const row = Math.floor(ny / T);
			for (let c = c0; c <= c1; c++) {
				if (row >= 0 && tileAt(c, row) === '#') {
					ny = (row + 1) * T;
					b.vy = 0;
					break;
				}
			}
			if (ny < 0) {
				ny = 0;
				b.vy = 0;
			}
		}
		// fall out of the floor gap, drop in from the top
		if (ny > H) ny = -b.h;
		b.y = ny;
	}

	// true when standing on a platform (=) and not on any wall (#), so it's safe to drop through
	function onPlatform(b) {
		const row = Math.floor((b.y + b.h + 1) / T);
		const c0 = Math.floor(b.x / T);
		const c1 = Math.floor((b.x + b.w - 0.001) / T);
		let plat = false;
		for (let c = c0; c <= c1; c++) {
			const t = tileAt(c, row);
			if (t === '#') return false;
			if (t === '=') plat = true;
		}
		return plat;
	}

	function overlap(a, b) {
		return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	}

	function circleRect(cx, cy, r, b) {
		const px = clamp(cx, b.x, b.x + b.w);
		const py = clamp(cy, b.y, b.y + b.h);
		return (cx - px) * (cx - px) + (cy - py) * (cy - py) < r * r;
	}

	// ---------- effects ----------

	function floatText(x, y, text, color) {
		G.fx.push({ kind: 'text', x: x, y: y, text: text, color: color || '#fff', t: 0, dur: 1.1 });
	}

	function popFx(x, y) {
		G.fx.push({ kind: 'pop', x: x, y: y, t: 0, dur: 0.25 });
	}

	function banner(text, dur, color) {
		G.banner = { text: text, t: 0, dur: dur, color: color || '#fff' };
	}

	// ---------- players ----------

	function spawnPoint(slot, map) {
		const pts = findTiles(String(slot + 1), map);
		if (pts.length) return pts[0];
		return { c: 3 + slot * 2, r: ROWS - 2 };
	}

	function placePlayer(p) {
		const sp = spawnPoint(p.slot);
		p.x = sp.c * T + (T - p.w) / 2;
		p.y = (sp.r + 1) * T - p.h;
		p.vx = 0;
		p.vy = 0;
		p.dir = p.slot % 2 === 0 ? 1 : -1;
		p.inv = 2.5;
	}

	function spawnPlayer(p, fresh) {
		if (fresh) {
			p.lives = 3;
			p.score = 0;
		}
		p.state = 'alive';
		placePlayer(p);
		SU.sfx('join');
	}

	function newPlayer(slot, id) {
		return {
			slot: slot,
			id: id,
			name: NAMES[slot],
			color: COLORS[slot],
			connected: true,
			awayT: 0,
			x: 0, y: 0, w: 24, h: 28, vx: 0, vy: 0,
			dir: 1,
			onGround: false,
			state: 'waiting',
			stateT: 0,
			inv: 0,
			lives: 3,
			score: 0,
			input: { l: 0, r: 0, d: 0, j: 0, f: 0 },
			dropT: 0,
			prevJ: 0,
			prevF: 0,
			fireCool: 0,
			blowT: 0,
			coyote: 0,
			jumpBuf: 0,
			animT: 0,
			padMsg: '',
			padSentT: 0
		};
	}

	function hurtPlayer(p) {
		p.state = 'hurt';
		p.stateT = 0;
		p.vx = 0;
		p.vy = 0;
		SU.sfx('hurt');
		SU.net.to(p.id, { t: 'buzz', ms: 300 });
	}

	function updatePlayer(p, dt) {
		const inp = p.input;
		const jPressed = inp.j && !p.prevJ;
		const fPressed = inp.f && !p.prevF;
		p.prevJ = inp.j;
		p.prevF = inp.f;
		p.stateT += dt;
		p.animT += dt;

		if (!p.connected) {
			p.awayT += dt;
			if (p.awayT > 30) {
				G.players[p.slot] = null;
				G.padSlot.delete(p.id);
			}
		}

		if (p.state === 'waiting') {
			if (jPressed) {
				if (G.mode === 'lobby') startGame();
				else if (G.mode === 'play') spawnPlayer(p, true);
			}
			return;
		}
		if (p.state === 'out') {
			if (jPressed && p.stateT > 1.5 && G.mode === 'play') spawnPlayer(p, true);
			return;
		}
		if (p.state === 'bubbled') return;
		if (p.state === 'hurt') {
			if (p.stateT > 1.3) {
				p.lives--;
				if (p.lives > 0) {
					p.state = 'alive';
					placePlayer(p);
				} else {
					p.state = 'out';
					p.stateT = 0;
				}
			}
			return;
		}

		// level cleared: everyone hangs in the air while the next level slides in
		if (G.mode === 'clear' || G.mode === 'transition') {
			p.vx = 0;
			p.vy = 0;
			p.standOn = null;
			return;
		}

		// alive
		if (p.inv > 0) p.inv -= dt;
		const ax = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
		p.vx = ax * P_SPEED;
		if (ax !== 0) p.dir = ax;

		// holding JUMP keeps you jumping: you jump again the moment you land
		if (inp.j) p.jumpBuf = 0.12;
		else p.jumpBuf -= dt;
		if (p.onGround) p.coyote = 0.08;
		else p.coyote -= dt;
		if (p.dropT > 0) p.dropT -= dt;
		if (p.jumpBuf > 0 && p.coyote > 0) {
			if (inp.d && p.onGround && onPlatform(p)) {
				// down + JUMP: drop through the platform you're standing on
				p.dropT = 0.25;
				p.y += 2;
				p.vy = 60;
				p.onGround = false;
			} else {
				p.vy = JUMP_V;
				SU.sfx('jump');
			}
			p.coyote = 0;
			p.jumpBuf = 0;
		}
		// every jump is full height, however briefly JUMP was pressed (phone lag makes hold time unreliable)
		p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
		const prevBottom = p.y + p.h;
		moveBody(p, dt);

		p.fireCool -= dt;
		p.blowT -= dt;
		if ((fPressed || inp.f) && p.fireCool <= 0) {
			blowBubble(p);
			p.fireCool = fPressed ? 0.25 : 0.4;
			p.blowT = 0.18;
		}

		// bubbles: land on top and you're standing on it, but your weight pops it
		// after STAND_LIMIT seconds. Keep jumping (hold JUMP) and it holds you up,
		// so you can ride it as it rises. Touching one from the side or below pops it.
		let standing = null;
		for (let i = 0; i < G.bubbles.length; i++) {
			const b = G.bubbles[i];
			if (b.phase === 'shot' || b.dead) continue;
			// a freshly bubbled player can't be popped straight away by whoever is standing next to them
			if (b.player && b.t < 0.5) continue;
			const top = b.y - b.r;
			const over = Math.abs(p.x + p.w / 2 - b.x) < b.r + p.w / 2 - 6;
			const landing = p.vy >= 0 && over && prevBottom <= top + 8 && p.y + p.h >= top - 1;
			if (landing && !standing) {
				standing = b;
				continue;
			}
			// your own fresh bubble doesn't pop when you bump it, so you can
			// blow one against a wall, jump past it and land on top
			if (b.owner === p.slot && b.t < 0.6) continue;
			if (circleRect(b.x, b.y, b.r - 2, p)) popChain(b, p);
		}
		if (standing && !standing.dead) {
			const b = standing;
			if (p.standOn !== b) {
				p.standOn = b;
				p.standT = 0;
			}
			p.standT += dt;
			b.load = 1;
			p.y = b.y - b.r - p.h + 1;
			p.vy = 0;
			p.onGround = true;
			// squashed against the ceiling, or stood on too long: it pops
			const r = Math.floor(p.y / T);
			const headHit = p.y < 0 || tileAt(Math.floor(p.x / T), r) === '#' || tileAt(Math.floor((p.x + p.w - 0.001) / T), r) === '#';
			if (p.standT > STAND_LIMIT || headHit) {
				p.standOn = null;
				p.onGround = false;
				if (headHit) p.y = Math.max(p.y, (r + 1) * T);
				popChain(b, p);
			}
		} else {
			p.standOn = null;
		}

		// enemies
		if (p.inv <= 0) {
			for (let i = 0; i < G.enemies.length; i++) {
				const e = G.enemies[i];
				if (e.state === 'walk' && e.spawnT <= 0 && overlap(shrink(p, 3), shrink(e, 3))) {
					hurtPlayer(p);
					break;
				}
			}
		}

		// treats
		for (let i = G.items.length - 1; i >= 0; i--) {
			const it = G.items[i];
			if (overlap(p, it)) {
				p.score += it.value;
				floatText(it.x + it.w / 2, it.y, String(it.value), p.color);
				G.items.splice(i, 1);
				SU.sfx('treat');
			}
		}
	}

	function shrink(b, n) {
		return { x: b.x + n, y: b.y + n, w: b.w - n * 2, h: b.h - n * 2 };
	}

	// ---------- bubbles ----------

	function blowBubble(p) {
		const b = {
			x: p.x + p.w / 2 + p.dir * 14,
			y: p.y + p.h / 2,
			r: BUBBLE_R,
			dir: p.dir,
			vx: p.dir * SHOT_SPEED,
			vy: 0,
			phase: 'shot',
			t: 0,
			life: EMPTY_LIFE,
			enemy: null,
			owner: p.slot,
			seed: Math.random() * 10,
			dead: false
		};
		G.bubbles.push(b);
		SU.sfx('blow');
	}

	function tileSolidAt(x, y) {
		return tileAt(Math.floor(x / T), Math.floor(y / T)) === '#';
	}

	function updateBubble(b, dt) {
		b.t += dt;
		if (b.phase === 'shot') {
			const k = 1 - b.t / SHOT_TIME;
			b.vx = b.dir * SHOT_SPEED * Math.max(0, k);
			const nx = b.x + b.vx * dt;
			if (tileSolidAt(nx + b.dir * b.r, b.y)) {
				b.phase = 'float';
				b.t = 0;
			} else {
				b.x = nx;
			}
			for (let i = 0; i < G.enemies.length && b.phase === 'shot'; i++) {
				const e = G.enemies[i];
				if (e.state === 'walk' && circleRect(b.x, b.y, b.r + 2, e)) {
					e.state = 'trapped';
					e.bubble = b;
					b.enemy = e;
					b.phase = 'float';
					b.t = 0;
					b.life = TRAP_LIFE;
					const p = G.players[b.owner];
					if (p) p.score += 10;
					SU.sfx('trap');
				}
			}
			for (let i = 0; i < G.players.length && b.phase === 'shot'; i++) {
				const o = G.players[i];
				if (o && o.slot !== b.owner && o.state === 'alive' && circleRect(b.x, b.y, b.r + 2, o)) trapPlayer(b, o);
			}
			if (b.t >= SHOT_TIME && b.phase === 'shot') {
				b.phase = 'float';
				b.t = 0;
			}
			return;
		}

		// floating up, then drifting along the ceiling
		const atTop = b.y - b.r <= CEIL_Y + 1;
		if (!atTop) {
			const rise = b.player ? -PLAYER_RISE : -48;
			b.vy += (rise - b.vy) * Math.min(1, dt * 3);
			b.vx *= Math.pow(0.2, dt);
			b.vx += Math.sin(G.time * 1.5 + b.seed) * 6 * dt;
		} else {
			b.vy = 0;
			const target = W / 2 + Math.sin(G.time * 0.4 + b.seed) * 60;
			b.vx += (clamp((target - b.x) * 0.5, -40, 40) - b.vx) * Math.min(1, dt * 2);
		}
		b.x += b.vx * dt;
		b.y += b.vy * dt;
		b.y = Math.max(CEIL_Y + b.r, b.y);
		b.x = clamp(b.x, T + b.r, W - T - b.r);

		if (b.enemy) {
			b.enemy.x = b.x - b.enemy.w / 2;
			b.enemy.y = b.y - b.enemy.h / 2;
		}
		if (b.player) {
			b.player.x = b.x - b.player.w / 2;
			b.player.y = b.y - b.player.h / 2;
			// a bubble with a player in it pops as soon as it reaches the ceiling
			if (b.y - b.r <= CEIL_Y + 1) {
				b.dead = true;
				popFx(b.x, b.y);
				SU.sfx('pop', 1);
				releasePlayer(b);
			}
			return;
		}

		if (b.t >= b.life) {
			b.dead = true;
			popFx(b.x, b.y);
			if (b.enemy) {
				const e = b.enemy;
				e.state = 'walk';
				e.angry = true;
				e.bubble = null;
				e.vy = 0;
				e.dir = Math.random() < 0.5 ? -1 : 1;
			}
		}
	}

	function separateBubbles() {
		const list = G.bubbles;
		for (let i = 0; i < list.length; i++) {
			const a = list[i];
			if (a.phase !== 'float' || a.dead) continue;
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j];
				if (b.phase !== 'float' || b.dead) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d = Math.hypot(dx, dy) || 0.01;
				const min = a.r + b.r;
				if (d < min) {
					const push = (min - d) / 2;
					a.x -= dx / d * push;
					a.y -= dy / d * push;
					b.x += dx / d * push;
					b.y += dy / d * push;
				}
			}
		}
	}

	function trapPlayer(b, o) {
		b.player = o;
		b.phase = 'float';
		b.t = 0;
		b.r = PLAYER_BUBBLE_R;
		b.life = 30;
		b.vx = 0;
		o.state = 'bubbled';
		o.stateT = 0;
		o.vx = 0;
		o.vy = 0;
		o.bubble = b;
		SU.sfx('trap');
		SU.net.to(o.id, { t: 'buzz', ms: 120 });
		const shooter = G.players[b.owner];
		if (shooter) floatText(b.x, b.y - 30, 'GOTCHA!', shooter.color);
	}

	// lets a player out of a bubble, with a moment of safety
	function releasePlayer(b) {
		const o = b.player;
		b.player = null;
		if (!o || o.state !== 'bubbled') return;
		o.state = 'alive';
		o.bubble = null;
		o.x = clamp(b.x - o.w / 2, T, W - T - o.w);
		o.y = Math.max(CEIL_Y, b.y - o.h / 2);
		o.vx = 0;
		o.vy = -120;
		o.inv = Math.max(o.inv, 1);
		o.jumpBuf = 0;
	}

	// Pops a bubble and every bubble touching it, and so on down the chain.
	function popChain(start, p) {
		const queue = [start];
		start.dead = true;
		let kills = 0;
		let popped = 0;
		while (queue.length) {
			const b = queue.shift();
			popped++;
			popFx(b.x, b.y);
			SU.sfx('pop', popped);
			if (b.player) releasePlayer(b);
			if (b.enemy) {
				kills++;
				flingEnemy(b.enemy, kills);
				b.enemy = null;
			}
			G.bubbles.forEach(function (o) {
				if (o.dead || o.phase === 'shot') return;
				if (Math.hypot(o.x - b.x, o.y - b.y) < b.r + o.r + 6) {
					o.dead = true;
					queue.push(o);
				}
			});
		}
		let pts = popped * 10;
		if (kills > 0) {
			const killPts = 1000 * (Math.pow(2, kills) - 1);
			pts += killPts;
			floatText(start.x, start.y - 20, String(killPts), p.color);
			if (kills > 1) floatText(start.x, start.y - 44, kills + 'x COMBO!', '#ffe066');
		}
		p.score += pts;
		if (kills) SU.net.to(p.id, { t: 'buzz', ms: 40 + kills * 30 });
	}

	// ---------- enemies ----------

	function newEnemy(c, r) {
		const w = 26;
		const h = 26;
		return {
			x: c * T + (T - w) / 2,
			y: (r + 1) * T - h,
			w: w, h: h, vx: 0, vy: 0,
			dir: Math.random() < 0.5 ? -1 : 1,
			onGround: false,
			state: 'walk',
			angry: false,
			think: rand(0.3, 1.2),
			jumpCool: rand(1, 3),
			edgeChecked: false,
			spawnT: 1.5,
			bubble: null,
			spin: 0,
			chain: 1,
			animT: Math.random()
		};
	}

	function nearestPlayer(e) {
		let best = null;
		let bd = Infinity;
		G.players.forEach(function (p) {
			if (!p || p.state !== 'alive') return;
			const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y) * 1.5;
			if (d < bd) {
				bd = d;
				best = p;
			}
		});
		return best;
	}

	function platformAbove(e) {
		const c = Math.floor((e.x + e.w / 2) / T);
		const r = Math.floor((e.y + e.h) / T);
		for (let dr = 2; dr <= 3; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const t = tileAt(c + dc, r - dr);
				if (t === '=') return true;
			}
		}
		return false;
	}

	function updateEnemy(e, dt) {
		e.animT += dt;
		if (e.state === 'trapped') return;
		if (e.state === 'flung') {
			e.spin += dt * 14;
			e.vy = Math.min(MAX_FALL * 1.5, e.vy + GRAV * dt);
			moveBody(e, dt);
			if (e.hitWall) e.vx = -e.vx;
			e.flyT = (e.flyT || 0) + dt;
			if (e.onGround && e.flyT > 0.3) {
				e.dead = true;
				const values = [500, 1000, 2000, 3000, 5000, 8000];
				G.items.push({
					x: e.x + e.w / 2 - 12,
					y: e.y + e.h - 24,
					w: 24, h: 24, vx: 0, vy: 0,
					value: values[Math.min(values.length - 1, e.chain - 1)],
					t: 0
				});
				SU.sfx('splat');
			}
			return;
		}

		if (e.spawnT > 0) {
			e.spawnT -= dt;
			return;
		}
		if (G.hurry) e.angry = true;
		const speed = e.angry ? E_SPEED_ANGRY : E_SPEED;
		const target = nearestPlayer(e);
		e.think -= dt;
		e.jumpCool -= dt;
		if (e.think <= 0) {
			e.think = rand(0.6, 1.8);
			if (target && Math.abs((target.y + target.h) - (e.y + e.h)) < 24 && Math.random() < 0.7) {
				e.dir = target.x > e.x ? 1 : -1;
			} else if (Math.random() < 0.2) {
				e.dir = -e.dir;
			}
		}
		if (target && e.onGround && e.jumpCool <= 0 && target.y + target.h < e.y - 20 && platformAbove(e)) {
			e.vy = JUMP_V;
			e.jumpCool = rand(1.2, 2.5);
		}
		e.vx = e.dir * speed;

		// at a ledge, sometimes turn back (always drop if the player is below)
		if (e.onGround) {
			const fx = e.dir > 0 ? e.x + e.w + 2 : e.x - 2;
			const below = tileAt(Math.floor(fx / T), Math.floor((e.y + e.h + 2) / T));
			if (below === '.') {
				if (!e.edgeChecked) {
					e.edgeChecked = true;
					const playerBelow = target && target.y > e.y + 40;
					if (!playerBelow && Math.random() < 0.65) e.dir = -e.dir;
				}
			} else {
				e.edgeChecked = false;
			}
		}

		e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
		moveBody(e, dt);
		if (e.hitWall) e.dir = -e.dir;
	}

	function flingEnemy(e, chain) {
		e.state = 'flung';
		e.bubble = null;
		e.chain = chain;
		e.vx = (Math.random() < 0.5 ? -1 : 1) * rand(120, 220);
		e.vy = -460;
		e.flyT = 0;
	}

	// ---------- items ----------

	function updateItem(it, dt) {
		it.t += dt;
		it.vy = Math.min(MAX_FALL, it.vy + GRAV * dt);
		moveBody(it, dt);
	}

	// ---------- game flow ----------

	function resetLevel() {
		G.map = G.level.map;
		G.trans = null;
		G.enemies = findTiles('e').map(function (t) { return newEnemy(t.c, t.r); });
		G.bubbles = [];
		G.items = [];
		G.fx = [];
		G.levelTime = 0;
		G.hurry = false;
		G.clearT = 0;
		G.players.forEach(function (p) {
			if (p && p.state === 'alive') placePlayer(p);
		});
	}

	function startGame() {
		if (!G.players.some(function (p) { return p; })) return;
		G.mode = 'play';
		G.modeT = 0;
		setLevel(1);
		resetLevel();
		useLevelArt();
		G.players.forEach(function (p) {
			if (p && p.connected) spawnPlayer(p, true);
		});
		banner('LEVEL 1', 1.6);
		SU.sfx('start');
	}
	SU.startGame = startGame;

	function toLobby() {
		G.mode = 'lobby';
		G.modeT = 0;
		setLevel(1);
		resetLevel();
		useLevelArt();
		G.players.forEach(function (p) {
			if (p) {
				p.state = 'waiting';
				p.lives = 3;
			}
		});
	}

	// The old level slides down off the bottom while the next one slides in
	// from the top. Players float from where they were to their new start spots.
	const SLIDE_TIME = 2.6;

	function easeInOut(k) {
		return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
	}

	function startTransition() {
		const nextNum = G.levelNum + 1;
		const next = SU.LEVELS[layoutIndex(nextNum)];
		G.items = [];
		G.bubbles = [];
		G.mode = 'transition';
		G.modeT = 0;
		G.trans = { from: layoutIndex(G.levelNum), to: layoutIndex(nextNum), num: nextNum, t: 0 };
		G.players.forEach(function (p) {
			if (!p) return;
			const sp = spawnPoint(p.slot, next.map);
			p.tFrom = { x: p.x, y: p.y };
			p.tTo = { x: sp.c * T + (T - p.w) / 2, y: (sp.r + 1) * T - p.h };
		});
		SU.sfx('whoosh');
	}

	function updateTransition(dt) {
		const tr = G.trans;
		tr.t += dt;
		const k = easeInOut(Math.min(1, tr.t / SLIDE_TIME));
		G.players.forEach(function (p) {
			if (!p || p.state !== 'alive' || !p.tFrom) return;
			p.x = p.tFrom.x + (p.tTo.x - p.tFrom.x) * k;
			p.y = p.tFrom.y + (p.tTo.y - p.tFrom.y) * k;
		});
		if (tr.t >= SLIDE_TIME) {
			setLevel(tr.num);
			resetLevel();
			useLevelArt();
			G.players.forEach(function (p) {
				if (p) {
					p.tFrom = null;
					p.tTo = null;
				}
			});
			G.mode = 'play';
			G.modeT = 0;
			banner('LEVEL ' + G.levelNum, 1.8);
			SU.sfx('start');
		}
	}

	// how high players float while the level changes
	function liftAmount() {
		if (G.mode === 'clear') return Math.min(1, G.modeT * 1.5) * 10 + Math.sin(G.time * 4) * 3;
		if (G.mode === 'transition') {
			const k = Math.min(1, G.trans.t / SLIDE_TIME);
			return (1 - Math.max(0, (k - 0.85) / 0.15)) * 10 + Math.sin(G.time * 4) * 3;
		}
		return 0;
	}

	function update(dt) {
		G.time += dt;
		G.modeT += dt;
		if (G.banner) {
			G.banner.t += dt;
			if (G.banner.t > G.banner.dur) G.banner = null;
		}

		G.bubbles.forEach(function (b) { b.load = 0; });
		G.players.forEach(function (p) { if (p) updatePlayer(p, dt); });

		if (G.mode !== 'lobby') {
			G.levelTime += dt;
			G.enemies.forEach(function (e) { updateEnemy(e, dt); });
			G.bubbles.forEach(function (b) { if (!b.dead) updateBubble(b, dt); });
			separateBubbles();
			G.items.forEach(function (it) { updateItem(it, dt); });
		}
		G.enemies = G.enemies.filter(function (e) { return !e.dead; });
		G.bubbles = G.bubbles.filter(function (b) { return !b.dead; });
		G.items = G.items.filter(function (it) { return it.t < 12; });
		G.fx.forEach(function (f) { f.t += dt; });
		G.fx = G.fx.filter(function (f) { return f.t < f.dur; });

		if (G.mode === 'play') {
			if (!G.hurry && G.levelTime > G.level.hurryAfter && G.enemies.length) {
				G.hurry = true;
				banner('HURRY UP!', 2, '#ff6b6b');
				SU.sfx('hurry');
			}
			if (G.enemies.length === 0) {
				G.clearT += dt;
				if (G.clearT > 3.5 || (G.clearT > 1.5 && G.items.length === 0)) {
					G.mode = 'clear';
					G.modeT = 0;
					// pop whatever bubbles are left (letting out any bubbled players)
					G.bubbles.forEach(function (b) {
						popFx(b.x, b.y);
						if (b.player) releasePlayer(b);
					});
					G.bubbles = [];
					banner('SPARKLING CLEAN!', 2.2, '#9ef');
					SU.sfx('clear');
				}
			}
			const active = G.players.filter(function (p) { return p && (p.state === 'alive' || p.state === 'hurt' || p.state === 'bubbled'); });
			const out = G.players.filter(function (p) { return p && p.state === 'out'; });
			if (active.length === 0 && out.length > 0) {
				G.mode = 'gameover';
				G.modeT = 0;
				banner('GAME OVER', 4, '#ff6b6b');
			}
		} else if (G.mode === 'clear' && G.modeT > 2.2) {
			startTransition();
		} else if (G.mode === 'transition') {
			updateTransition(dt);
		} else if (G.mode === 'gameover' && G.modeT > 4) {
			toLobby();
		}

		G.players.forEach(function (p) { if (p) sendPad(p, dt); });
	}

	// ---------- phones ----------

	function padStatus(p) {
		if (G.mode === 'lobby') return 'Press JUMP to start!';
		if (G.mode === 'gameover') return 'Game over';
		if (G.mode === 'clear' || G.mode === 'transition') return 'Level clear! Next level...';
		if (p.state === 'waiting') return 'Press JUMP to jump in!';
		if (p.state === 'out') return 'Out of lives. Press JUMP to go again';
		if (p.state === 'hurt') return 'Ouch!';
		if (p.state === 'bubbled') return 'You got bubbled! Going up...';
		return 'Eyes on the TV!';
	}

	function sendPad(p, dt) {
		p.padSentT -= dt;
		if (!p.connected || p.padSentT > 0) return;
		const msg = {
			t: 'you',
			name: p.name,
			color: p.color,
			status: padStatus(p),
			lives: p.state === 'waiting' ? null : p.lives,
			score: p.score
		};
		const s = JSON.stringify(msg);
		if (s !== p.padMsg) {
			SU.net.to(p.id, msg);
			p.padMsg = s;
			p.padSentT = 0.2;
		}
	}

	SU.net.onJoin = function (id) {
		if (G.padSlot.has(id)) {
			const p = G.players[G.padSlot.get(id)];
			if (p) {
				p.connected = true;
				p.awayT = 0;
				p.padMsg = '';
				return;
			}
		}
		const slot = G.players.findIndex(function (p) { return !p; });
		if (slot < 0) {
			SU.net.kick(id, 'The game is full (' + MAX_PLAYERS + ' players).');
			return;
		}
		const p = newPlayer(slot, id);
		G.players[slot] = p;
		G.padSlot.set(id, slot);
		SU.sfx('join');
	};

	SU.net.onLeave = function (id) {
		const slot = G.padSlot.get(id);
		const p = slot != null ? G.players[slot] : null;
		if (p) {
			p.connected = false;
			p.awayT = 0;
			p.input = { l: 0, r: 0, d: 0, j: 0, f: 0 };
		}
	};

	SU.net.onInput = function (id, m) {
		const slot = G.padSlot.get(id);
		const p = slot != null ? G.players[slot] : null;
		if (!p || !m || m.t !== 'i') return;
		p.input = { l: m.l ? 1 : 0, r: m.r ? 1 : 0, d: m.d ? 1 : 0, j: m.j ? 1 : 0, f: m.f ? 1 : 0 };
	};

	// ---------- drawing ----------

	const canvas = document.getElementById('game');
	const screenCtx = canvas.getContext('2d');
	// drawing helpers use ctx; it points at an offscreen canvas while level art is built
	let ctx = screenCtx;
	let view = { s: 1, ox: 0, oy: 0 };
	let tileLayer = null;
	let wallTile = null;

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const cw = Math.floor(window.innerWidth * dpr);
		const ch = Math.floor(window.innerHeight * dpr);
		canvas.width = cw;
		canvas.height = ch;
		canvas.style.width = window.innerWidth + 'px';
		canvas.style.height = window.innerHeight + 'px';
		const s = Math.min(cw / W, ch / H);
		view = { s: s, ox: Math.floor((cw - W * s) / 2), oy: Math.floor((ch - H * s) / 2) };
	}
	window.addEventListener('resize', resize);

	// Each level's background and tiles are drawn once into its own canvas,
	// so a whole level can slide during the transition.
	const levelArt = {};

	function levelColors(i) {
		const h = HUES[i % HUES.length];
		return {
			wall: ['hsl(' + h + ',45%,46%)', 'hsl(' + h + ',55%,62%)', 'hsl(' + h + ',45%,33%)'],
			platform: ['hsl(' + h + ',40%,90%)', '#ffffff', 'hsl(' + h + ',30%,70%)'],
			bg: ['hsl(' + h + ',55%,19%)', 'hsl(' + h + ',55%,11%)']
		};
	}

	function tileKey(kind, i) {
		const own = kind + '_' + (i + 1);
		if (SU.hasSprite(own)) return own;
		return 'tile_' + kind;
	}

	function buildLevelArt(i) {
		if (levelArt[i]) return levelArt[i];
		const level = SU.LEVELS[i];
		const col = levelColors(i);
		const layer = document.createElement('canvas');
		layer.width = W;
		layer.height = H;
		const c = layer.getContext('2d');
		c.imageSmoothingEnabled = false;
		ctx = c;
		drawBackground(i);
		ctx = screenCtx;
		for (let r = 0; r < ROWS; r++) {
			for (let cc = 0; cc < COLS; cc++) {
				const t = level.map[r][cc];
				const x = cc * T;
				const y = r * T;
				if (t === '#') {
					if (!SU.drawSprite(c, tileKey('wall', i), 0, x + T / 2, y + T)) placeholderTile(c, x, y, col.wall[0], col.wall[1], col.wall[2]);
				} else if (t === '=') {
					if (!SU.drawSprite(c, tileKey('platform', i), 0, x + T / 2, y + T)) placeholderTile(c, x, y, col.platform[0], col.platform[1], col.platform[2]);
				}
			}
		}
		const wall = document.createElement('canvas');
		wall.width = T;
		wall.height = T;
		const wc = wall.getContext('2d');
		wc.imageSmoothingEnabled = false;
		if (!SU.drawSprite(wc, tileKey('wall', i), 0, T / 2, T)) placeholderTile(wc, 0, 0, col.wall[0], col.wall[1], col.wall[2]);
		levelArt[i] = { layer: layer, wall: wall };
		return levelArt[i];
	}

	function useLevelArt() {
		const art = buildLevelArt(layoutIndex(G.levelNum));
		tileLayer = art.layer;
		wallTile = art.wall;
		// get the next level ready ahead of time
		buildLevelArt(layoutIndex(G.levelNum + 1));
	}

	// tiled wall look
	function placeholderTile(c, x, y, fill, light, dark) {
		c.fillStyle = dark;
		c.fillRect(x, y, T, T);
		c.fillStyle = fill;
		c.fillRect(x + 1, y + 1, T - 2, T - 2);
		c.fillStyle = light;
		c.fillRect(x + 1, y + 1, T - 2, 3);
		c.fillRect(x + 1, y + 1, 3, T - 2);
	}

	function drawBackground(i) {
		if (SU.drawSprite(ctx, 'bg_' + (i + 1), 0, W / 2, H)) return;
		const col = levelColors(i);
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, col.bg[0]);
		g.addColorStop(1, col.bg[1]);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
		// placeholder laundromat: a store sign and faint rows of front-loading washers
		ctx.globalAlpha = 0.16;
		drawBrand(W / 2, 100, 44);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = 'rgba(255,255,255,0.06)';
		ctx.lineWidth = 3;
		for (let row = 0; row < 2; row++) {
			const y = 150 + row * 230;
			for (let x = 80; x < W - 80; x += 130) {
				ctx.strokeRect(x, y, 110, 120);
				ctx.beginPath();
				ctx.arc(x + 55, y + 68, 36, 0, Math.PI * 2);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(x, y + 22);
				ctx.lineTo(x + 110, y + 22);
				ctx.stroke();
			}
		}
	}

	function playerKey(p, anim) {
		const own = 'p' + (p.slot + 1) + '_' + anim;
		if (SU.hasSprite(own)) return { key: own, filter: '' };
		if (SU.hasSprite('p1_' + anim)) return { key: 'p1_' + anim, filter: HUE[p.slot] };
		return null;
	}

	function drawPlayer(p) {
		if (p.state === 'waiting' || p.state === 'out') return;
		if (p.state === 'alive' && p.inv > 0 && Math.floor(p.inv * 10) % 2 === 0) return;
		let anim = 'idle';
		if (p.state === 'hurt') anim = 'hurt';
		else if (p.state === 'bubbled') anim = 'fall';
		else if (p.blowT > 0) anim = 'blow';
		else if (!p.onGround) anim = p.vy < 0 ? 'jump' : 'fall';
		else if (Math.abs(p.vx) > 1) anim = 'walk';
		const cx = p.x + p.w / 2;
		const bottom = p.y + p.h - (p.state === 'alive' ? liftAmount() : 0);
		const k = playerKey(p, anim);
		if (!(k && SU.drawSprite(ctx, k.key, p.animT, cx, bottom, p.dir < 0, k.filter))) {
			placeholderPlayer(p, anim, cx, bottom);
		}
		// name tag
		ctx.fillStyle = p.color;
		ctx.font = 'bold 10px Verdana, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(p.connected ? 'P' + (p.slot + 1) : 'P' + (p.slot + 1) + '?', cx, bottom - p.h - 6);
	}

	function placeholderPlayer(p, anim, cx, bottom) {
		ctx.save();
		ctx.translate(cx, bottom);
		if (anim === 'hurt') {
			ctx.translate(0, -14);
			ctx.rotate(p.stateT * 12);
			ctx.translate(0, 14);
		}
		const bob = anim === 'walk' ? Math.abs(Math.sin(p.animT * 14)) * 3 : 0;
		ctx.scale(p.dir < 0 ? -1 : 1, 1);
		ctx.fillStyle = p.color;
		roundRect(-13, -30 - bob, 26, 30, 9);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.35)';
		roundRect(-8, -16 - bob, 14, 13, 6);
		ctx.fill();
		// eye
		ctx.fillStyle = '#fff';
		ctx.beginPath();
		ctx.arc(5, -22 - bob, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#123';
		ctx.beginPath();
		ctx.arc(7, -22 - bob, 2.5, 0, Math.PI * 2);
		ctx.fill();
		if (anim === 'blow') {
			ctx.fillStyle = '#123';
			ctx.beginPath();
			ctx.arc(12, -13 - bob, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	function roundRect(x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function drawEnemy(e) {
		if (e.spawnT > 0 && Math.floor(e.spawnT * 8) % 2 === 0) return;
		const cx = e.x + e.w / 2;
		const bottom = e.y + e.h;
		if (e.state === 'trapped') {
			const b = e.bubble;
			const escaping = b && b.life - b.t < 2;
			if (!SU.drawSprite(ctx, 'enemy_trapped', e.animT, cx, bottom, e.dir < 0, escaping ? 'sepia(1) saturate(4) hue-rotate(-30deg)' : '')) {
				placeholderEnemy(e, cx, bottom, 0.8, escaping);
			}
			return;
		}
		if (e.state === 'flung') {
			ctx.save();
			ctx.translate(cx, e.y + e.h / 2);
			ctx.rotate(e.spin);
			ctx.translate(-cx, -(e.y + e.h / 2));
			if (!SU.drawSprite(ctx, 'enemy_flung', e.animT, cx, bottom, false)) placeholderEnemy(e, cx, bottom, 1, false);
			ctx.restore();
			return;
		}
		const key = e.angry ? 'enemy_angry' : 'enemy_walk';
		if (!SU.drawSprite(ctx, key, e.animT, cx, bottom, e.dir < 0)) placeholderEnemy(e, cx, bottom, 1, e.angry);
	}

	// a lint bunny from the dryer
	function placeholderEnemy(e, cx, bottom, scale, red) {
		ctx.save();
		ctx.translate(cx, bottom - 13 * scale);
		ctx.scale(scale * (e.dir < 0 ? -1 : 1), scale);
		const wob = Math.sin(e.animT * 12) * 1.5;
		ctx.fillStyle = red ? '#d9655b' : '#9aa0a6';
		// ears
		ctx.beginPath();
		ctx.ellipse(-5, -14 + wob, 3, 8, -0.2, 0, Math.PI * 2);
		ctx.ellipse(5, -14 - wob, 3, 8, 0.2, 0, Math.PI * 2);
		ctx.fill();
		// fluffy body
		ctx.beginPath();
		for (let i = 0; i < 14; i++) {
			const a = i / 14 * Math.PI * 2;
			const rr = 12 + (i % 2 ? 2 : -1);
			ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
		}
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.beginPath();
		ctx.arc(4, -3, 3.5, 0, Math.PI * 2);
		ctx.arc(-3, -3, 3.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#111';
		ctx.beginPath();
		ctx.arc(5, -3, 1.6, 0, Math.PI * 2);
		ctx.arc(-2, -3, 1.6, 0, Math.PI * 2);
		ctx.fill();
		if (red) {
			ctx.strokeStyle = '#111';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(-6, -9);
			ctx.lineTo(-1, -7);
			ctx.moveTo(7, -9);
			ctx.lineTo(2, -7);
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawBubble(b) {
		const escaping = b.enemy && b.life - b.t < 2 && Math.floor(b.t * 8) % 2 === 0;
		if (SU.hasSprite('bubble')) {
			// bubbles holding a player are drawn bigger
			const k = b.r / BUBBLE_R;
			ctx.save();
			ctx.translate(b.x, b.y);
			ctx.scale(k, k);
			SU.drawSprite(ctx, 'bubble', b.t, 0, BUBBLE_R + 1, false, escaping ? 'sepia(1) saturate(5) hue-rotate(-40deg)' : '');
			ctx.restore();
			return;
		}
		const wob = Math.sin(b.t * 6 + b.seed) * 1.2;
		const squash = b.load ? 0.12 : 0;
		ctx.save();
		ctx.translate(b.x, b.y + squash * b.r);
		ctx.scale(1 + wob * 0.02 + squash, 1 - wob * 0.02 - squash);
		ctx.fillStyle = escaping ? 'rgba(255,120,120,0.30)' : 'rgba(170,225,255,0.22)';
		ctx.strokeStyle = escaping ? 'rgba(255,160,160,0.95)' : 'rgba(220,245,255,0.9)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(0, 0, b.r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = 'rgba(255,255,255,0.8)';
		ctx.beginPath();
		ctx.arc(-5, -6, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	// a clean sock
	function drawItem(it) {
		if (it.t > 10 && Math.floor(it.t * 8) % 2 === 0) return;
		const cx = it.x + it.w / 2;
		const bottom = it.y + it.h;
		if (SU.drawSprite(ctx, 'treat', it.t, cx, bottom, false)) return;
		ctx.save();
		ctx.translate(cx, bottom);
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = '#9fb6c8';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(-6, -22);
		ctx.lineTo(3, -22);
		ctx.lineTo(3, -9);
		ctx.quadraticCurveTo(12, -9, 12, -4);
		ctx.quadraticCurveTo(12, 0, 6, 0);
		ctx.lineTo(-3, 0);
		ctx.quadraticCurveTo(-6, 0, -6, -4);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ff5a5a';
		ctx.fillRect(-6, -21, 9, 3);
		ctx.fillStyle = '#6fb6ff';
		ctx.fillRect(-6, -16, 9, 3);
		ctx.restore();
	}

	function drawFx(f) {
		const k = f.t / f.dur;
		if (f.kind === 'pop') {
			if (SU.drawSprite(ctx, 'bubble_pop', f.t, f.x, f.y + 16, false)) return;
			ctx.strokeStyle = 'rgba(230,250,255,' + (1 - k) + ')';
			ctx.lineWidth = 2;
			for (let i = 0; i < 8; i++) {
				const a = i / 8 * Math.PI * 2;
				const r1 = 10 + k * 14;
				const r2 = r1 + 5;
				ctx.beginPath();
				ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
				ctx.lineTo(f.x + Math.cos(a) * r2, f.y + Math.sin(a) * r2);
				ctx.stroke();
			}
		} else if (f.kind === 'text') {
			ctx.globalAlpha = 1 - k * k;
			outlineText(f.text, f.x, f.y - k * 30, 16, f.color);
			ctx.globalAlpha = 1;
		}
	}

	function outlineText(text, x, y, size, color, align) {
		ctx.font = 'bold ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
		ctx.textAlign = align || 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		ctx.lineWidth = Math.max(3, size / 5);
		ctx.strokeStyle = '#0b1b26';
		ctx.strokeText(text, x, y);
		ctx.fillStyle = color || '#fff';
		ctx.fillText(text, x, y);
		ctx.textBaseline = 'alphabetic';
	}

	function drawHud() {
		const spots = [{ x: 44, a: 'left' }, { x: W - 44, a: 'right' }, { x: 250, a: 'left' }, { x: W - 250, a: 'right' }];
		G.players.forEach(function (p, i) {
			if (!p) return;
			const s = spots[i];
			let label = p.name + '  ' + p.score;
			if (p.state === 'waiting') label = p.name + '  press JUMP';
			else if (p.state === 'out') label = p.name + '  ' + p.score + '  OUT';
			outlineText(label, s.x, 16, 15, p.color, s.a);
			if (p.state === 'alive' || p.state === 'hurt') {
				for (let k = 0; k < p.lives; k++) {
					const lx = s.a === 'left' ? s.x + 6 + k * 14 : s.x - 6 - k * 14;
					ctx.fillStyle = p.color;
					ctx.beginPath();
					ctx.arc(lx, 32 + 4, 4, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		});
		if (G.mode !== 'lobby') {
			drawBrand(W / 2, 12, 17);
			outlineText('LEVEL ' + G.levelNum + (SU.net.code ? '   join: ' + SU.net.code : ''), W / 2, 28, 10, '#cfe');
		}
	}

	// "LIBERTY" in red, "LAUNDRY" in blue, centered on x
	function drawBrand(x, y, size) {
		ctx.font = 'bold ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
		const w1 = ctx.measureText('LIBERTY ').width;
		const w2 = ctx.measureText('LAUNDRY').width;
		const lx = x - (w1 + w2) / 2;
		outlineText('LIBERTY', lx, y, size, '#ff5a5a', 'left');
		outlineText('LAUNDRY', lx + w1, y, size, '#6fb6ff', 'left');
	}

	function drawLobby() {
		ctx.fillStyle = 'rgba(5,20,30,0.82)';
		ctx.fillRect(0, 0, W, H);
		drawBrand(W / 2, 70, 56);
		outlineText('Trap the lint bunnies in soap bubbles, then pop them!', W / 2, 115, 18, '#fff');

		const qx = 150;
		const qy = 160;
		const qs = 240;
		if (SU.net.code) {
			QR.draw(ctx, SU.net.padUrl(), qx, qy, qs);
			outlineText('Scan with your phone', qx + qs / 2, qy + qs + 22, 16, '#fff');
		} else {
			outlineText(SU.net.connected ? 'Getting a room...' : 'Connecting to server...', qx + qs / 2, qy + qs / 2, 18, '#fc8');
		}

		const tx = 470;
		ctx.textAlign = 'left';
		outlineText('or open', tx, 180, 16, '#cfe', 'left');
		outlineText(location.host + SU.BASE + 'pad.html', tx, 206, 20, '#fff', 'left');
		outlineText('and type the code', tx, 238, 16, '#cfe', 'left');
		outlineText(SU.net.code || '....', tx, 285, 54, '#ffe066', 'left');

		if (/^(localhost|127\.)/.test(location.hostname)) {
			outlineText('Phones cannot reach "localhost". Open this page using this computer\'s network address.', W / 2, 455, 14, '#ff9b7a');
		}

		// slots
		for (let i = 0; i < MAX_PLAYERS; i++) {
			const p = G.players[i];
			const x = 470 + i * 120;
			const y = 345;
			ctx.fillStyle = p ? COLORS[i] : 'rgba(255,255,255,0.1)';
			roundRect(x, y, 104, 48, 10);
			ctx.fill();
			outlineText(p ? p.name : 'P' + (i + 1) + ' open', x + 52, y + 24, 15, p ? '#fff' : 'rgba(255,255,255,0.5)');
		}

		const any = G.players.some(function (p) { return p; });
		const pulse = 0.6 + Math.sin(G.time * 4) * 0.4;
		ctx.globalAlpha = any ? pulse : 0.7;
		outlineText(any ? 'Press JUMP on a phone (or Enter here) to start' : 'Waiting for players...', W / 2, 490, 22, '#fff');
		ctx.globalAlpha = 1;
		if (!SU.audioReady()) outlineText('Click or press any key on this screen to turn on sound', W / 2, 530, 13, '#9ab');
	}

	function drawBanner() {
		const b = G.banner;
		if (!b) return;
		const k = b.t / b.dur;
		const size = 54 + (k < 0.1 ? (0.1 - k) * 300 : 0);
		ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
		outlineText(b.text, W / 2, H / 2 - 20, size, b.color);
		ctx.globalAlpha = 1;
	}

	// On screens that are not 16:9, fill the leftover edges with wall tiles
	// so the whole screen is used.
	function drawMargins() {
		if (!wallTile) return;
		const x0 = Math.floor(-view.ox / view.s / T) - 1;
		const x1 = Math.ceil((canvas.width - view.ox) / view.s / T) + 1;
		const y0 = Math.floor(-view.oy / view.s / T) - 1;
		const y1 = Math.ceil((canvas.height - view.oy) / view.s / T) + 1;
		for (let r = y0; r < y1; r++) {
			for (let c = x0; c < x1; c++) {
				if (c >= 0 && c < COLS && r >= 0 && r < ROWS) continue;
				ctx.drawImage(wallTile, c * T, r * T);
			}
		}
	}

	function render() {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#061219';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
		ctx.imageSmoothingEnabled = false;
		drawMargins();
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, W, H);
		ctx.clip();

		if (G.mode === 'transition' && G.trans) {
			const off = Math.round(easeInOut(Math.min(1, G.trans.t / SLIDE_TIME)) * H);
			ctx.drawImage(buildLevelArt(G.trans.from).layer, 0, off);
			ctx.drawImage(buildLevelArt(G.trans.to).layer, 0, off - H);
		} else if (tileLayer) {
			ctx.drawImage(tileLayer, 0, 0);
		}
		G.items.forEach(drawItem);
		G.enemies.forEach(function (e) { if (e.state !== 'trapped') drawEnemy(e); });
		G.players.forEach(function (p) { if (p) drawPlayer(p); });
		G.bubbles.forEach(function (b) {
			if (b.enemy) drawEnemy(b.enemy);
			drawBubble(b);
		});
		G.fx.forEach(drawFx);
		drawHud();
		if (G.mode === 'lobby') drawLobby();
		drawBanner();
		ctx.restore();
	}

	// ---------- TV keyboard and mouse ----------

	function unlock() {
		SU.audioStart();
		if (G.mode === 'lobby' && G.players.some(function (p) { return p; })) startGame();
	}
	window.addEventListener('keydown', function (e) {
		SU.audioStart();
		if (e.key === 'Enter') unlock();
		if (e.key === 'f' || e.key === 'F') {
			if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
		}
		devKey(e, 1);
	});
	window.addEventListener('keyup', function (e) { devKey(e, 0); });
	window.addEventListener('pointerdown', function () {
		SU.audioStart();
		if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
	});

	// ?keys=1 adds two keyboard players on the TV for testing without phones:
	// player A: A/D move, W jump, S bubble, hold X + W to drop
	// player B: arrows move, Up jump, Down bubble, hold / + Up to drop
	const devKeys = new URLSearchParams(location.search).get('keys') === '1';
	const DEV = {
		a: ['kbA', 'l'], d: ['kbA', 'r'], w: ['kbA', 'j'], s: ['kbA', 'f'], x: ['kbA', 'd'],
		ArrowLeft: ['kbB', 'l'], ArrowRight: ['kbB', 'r'], ArrowUp: ['kbB', 'j'], ArrowDown: ['kbB', 'f'], '/': ['kbB', 'd']
	};
	const devState = { kbA: { t: 'i', l: 0, r: 0, d: 0, j: 0, f: 0 }, kbB: { t: 'i', l: 0, r: 0, d: 0, j: 0, f: 0 } };
	function devKey(e, down) {
		if (!devKeys) return;
		const k = DEV[e.key];
		if (!k) return;
		e.preventDefault();
		if (!G.padSlot.has(k[0])) SU.net.onJoin(k[0]);
		devState[k[0]][k[1]] = down;
		SU.net.onInput(k[0], devState[k[0]]);
	}

	// ---------- main loop ----------

	let last = performance.now();
	let acc = 0;
	const STEP = 1 / 60;
	function frame(now) {
		acc += Math.min(0.1, (now - last) / 1000);
		last = now;
		while (acc >= STEP) {
			update(STEP);
			acc -= STEP;
		}
		render();
		requestAnimationFrame(frame);
	}

	resize();
	setLevel(1);
	resetLevel();
	SU.loadAssets(function () {
		useLevelArt();
		SU.net.start();
		requestAnimationFrame(frame);
	});
})();
