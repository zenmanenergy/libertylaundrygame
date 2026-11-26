// TV side of the connection. The TV is the host: it runs the whole game
// and the phones only send button presses.
(function () {
	const SU = window.SU = window.SU || {};

	// the folder the game is served from, e.g. "/libertylaundry/" or "/"
	SU.BASE = location.pathname.replace(/[^/]*$/, '');

	const net = SU.net = {
		code: null,
		connected: false,
		onJoin: null,
		onLeave: null,
		onInput: null,
		ws: null
	};

	let retry = 0;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		let saved = '';
		try { saved = sessionStorage.getItem('llRoom') || ''; } catch (e) {}
		const ws = new WebSocket(proto + '//' + location.host + SU.BASE + 'ws?role=host&room=' + saved);
		net.ws = ws;
		ws.onopen = function () {
			retry = 0;
			net.connected = true;
		};
		ws.onmessage = function (ev) {
			let m;
			try { m = JSON.parse(ev.data); } catch (e) { return; }
			if (m.t === 'room') {
				net.code = m.code;
				try { sessionStorage.setItem('llRoom', m.code); } catch (e) {}
			} else if (m.t === 'join') {
				if (net.onJoin) net.onJoin(m.id);
			} else if (m.t === 'leave') {
				if (net.onLeave) net.onLeave(m.id);
			} else if (m.t === 'in') {
				if (net.onInput) net.onInput(m.id, m.m);
			}
		};
		ws.onclose = function () {
			net.connected = false;
			net.ws = null;
			retry++;
			setTimeout(connect, Math.min(5000, 500 * retry));
		};
	}

	function raw(obj) {
		if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj));
	}

	net.to = function (id, msg) { raw({ t: 'to', id: id, m: msg }); };
	net.all = function (msg) { raw({ t: 'all', m: msg }); };
	net.kick = function (id, why) { raw({ t: 'kick', id: id, why: why }); };
	net.start = connect;

	net.padUrl = function () {
		return location.origin + SU.BASE + 'pad.html?room=' + (net.code || '');
	};
})();
