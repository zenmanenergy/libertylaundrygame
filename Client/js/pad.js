// Phone controller: a slide stick on the left, BUBBLE and JUMP on the right.
// Sends {t:'i', l, r, j, f} to the TV whenever the input changes, and
// repeats it every 200 ms so a lost message never leaves a button stuck.
(function () {
	const $ = function (id) { return document.getElementById(id); };
	const params = new URLSearchParams(location.search);
	let room = (params.get('room') || params.get('pad') || '').toUpperCase();

	let padId = null;
	try { padId = localStorage.getItem('llPadId'); } catch (e) {}
	if (!padId) {
		padId = Math.random().toString(36).slice(2, 12);
		try { localStorage.setItem('llPadId', padId); } catch (e) {}
	}

	const input = { l: 0, r: 0, d: 0, j: 0, f: 0 };
	let lastSent = '';
	let ws = null;
	let retry = 0;
	let gaveUp = false;

	// ---------- connection ----------

	function wsUrl() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return proto + '//' + location.host + location.pathname.replace(/[^/]*$/, '') + 'ws?role=pad&room=' + encodeURIComponent(room) + '&id=' + encodeURIComponent(padId);
	}

	function connect() {
		gaveUp = false;
		$('name').textContent = 'Connecting...';
		ws = new WebSocket(wsUrl());
		ws.onopen = function () {
			retry = 0;
			lastSent = '';
			send(true);
		};
		ws.onmessage = function (ev) {
			let m;
			try { m = JSON.parse(ev.data); } catch (e) { return; }
			handle(m);
		};
		ws.onclose = function () {
			ws = null;
			if (gaveUp) return;
			$('status').textContent = 'Reconnecting...';
			retry++;
			setTimeout(connect, Math.min(4000, 500 * retry));
		};
	}

	function handle(m) {
		if (m.t === 'noroom') {
			gaveUp = true;
			showJoin('No game with code ' + room + '. Check the TV.');
		} else if (m.t === 'joined') {
			showPad();
			$('status').textContent = m.host ? 'Eyes on the TV!' : 'Waiting for the TV...';
			try { history.replaceState(null, '', 'pad.html?room=' + room); } catch (e) {}
		} else if (m.t === 'hostgone') {
			$('status').textContent = 'TV disconnected. Waiting...';
		} else if (m.t === 'kicked') {
			gaveUp = true;
			showJoin(m.why || 'The game is full.');
		} else if (m.t === 'you') {
			document.documentElement.style.setProperty('--pc', m.color);
			$('name').textContent = m.name;
			$('status').textContent = m.status || '';
			$('lives').textContent = m.lives != null ? 'Lives: ' + m.lives : '';
			$('score').textContent = m.score != null ? 'Score: ' + m.score : '';
		} else if (m.t === 'buzz') {
			if (navigator.vibrate) navigator.vibrate(m.ms || 80);
		}
	}

	function send(force) {
		if (!ws || ws.readyState !== 1) return;
		const s = JSON.stringify({ t: 'i', l: input.l, r: input.r, d: input.d, j: input.j, f: input.f });
		if (force || s !== lastSent) {
			ws.send(s);
			lastSent = s;
		}
	}
	setInterval(function () { send(true); }, 200);

	// ---------- screens ----------

	function showJoin(msg) {
		$('join').classList.remove('hidden');
		$('pad').classList.add('hidden');
		$('joinMsg').textContent = msg || '';
		$('codeInput').value = room;
	}

	function showPad() {
		$('join').classList.add('hidden');
		$('pad').classList.remove('hidden');
	}

	$('joinBtn').addEventListener('click', function () {
		room = $('codeInput').value.trim().toUpperCase();
		if (!/^[A-Z]{4}$/.test(room)) {
			$('joinMsg').textContent = 'The code is 4 letters.';
			return;
		}
		if (ws) {
			gaveUp = true;
			ws.close();
		}
		connect();
		showPad();
	});
	$('codeInput').addEventListener('keydown', function (e) {
		if (e.key === 'Enter') $('joinBtn').click();
	});

	// ---------- stick ----------

	const stick = $('stick');
	const base = $('stickBase');
	const knob = $('stickKnob');
	let stickId = null;
	let ox = 0;
	let oy = 0;
	const DEAD = 14;
	const DOWN = 28;
	const MAXR = 50;

	function stickSet(dx, dy) {
		const d = Math.hypot(dx, dy);
		if (d > MAXR) {
			dx = dx / d * MAXR;
			dy = dy / d * MAXR;
		}
		knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
		input.l = dx < -DEAD ? 1 : 0;
		input.r = dx > DEAD ? 1 : 0;
		// pulling down (more than sideways wobble) + JUMP drops through a platform
		input.d = dy > DOWN ? 1 : 0;
		send(false);
	}

	stick.addEventListener('pointerdown', function (e) {
		if (stickId !== null) return;
		stickId = e.pointerId;
		try { stick.setPointerCapture(e.pointerId); } catch (err) {}
		const rect = stick.getBoundingClientRect();
		ox = e.clientX;
		oy = e.clientY;
		base.style.left = (e.clientX - rect.left) + 'px';
		base.style.top = (e.clientY - rect.top) + 'px';
		stickSet(0, 0);
		e.preventDefault();
	});
	stick.addEventListener('pointermove', function (e) {
		if (e.pointerId !== stickId) return;
		stickSet(e.clientX - ox, e.clientY - oy);
	});
	function stickEnd(e) {
		if (e.pointerId !== stickId) return;
		stickId = null;
		stickSet(0, 0);
	}
	stick.addEventListener('pointerup', stickEnd);
	stick.addEventListener('pointercancel', stickEnd);

	// ---------- buttons ----------

	function bindButton(el, key) {
		const held = new Set();
		function update() {
			input[key] = held.size > 0 ? 1 : 0;
			el.classList.toggle('down', held.size > 0);
			send(false);
		}
		el.addEventListener('pointerdown', function (e) {
			held.add(e.pointerId);
			try { el.setPointerCapture(e.pointerId); } catch (err) {}
			update();
			e.preventDefault();
		});
		['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
			el.addEventListener(ev, function (e) {
				held.delete(e.pointerId);
				update();
			});
		});
	}
	bindButton($('jumpBtn'), 'j');
	bindButton($('fireBtn'), 'f');

	// keyboard, for testing the pad page on a laptop
	const KEYS = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ' ': 'j', w: 'j', ArrowUp: 'j', ArrowDown: 'd', s: 'd', f: 'f', Enter: 'f' };
	window.addEventListener('keydown', function (e) {
		if (document.activeElement === $('codeInput')) return;
		const k = KEYS[e.key];
		if (k) {
			input[k] = 1;
			send(false);
		}
	});
	window.addEventListener('keyup', function (e) {
		const k = KEYS[e.key];
		if (k) {
			input[k] = 0;
			send(false);
		}
	});

	// ---------- fullscreen, wake lock, orientation ----------

	const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
	const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
	if (document.documentElement.requestFullscreen && !isIOS) $('fsBtn').classList.remove('hidden');
	if (isIOS && !standalone) $('iosHint').classList.remove('hidden');

	$('fsBtn').addEventListener('click', function () {
		document.documentElement.requestFullscreen().then(function () {
			if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
		}).catch(function () {});
		wake();
	});

	let wakeLock = null;
	function wake() {
		if (!('wakeLock' in navigator) || wakeLock) return;
		navigator.wakeLock.request('screen').then(function (l) {
			wakeLock = l;
			l.addEventListener('release', function () { wakeLock = null; });
		}).catch(function () {});
	}
	document.addEventListener('pointerdown', wake);
	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'visible') wake();
	});

	function checkRotate() {
		const portrait = window.innerHeight > window.innerWidth;
		$('rotate').classList.toggle('hidden', !portrait || $('pad').classList.contains('hidden'));
	}
	window.addEventListener('resize', checkRotate);
	setInterval(checkRotate, 500);

	// stop iOS from scrolling or zooming the page
	document.addEventListener('touchmove', function (e) {
		if (e.target !== $('codeInput')) e.preventDefault();
	}, { passive: false });
	document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

	// ---------- start ----------

	if (/^[A-Z]{4}$/.test(room)) {
		showPad();
		connect();
	} else {
		showJoin('');
	}
})();
