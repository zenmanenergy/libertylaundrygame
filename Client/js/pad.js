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
	let joined = false;
	// every input message gets a bigger number, so the TV can drop old copies
	let seq = Date.now();

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
			joined = false;
			closeRtc();
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
			joined = true;
			closeRtc();
			showPad();
			$('status').textContent = m.host ? 'Eyes on the TV!' : 'Waiting for the TV...';
			try { history.replaceState(null, '', 'pad.html?room=' + room); } catch (e) {}
		} else if (m.t === 'hostgone') {
			closeRtc();
			$('status').textContent = 'TV disconnected. Waiting...';
		} else if (m.t === 'sig') {
			onSignal(m);
		} else if (m.t === 'pong') {
			onPong(m);
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
			lastSent = s;
			seq++;
			const msg = JSON.stringify({ t: 'i', l: input.l, r: input.r, d: input.d, j: input.j, f: input.f, s: seq });
			if (dcOpen()) dc.send(msg);
			ws.send(msg);
		}
	}

	// ---------- direct link to the TV (WebRTC) ----------
	// Skips the trip to the server when the phone and TV are on the same
	// network. If it can't connect, everything still goes through the server.

	let pc = null;
	let dc = null;
	let rtcReady = null;
	let rtcStarted = 0;

	function dcOpen() {
		return !!(dc && dc.readyState === 'open');
	}

	function wsSend(obj) {
		if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
	}

	function closeRtc() {
		if (pc) {
			try { pc.close(); } catch (e) {}
		}
		pc = null;
		dc = null;
	}

	function startRtc() {
		if (typeof RTCPeerConnection === 'undefined') return;
		closeRtc();
		rtcStarted = Date.now();
		pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
		const myPc = pc;
		// unordered with no resends: a late button press is useless, the next one replaces it
		dc = pc.createDataChannel('in', { ordered: false, maxRetransmits: 0 });
		dc.onopen = function () { send(true); };
		dc.onmessage = function (ev) {
			let m;
			try { m = JSON.parse(ev.data); } catch (e) { return; }
			handle(m);
		};
		pc.onicecandidate = function (e) {
			if (e.candidate && pc === myPc) wsSend({ t: 'sig', c: e.candidate });
		};
		rtcReady = pc.createOffer()
			.then(function (o) { return myPc.setLocalDescription(o); })
			.then(function () { wsSend({ t: 'sig', sdp: myPc.localDescription }); })
			.catch(function () {});
	}

	function onSignal(m) {
		if (!pc) return;
		const myPc = pc;
		if (m.sdp && m.sdp.type === 'answer') {
			rtcReady = rtcReady.then(function () { return myPc.setRemoteDescription(m.sdp); }).catch(function () {});
		} else if (m.c) {
			rtcReady = rtcReady.then(function () { return myPc.addIceCandidate(m.c); }).catch(function () {});
		}
	}

	// try (again) every few seconds until the direct link is up
	setInterval(function () {
		if (!joined || !ws || ws.readyState !== 1 || dcOpen()) return;
		if (Date.now() - rtcStarted > 6000) startRtc();
	}, 1000);

	// ---------- lag readout ----------
	// pings the TV both ways once a second and shows how long the faster one takes

	const lag = { d: null, w: null };
	function onPong(m) {
		const ms = Math.round(performance.now() - m.ts);
		lag[m.v] = lag[m.v] == null ? ms : Math.round(lag[m.v] * 0.6 + ms * 0.4);
	}
	setInterval(function () {
		const now = performance.now();
		if (dcOpen()) dc.send(JSON.stringify({ t: 'ping', ts: now, v: 'd' }));
		else lag.d = null;
		wsSend({ t: 'ping', ts: now, v: 'w' });
		let text = '';
		if (lag.d != null) text = 'Direct to TV: ' + lag.d + ' ms';
		else if (lag.w != null) text = 'Through server: ' + lag.w + ' ms';
		if (lag.d != null && lag.w != null) text += ' (server: ' + lag.w + ' ms)';
		$('link').textContent = text;
	}, 1000);
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
	let MAXR = 50;

	// size the circle to fill the left side of the screen
	function sizeStick() {
		const r = stick.getBoundingClientRect();
		const baseSize = Math.max(150, Math.min(r.width, r.height - 30) * 0.92);
		const knobSize = Math.round(baseSize * 0.4);
		stick.style.setProperty('--base', Math.round(baseSize) + 'px');
		stick.style.setProperty('--knob', knobSize + 'px');
		MAXR = Math.round((baseSize - knobSize) / 2);
	}
	window.addEventListener('resize', sizeStick);
	window.addEventListener('orientationchange', function () { setTimeout(sizeStick, 300); });
	new ResizeObserver(sizeStick).observe(stick);

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
		// the circle jumps to wherever the thumb lands, so you never have to aim for it
		base.classList.add('held');
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
		// let go and the circle glides back to the middle
		base.classList.remove('held');
		base.style.left = '';
		base.style.top = '';
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
