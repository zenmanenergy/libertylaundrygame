// Placeholder sound effects made with the Web Audio API (no files).
// To use real sounds later, put an .mp3 at assets/sounds/<name>.mp3
// (jump, blow, trap, pop, splat, treat, hurt, clear, hurry, join, start)
// and it plays instead of the beep.
(function () {
	const SU = window.SU = window.SU || {};
	let ac = null;
	let master = null;
	const files = {};
	const NAMES = ['jump', 'blow', 'trap', 'pop', 'splat', 'treat', 'hurt', 'clear', 'hurry', 'join', 'start'];

	SU.audioStart = function () {
		if (ac) {
			if (ac.state === 'suspended') ac.resume();
			return;
		}
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		ac = new AC();
		master = ac.createGain();
		master.gain.value = 0.35;
		master.connect(ac.destination);
		NAMES.forEach(function (n) {
			fetch('assets/sounds/' + n + '.mp3').then(function (r) {
				if (!r.ok) throw new Error('none');
				return r.arrayBuffer();
			}).then(function (buf) {
				return ac.decodeAudioData(buf);
			}).then(function (decoded) {
				files[n] = decoded;
			}).catch(function () {});
		});
	};

	SU.audioReady = function () {
		return !!ac && ac.state === 'running';
	};

	function tone(type, f0, f1, dur, vol, delay) {
		const t = ac.currentTime + (delay || 0);
		const o = ac.createOscillator();
		const g = ac.createGain();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + dur);
		o.connect(g);
		g.connect(master);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	SU.sfx = function (name, extra) {
		if (!ac || ac.state !== 'running') return;
		if (files[name]) {
			const src = ac.createBufferSource();
			src.buffer = files[name];
			src.connect(master);
			src.start();
			return;
		}
		switch (name) {
			case 'jump': tone('square', 300, 600, 0.12, 0.25); break;
			case 'blow': tone('sine', 500, 900, 0.1, 0.35); break;
			case 'trap': tone('triangle', 900, 400, 0.18, 0.4); break;
			case 'pop': tone('sine', 1200 + (extra || 0) * 150, 300, 0.08, 0.45); break;
			case 'splat': tone('sawtooth', 220, 60, 0.3, 0.3); break;
			case 'treat': tone('square', 900, 900, 0.06, 0.2); tone('square', 1350, 1350, 0.1, 0.2, 0.06); break;
			case 'hurt': tone('sawtooth', 600, 80, 0.6, 0.35); break;
			case 'hurry': tone('square', 700, 700, 0.1, 0.3); tone('square', 700, 700, 0.1, 0.3, 0.18); tone('square', 700, 700, 0.1, 0.3, 0.36); break;
			case 'join': tone('triangle', 500, 1000, 0.15, 0.35); break;
			case 'start':
			case 'clear':
				[523, 659, 784, 1046].forEach(function (f, i) { tone('triangle', f, f, 0.16, 0.35, i * 0.11); });
				break;
		}
	};
})();
