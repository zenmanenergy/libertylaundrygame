// Art list. Drop a PNG at the path shown and the game uses it the next
// time the page loads. Anything missing is drawn as a placeholder.
//
// Every sprite is a horizontal strip: frames side by side, each frame
// w x h pixels, facing RIGHT (the game mirrors it for left).
// The game world is 1024 x 576 with 32 x 32 tiles, so a 32 x 32 sprite
// fills one tile. Bigger art works too: set w and h to the frame size and
// set size to how big it should appear in the world.
//
// Player art: p1_* is used for player 1. If p2_*, p3_* or p4_* is missing,
// the game reuses p1_* with a color shift, so one character is enough.
(function () {
	const SU = window.SU = window.SU || {};

	function S(file, frames, fps, w, h, size) {
		return { file: file, frames: frames, fps: fps, w: w || 32, h: h || 32, size: size || 32 };
	}

	SU.SPRITES = {
		// players (one set per player slot, p1 is required, others optional)
		p1_idle: S('assets/sprites/p1_idle.png', 2, 3),
		p1_walk: S('assets/sprites/p1_walk.png', 4, 10),
		p1_jump: S('assets/sprites/p1_jump.png', 1, 1),
		p1_fall: S('assets/sprites/p1_fall.png', 1, 1),
		p1_blow: S('assets/sprites/p1_blow.png', 2, 12),
		p1_hurt: S('assets/sprites/p1_hurt.png', 4, 10),
		p2_idle: S('assets/sprites/p2_idle.png', 2, 3),
		p2_walk: S('assets/sprites/p2_walk.png', 4, 10),
		p2_jump: S('assets/sprites/p2_jump.png', 1, 1),
		p2_fall: S('assets/sprites/p2_fall.png', 1, 1),
		p2_blow: S('assets/sprites/p2_blow.png', 2, 12),
		p2_hurt: S('assets/sprites/p2_hurt.png', 4, 10),

		// enemies
		enemy_walk: S('assets/sprites/enemy_walk.png', 4, 8),
		enemy_angry: S('assets/sprites/enemy_angry.png', 4, 14),
		enemy_trapped: S('assets/sprites/enemy_trapped.png', 2, 4),
		enemy_flung: S('assets/sprites/enemy_flung.png', 4, 16),

		// bubbles and pickups
		bubble: S('assets/sprites/bubble.png', 1, 1),
		bubble_pop: S('assets/sprites/bubble_pop.png', 3, 20),
		treat: S('assets/sprites/treat.png', 1, 1),

		// level
		tile_wall: S('assets/tiles/wall.png', 1, 1),
		tile_platform: S('assets/tiles/platform.png', 1, 1),
		background: S('assets/backgrounds/level1.png', 1, 1, 1024, 576, 1024)
	};

	SU.images = {};

	SU.loadAssets = function (done) {
		const keys = Object.keys(SU.SPRITES);
		let left = keys.length;
		keys.forEach(function (k) {
			const img = new Image();
			img.onload = function () {
				SU.images[k] = img;
				if (--left === 0) done();
			};
			img.onerror = function () {
				if (--left === 0) done();
			};
			img.src = SU.SPRITES[k].file;
		});
	};

	SU.hasSprite = function (key) {
		return !!SU.images[key];
	};

	// Draws sprite `key` centered at (cx, bottom). Returns false if the
	// art is missing so the caller can draw a placeholder.
	SU.drawSprite = function (ctx, key, t, cx, bottom, flip, filter) {
		const img = SU.images[key];
		if (!img) return false;
		const s = SU.SPRITES[key];
		const frames = Math.max(1, Math.min(s.frames, Math.floor(img.width / s.w)));
		const f = Math.floor(t * s.fps) % frames;
		const dw = s.size;
		const dh = s.size * s.h / s.w;
		ctx.save();
		if (filter) ctx.filter = filter;
		ctx.translate(Math.round(cx), Math.round(bottom));
		if (flip) ctx.scale(-1, 1);
		ctx.drawImage(img, f * s.w, 0, s.w, s.h, -dw / 2, -dh, dw, dh);
		ctx.restore();
		return true;
	};
})();
