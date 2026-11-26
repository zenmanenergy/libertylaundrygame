// Small QR code generator (byte mode, error correction level M).
// QR.make(text) returns a 2D array of booleans (true = dark).
// QR.draw(ctx, text, x, y, size) draws it with a white quiet zone.
(function () {
	const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
	const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
	const FORMAT_BITS_M = 0;

	function getBit(x, i) {
		return ((x >>> i) & 1) !== 0;
	}

	function numRawDataModules(ver) {
		let result = (16 * ver + 128) * ver + 64;
		if (ver >= 2) {
			const numAlign = Math.floor(ver / 7) + 2;
			result -= (25 * numAlign - 10) * numAlign - 55;
			if (ver >= 7) result -= 36;
		}
		return result;
	}

	function numDataCodewords(ver) {
		return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];
	}

	function gfMul(x, y) {
		let z = 0;
		for (let i = 7; i >= 0; i--) {
			z = (z << 1) ^ ((z >>> 7) * 0x11D);
			z ^= ((y >>> i) & 1) * x;
		}
		return z & 0xFF;
	}

	function rsDivisor(degree) {
		const result = [];
		for (let i = 0; i < degree - 1; i++) result.push(0);
		result.push(1);
		let root = 1;
		for (let i = 0; i < degree; i++) {
			for (let j = 0; j < result.length; j++) {
				result[j] = gfMul(result[j], root);
				if (j + 1 < result.length) result[j] ^= result[j + 1];
			}
			root = gfMul(root, 0x02);
		}
		return result;
	}

	function rsRemainder(data, divisor) {
		const result = divisor.map(function () { return 0; });
		data.forEach(function (b) {
			const factor = b ^ result.shift();
			result.push(0);
			divisor.forEach(function (coef, i) { result[i] ^= gfMul(coef, factor); });
		});
		return result;
	}

	function alignPositions(ver) {
		if (ver === 1) return [];
		const size = ver * 4 + 17;
		const numAlign = Math.floor(ver / 7) + 2;
		const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
		const result = [6];
		for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
		return result;
	}

	function make(text) {
		const bytes = Array.from(new TextEncoder().encode(text));
		let ver = 1;
		for (; ver <= 20; ver++) {
			const ccBits = ver < 10 ? 8 : 16;
			if (4 + ccBits + bytes.length * 8 <= numDataCodewords(ver) * 8) break;
		}
		if (ver > 20) throw new Error('QR text too long');
		const size = ver * 4 + 17;

		// ---- data bits ----
		const bits = [];
		function append(val, len) {
			for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
		}
		append(4, 4);
		append(bytes.length, ver < 10 ? 8 : 16);
		bytes.forEach(function (b) { append(b, 8); });
		const capacity = numDataCodewords(ver) * 8;
		append(0, Math.min(4, capacity - bits.length));
		append(0, (8 - bits.length % 8) % 8);
		for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
		const data = [];
		for (let i = 0; i < bits.length; i += 8) {
			let v = 0;
			for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
			data.push(v);
		}

		// ---- error correction and interleaving ----
		const numBlocks = NUM_BLOCKS_M[ver];
		const blockEccLen = ECC_PER_BLOCK_M[ver];
		const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
		const numShortBlocks = numBlocks - rawCodewords % numBlocks;
		const shortBlockLen = Math.floor(rawCodewords / numBlocks);
		const divisor = rsDivisor(blockEccLen);
		const blocks = [];
		for (let i = 0, k = 0; i < numBlocks; i++) {
			const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
			k += dat.length;
			const ecc = rsRemainder(dat, divisor);
			if (i < numShortBlocks) dat.push(0);
			blocks.push(dat.concat(ecc));
		}
		const codewords = [];
		for (let i = 0; i < blocks[0].length; i++) {
			blocks.forEach(function (block, j) {
				if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i]);
			});
		}

		// ---- matrix ----
		const modules = [];
		const isFn = [];
		for (let y = 0; y < size; y++) {
			modules.push(new Array(size).fill(false));
			isFn.push(new Array(size).fill(false));
		}
		function setFn(x, y, dark) {
			modules[y][x] = dark;
			isFn[y][x] = true;
		}
		for (let i = 0; i < size; i++) {
			setFn(6, i, i % 2 === 0);
			setFn(i, 6, i % 2 === 0);
		}
		[[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
			for (let dy = -4; dy <= 4; dy++) {
				for (let dx = -4; dx <= 4; dx++) {
					const dist = Math.max(Math.abs(dx), Math.abs(dy));
					const xx = c[0] + dx;
					const yy = c[1] + dy;
					if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
				}
			}
		});
		const al = alignPositions(ver);
		for (let i = 0; i < al.length; i++) {
			for (let j = 0; j < al.length; j++) {
				if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
				for (let dy = -2; dy <= 2; dy++) {
					for (let dx = -2; dx <= 2; dx++) {
						setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
					}
				}
			}
		}
		function drawFormat(mask) {
			const d = (FORMAT_BITS_M << 3) | mask;
			let rem = d;
			for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
			const fb = ((d << 10) | rem) ^ 0x5412;
			for (let i = 0; i <= 5; i++) setFn(8, i, getBit(fb, i));
			setFn(8, 7, getBit(fb, 6));
			setFn(8, 8, getBit(fb, 7));
			setFn(7, 8, getBit(fb, 8));
			for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(fb, i));
			for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(fb, i));
			for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(fb, i));
			setFn(8, size - 8, true);
		}
		drawFormat(0);
		if (ver >= 7) {
			let rem = ver;
			for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
			const vb = (ver << 12) | rem;
			for (let i = 0; i < 18; i++) {
				const bit = getBit(vb, i);
				const a = size - 11 + i % 3;
				const b = Math.floor(i / 3);
				setFn(a, b, bit);
				setFn(b, a, bit);
			}
		}

		// zigzag data placement
		let bi = 0;
		for (let right = size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (let vert = 0; vert < size; vert++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? size - 1 - vert : vert;
					if (!isFn[y][x] && bi < codewords.length * 8) {
						modules[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7));
						bi++;
					}
				}
			}
		}

		// ---- masks ----
		function maskHit(m, x, y) {
			switch (m) {
				case 0: return (x + y) % 2 === 0;
				case 1: return y % 2 === 0;
				case 2: return x % 3 === 0;
				case 3: return (x + y) % 3 === 0;
				case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
				case 5: return (x * y) % 2 + (x * y) % 3 === 0;
				case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
				default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
			}
		}
		function applyMask(m) {
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					if (!isFn[y][x] && maskHit(m, x, y)) modules[y][x] = !modules[y][x];
				}
			}
		}
		function penalty() {
			let p = 0;
			let dark = 0;
			for (let y = 0; y < size; y++) {
				let runR = 1;
				let runC = 1;
				for (let x = 0; x < size; x++) {
					if (modules[y][x]) dark++;
					if (x > 0) {
						if (modules[y][x] === modules[y][x - 1]) {
							runR++;
							if (runR === 5) p += 3;
							else if (runR > 5) p++;
						} else runR = 1;
						if (modules[x][y] === modules[x - 1][y]) {
							runC++;
							if (runC === 5) p += 3;
							else if (runC > 5) p++;
						} else runC = 1;
					}
					if (x > 0 && y > 0) {
						const c = modules[y][x];
						if (c === modules[y][x - 1] && c === modules[y - 1][x] && c === modules[y - 1][x - 1]) p += 3;
					}
				}
			}
			const total = size * size;
			p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
			return p;
		}
		let best = 0;
		let bestP = Infinity;
		for (let m = 0; m < 8; m++) {
			applyMask(m);
			drawFormat(m);
			const p = penalty();
			if (p < bestP) {
				bestP = p;
				best = m;
			}
			applyMask(m);
		}
		applyMask(best);
		drawFormat(best);
		return modules;
	}

	function draw(ctx, text, x, y, size) {
		const m = make(text);
		const n = m.length + 8;
		const cell = Math.floor(size / n);
		const total = cell * n;
		const ox = Math.round(x + (size - total) / 2);
		const oy = Math.round(y + (size - total) / 2);
		ctx.fillStyle = '#fff';
		ctx.fillRect(ox, oy, total, total);
		ctx.fillStyle = '#000';
		for (let r = 0; r < m.length; r++) {
			for (let c = 0; c < m.length; c++) {
				if (m[r][c]) ctx.fillRect(ox + (c + 4) * cell, oy + (r + 4) * cell, cell, cell);
			}
		}
	}

	window.QR = { make: make, draw: draw };
})();
