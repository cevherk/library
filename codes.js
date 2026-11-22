/**
 * Codes — dependency-free QR Code and Code 128 barcode generators that output SVG.
 *
 *   Codes.qrSvg(text, { margin })      QR Code (byte mode, error correction M, versions 1–10)
 *   Codes.code128Svg(text, { height }) Code 128 (subset C for even-length digits, otherwise B)
 *
 * The SVGs use a viewBox in module units, so they scale cleanly to any label size.
 */
(function (global) {
    'use strict';

    // ==================================================================
    // QR Code (ISO/IEC 18004)
    // ==================================================================

    // Galois field GF(2^8) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
    const EXP = new Uint8Array(512);
    const LOG = new Uint8Array(256);
    for (let i = 0, x = 1; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

    /** Reed–Solomon generator polynomial of the given degree (leading term omitted). */
    function rsGenerator(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < degree; j++) {
                result[j] = gfMul(result[j], root);
                if (j + 1 < degree) result[j] ^= result[j + 1];
            }
            root = gfMul(root, 0x02);
        }
        return result;
    }

    function rsRemainder(data, generator) {
        const result = new Array(generator.length).fill(0);
        for (const byte of data) {
            const factor = byte ^ result.shift();
            result.push(0);
            for (let i = 0; i < generator.length; i++) result[i] ^= gfMul(generator[i], factor);
        }
        return result;
    }

    // Error correction level M: [EC codewords per block, [[blockCount, dataCodewordsPerBlock], ...]]
    const QR_M = {
        1: [10, [[1, 16]]],
        2: [16, [[1, 28]]],
        3: [26, [[1, 44]]],
        4: [18, [[2, 32]]],
        5: [24, [[2, 43]]],
        6: [16, [[4, 27]]],
        7: [18, [[4, 31]]],
        8: [22, [[2, 38], [2, 39]]],
        9: [22, [[3, 36], [2, 37]]],
        10: [26, [[4, 43], [1, 44]]],
    };
    const ALIGN = {
        1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    };
    const dataCapacity = (v) => QR_M[v][1].reduce((sum, [count, len]) => sum + count * len, 0);
    const getBit = (x, i) => ((x >>> i) & 1) !== 0;

    function qrMatrix(text) {
        const bytes = Array.from(new TextEncoder().encode(text));

        // 1. Pick the smallest version that fits
        let version = 1;
        for (; version <= 10; version++) {
            const bits = 4 + (version < 10 ? 8 : 16) + bytes.length * 8;
            if (bits <= dataCapacity(version) * 8) break;
        }
        if (version > 10) throw new Error('QR: text too long');

        // 2. Bit stream: mode (byte), length, data, terminator, padding
        const capacityBits = dataCapacity(version) * 8;
        const bits = [];
        const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
        put(0b0100, 4);
        put(bytes.length, version < 10 ? 8 : 16);
        bytes.forEach((b) => put(b, 8));
        put(0, Math.min(4, capacityBits - bits.length));
        put(0, (8 - (bits.length % 8)) % 8);
        for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8);

        const data = new Array(capacityBits / 8).fill(0);
        bits.forEach((bit, i) => { data[i >>> 3] |= bit << (7 - (i & 7)); });

        // 3. Split into blocks, add error correction, interleave
        const [ecLen, groups] = QR_M[version];
        const generator = rsGenerator(ecLen);
        const blocks = [];
        let offset = 0;
        groups.forEach(([count, len]) => {
            for (let i = 0; i < count; i++) {
                const chunk = data.slice(offset, offset + len);
                offset += len;
                blocks.push({ data: chunk, ec: rsRemainder(chunk, generator) });
            }
        });
        const codewords = [];
        const maxData = Math.max(...blocks.map((b) => b.data.length));
        for (let i = 0; i < maxData; i++) blocks.forEach((b) => { if (i < b.data.length) codewords.push(b.data[i]); });
        for (let i = 0; i < ecLen; i++) blocks.forEach((b) => codewords.push(b.ec[i]));

        // 4. Matrix with function patterns
        const size = version * 4 + 17;
        const modules = Array.from({ length: size }, () => new Array(size).fill(false));
        const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
        const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };

        for (let i = 0; i < size; i++) {
            set(6, i, i % 2 === 0);
            set(i, 6, i % 2 === 0);
        }
        const finder = (cx, cy) => {
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || y < 0 || x >= size || y >= size) continue;
                    const dist = Math.max(Math.abs(dx), Math.abs(dy));
                    set(x, y, dist !== 2 && dist !== 4);
                }
            }
        };
        finder(3, 3);
        finder(size - 4, 3);
        finder(3, size - 4);

        const align = ALIGN[version];
        const last = align.length - 1;
        align.forEach((ay, i) => align.forEach((ax, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }));

        const drawFormat = (mask) => {
            const value = (0b00 << 3) | mask; // EC level M = 00
            let rem = value;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const f = ((value << 10) | rem) ^ 0x5412;
            for (let i = 0; i <= 5; i++) set(8, i, getBit(f, i));
            set(8, 7, getBit(f, 6));
            set(8, 8, getBit(f, 7));
            set(7, 8, getBit(f, 8));
            for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(f, i));
            for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(f, i));
            for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(f, i));
            set(8, size - 8, true); // dark module
        };
        drawFormat(0); // reserve the area

        if (version >= 7) {
            let rem = version;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const v = (version << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const a = size - 11 + (i % 3), b = Math.floor(i / 3);
                set(a, b, getBit(v, i));
                set(b, a, getBit(v, i));
            }
        }

        // 5. Place codewords in the zig-zag pattern
        let bitIndex = 0;
        const totalBits = codewords.length * 8;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? size - 1 - vert : vert;
                    if (reserved[y][x] || bitIndex >= totalBits) continue;
                    modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
                    bitIndex++;
                }
            }
        }

        // 6. Try all eight masks, keep the one with the lowest penalty
        const MASKS = [
            (x, y) => (x + y) % 2 === 0,
            (x, y) => y % 2 === 0,
            (x) => x % 3 === 0,
            (x, y) => (x + y) % 3 === 0,
            (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
            (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
            (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
            (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ];
        const applyMask = (m) => {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) if (!reserved[y][x] && MASKS[m](x, y)) modules[y][x] = !modules[y][x];
            }
        };
        const penalty = () => {
            let score = 0;
            // Rule 1: runs of 5+ same-colour modules in rows/columns
            for (let pass = 0; pass < 2; pass++) {
                for (let a = 0; a < size; a++) {
                    let run = 1;
                    for (let b = 1; b < size; b++) {
                        const cur = pass ? modules[b][a] : modules[a][b];
                        const prev = pass ? modules[b - 1][a] : modules[a][b - 1];
                        if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
                        else run = 1;
                    }
                }
            }
            // Rule 2: 2x2 blocks
            for (let y = 0; y < size - 1; y++) {
                for (let x = 0; x < size - 1; x++) {
                    const c = modules[y][x];
                    if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
                }
            }
            // Rule 3: finder-like patterns 1:1:3:1:1 with 4 light modules on a side
            const pattern = [true, false, true, true, true, false, true];
            for (let a = 0; a < size; a++) {
                for (let b = 0; b <= size - 7; b++) {
                    for (let pass = 0; pass < 2; pass++) {
                        const at = (k) => (pass ? modules[b + k][a] : modules[a][b + k]);
                        if (!pattern.every((p, k) => at(k) === p)) continue;
                        const lightBefore = b >= 4 && [1, 2, 3, 4].every((k) => (pass ? !modules[b - k][a] : !modules[a][b - k]));
                        const lightAfter = b + 11 <= size && [7, 8, 9, 10].every((k) => !at(k));
                        if (lightBefore || lightAfter) score += 40;
                    }
                }
            }
            // Rule 4: dark/light balance
            const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
            score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
            return score;
        };

        let bestMask = 0;
        let bestScore = Infinity;
        for (let m = 0; m < 8; m++) {
            applyMask(m);
            drawFormat(m);
            const s = penalty();
            if (s < bestScore) { bestScore = s; bestMask = m; }
            applyMask(m); // undo (XOR)
        }
        applyMask(bestMask);
        drawFormat(bestMask);
        return modules;
    }

    function qrSvg(text, { margin = 2, className = 'qr' } = {}) {
        const modules = qrMatrix(text);
        const size = modules.length;
        const total = size + margin * 2;
        let d = '';
        modules.forEach((row, y) => {
            let x = 0;
            while (x < size) {
                if (!row[x]) { x++; continue; }
                const start = x;
                while (x < size && row[x]) x++;
                d += `M${start + margin} ${y + margin}h${x - start}v1h${start - x}z`;
            }
        });
        return `<svg class="${className}" viewBox="0 0 ${total} ${total}" style="stroke:none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    }

    // ==================================================================
    // Code 128
    // ==================================================================
    const C128 = [
        '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
        '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
        '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
        '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
        '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
        '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
        '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
        '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
        '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
        '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
        '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
    ];
    const START_B = 104, START_C = 105, STOP = 106;

    function code128Values(text) {
        const s = String(text);
        if (/^\d+$/.test(s) && s.length % 2 === 0 && s.length >= 2) {
            const values = [START_C];
            for (let i = 0; i < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
            return values;
        }
        const values = [START_B];
        for (const ch of s) {
            const code = ch.charCodeAt(0);
            if (code < 32 || code > 126) throw new Error('Code 128B: unsupported character');
            values.push(code - 32);
        }
        return values;
    }

    function code128Svg(text, { height = 40, className = 'barcode', quiet = 10 } = {}) {
        const values = code128Values(text);
        const checksum = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
        values.push(checksum, STOP);

        let x = quiet;
        let d = '';
        values.forEach((v) => {
            const widths = C128[v];
            for (let i = 0; i < widths.length; i++) {
                const w = Number(widths[i]);
                if (i % 2 === 0) d += `M${x} 0h${w}v${height}h${-w}z`;
                x += w;
            }
        });
        const total = x + quiet;
        return `<svg class="${className}" viewBox="0 0 ${total} ${height}" style="stroke:none" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true"><rect width="${total}" height="${height}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    }

    global.Codes = { qrSvg, qrMatrix, code128Svg };
})(window);
