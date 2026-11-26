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
		ws: null,
		peers: {},
		// host side: how many viewer TVs are watching
		viewers: 0,
		// viewer side: this page is a second TV showing someone else's game (?watch=CODE)
		watch: (new URLSearchParams(location.search).get('watch') || '').toUpperCase(),
		vid: '',
		hostHere: false,
		noRoom: false,
		onSnap: null,
		onViewerInput: null,
		onViewerLeave: null,
		onViewerBuzz: null
	};
	net.viewer = /^[A-Z]{4}$/.test(net.watch);

	// ---------- direct link to each phone ----------
	// The server is far away (out over the internet and back). When the phone
	// and TV are on the same network they can also talk directly with WebRTC,
	// which skips the server. The phone starts it; the server only passes the
	// setup messages. Button presses go both ways at once, whichever arrives
	// first wins (they carry a sequence number), so nothing breaks if the
	// direct link can't be made.
	const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

	function closePeer(id) {
		const peer = net.peers[id];
		if (!peer) return;
		try { peer.pc.close(); } catch (e) {}
		delete net.peers[id];
	}

	function fromPhone(id, m, dc) {
		if (!m) return;
		if (m.t === 'ping') {
			const pong = { t: 'pong', ts: m.ts, v: m.v };
			if (dc) {
				if (dc.readyState === 'open') dc.send(JSON.stringify(pong));
			} else {
				net.to(id, pong);
			}
		} else if (m.t === 'sig') {
			onSignal(id, m);
		} else if (net.onInput) {
			net.onInput(id, m);
		}
	}

	function onSignal(id, m) {
		if (typeof RTCPeerConnection === 'undefined') return;
		if (m.sdp && m.sdp.type === 'offer') {
			closePeer(id);
			const pc = new RTCPeerConnection(RTC_CONFIG);
			const peer = { pc: pc, dc: null };
			net.peers[id] = peer;
			pc.onicecandidate = function (e) {
				if (e.candidate) net.to(id, { t: 'sig', c: e.candidate });
			};
			pc.ondatachannel = function (e) {
				peer.dc = e.channel;
				peer.dc.onmessage = function (ev) {
					let msg;
					try { msg = JSON.parse(ev.data); } catch (err) { return; }
					fromPhone(id, msg, peer.dc);
				};
			};
			peer.ready = pc.setRemoteDescription(m.sdp)
				.then(function () { return pc.createAnswer(); })
				.then(function (a) { return pc.setLocalDescription(a); })
				.then(function () { net.to(id, { t: 'sig', sdp: pc.localDescription }); })
				.catch(function () { closePeer(id); });
		} else if (m.c) {
			const peer = net.peers[id];
			if (peer) {
				peer.ready = peer.ready.then(function () { return peer.pc.addIceCandidate(m.c); }).catch(function () {});
			}
		}
	}

	net.direct = function (id) {
		const peer = net.peers[id];
		return !!(peer && peer.dc && peer.dc.readyState === 'open');
	};

	let retry = 0;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		let saved = '';
		try { saved = sessionStorage.getItem('llRoom') || ''; } catch (e) {}
		const url = net.viewer ? 'ws?role=viewer&room=' + net.watch : 'ws?role=host&room=' + saved;
		const ws = new WebSocket(proto + '//' + location.host + SU.BASE + url);
		net.ws = ws;
		ws.onopen = function () {
			retry = 0;
			net.connected = true;
		};
		ws.onmessage = function (ev) {
			let m;
			try { m = JSON.parse(ev.data); } catch (e) { return; }
			if (net.viewer) {
				fromServerAsViewer(m);
				return;
			}
			if (m.t === 'room') {
				net.code = m.code;
				try { sessionStorage.setItem('llRoom', m.code); } catch (e) {}
			} else if (m.t === 'join') {
				if (net.onJoin) net.onJoin(m.id);
			} else if (m.t === 'leave') {
				closePeer(m.id);
				if (net.onLeave) net.onLeave(m.id);
			} else if (m.t === 'in') {
				fromPhone(m.id, m.m, null);
			} else if (m.t === 'viewers') {
				net.viewers = m.n;
			} else if (m.t === 'vin') {
				if (net.onViewerInput) net.onViewerInput(m.vid, m.id, m.m);
			} else if (m.t === 'vleave') {
				if (net.onViewerLeave) net.onViewerLeave(m.vid);
			}
		};
		ws.onclose = function () {
			net.connected = false;
			net.ws = null;
			retry++;
			setTimeout(connect, Math.min(5000, 500 * retry));
		};
	}

	function fromServerAsViewer(m) {
		if (m.t === 'snap') {
			if (net.onSnap) net.onSnap(m);
		} else if (m.t === 'viewing') {
			net.code = m.code;
			net.vid = m.vid;
			net.hostHere = m.host;
			net.noRoom = false;
		} else if (m.t === 'hostgone') {
			net.hostHere = false;
		} else if (m.t === 'hostback') {
			net.hostHere = true;
		} else if (m.t === 'noroom') {
			net.noRoom = true;
		} else if (m.t === 'buzz') {
			if (net.onViewerBuzz) net.onViewerBuzz(m.id, m.ms);
		}
	}

	function raw(obj) {
		if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj));
	}

	net.to = function (id, msg) {
		// rumbles go the fast way when there is one
		const peer = net.peers[id];
		if (msg.t === 'buzz' && peer && peer.dc && peer.dc.readyState === 'open') {
			peer.dc.send(JSON.stringify(msg));
			return;
		}
		raw({ t: 'to', id: id, m: msg });
	};
	net.all = function (msg) { raw({ t: 'all', m: msg }); };
	// host: a game snapshot for the viewer TVs, and messages for one viewer
	net.view = function (snap) { raw({ t: 'view', m: snap }); };
	net.toViewer = function (vid, msg) { raw({ t: 'tov', vid: vid, m: msg }); };
	// viewer: a controller on this TV joined, pressed something or left
	net.viewerSend = function (id, msg) { raw({ t: 'vin', id: id, m: msg }); };
	net.kick = function (id, why) { raw({ t: 'kick', id: id, why: why }); };
	net.start = connect;

	net.padUrl = function () {
		return location.origin + SU.BASE + 'pad.html?room=' + (net.code || '');
	};
})();
