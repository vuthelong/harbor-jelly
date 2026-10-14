(function (root) {
  'use strict';
  const HC = root.HarborCore;
  const K = HC.K, L = HC.LAYOUT;

  const MAT = {
    MATTE: 0, GLASS: 1, STEEL: 2, TILE: 3, TIMBER: 4, CORRUG: 5, MASONRY: 6, RUBBER: 7, ROCK: 8, LAMP: 9,
    WEED: 10, HULL: 11, TERRAIN: 12, STRATA: 13, PAPER: 14, ASPHALT: 15, COBBLE: 16, CONTAINER: 17,
    CONCRETE: 18, PILE: 19, FOLIAGE: 20, SLATE: 21, SAIL: 22, JELLY: 23, RING: 24, FISH: 25, GULL: 26, PAINT: 27,
  };
  const OBJ = {
    WORLD: 0, SHIP: 1, RADAR: 2, SHIP_PROP: 3, TUG: 4, TUG_PROP: 5,
    GANTRY: [6, 10], BOOM: [7, 11], TROLLEY: [8, 12], SPREADER: [9, 13],
    LAMP: 14, YACHT: [15, 16], MBUOY: [17, 18], GBUOY: 19, FBOAT: [20, 21], LIFEBUOY: [22, 23, 24], TOWHOOK: 25,
    BACKDROP: 31,
  };
  const STRIDE = 24;

  function hex(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }

  class MB {
    constructor(cap) {
      this.cap = cap || 4096;
      this.buf = new ArrayBuffer(this.cap * STRIDE);
      this.f32 = new Float32Array(this.buf); this.i8 = new Int8Array(this.buf); this.u8 = new Uint8Array(this.buf);
      this.n = 0;
      this.stack = [];
      this.m = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
      this.col = [255, 255, 255]; this.mat = 0; this.obj = 0; this.extra = 0; this.extra2 = 0;
    }
    grow() {
      const nb = new ArrayBuffer(this.cap * 2 * STRIDE);
      new Uint8Array(nb).set(this.u8);
      this.cap *= 2; this.buf = nb;
      this.f32 = new Float32Array(nb); this.i8 = new Int8Array(nb); this.u8 = new Uint8Array(nb);
    }
    push() { this.stack.push({ m: this.m.slice(), col: this.col, mat: this.mat, obj: this.obj, extra: this.extra, extra2: this.extra2 }); return this; }
    pop() { const s = this.stack.pop(); Object.assign(this, s); return this; }
    mulM(r, t) {
      const m = this.m;
      const nm = new Array(12);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nm[i * 3 + j] = m[i * 3] * r[j] + m[i * 3 + 1] * r[3 + j] + m[i * 3 + 2] * r[6 + j];
      for (let i = 0; i < 3; i++) nm[9 + i] = m[i * 3] * t[0] + m[i * 3 + 1] * t[1] + m[i * 3 + 2] * t[2] + m[9 + i];
      this.m = nm; return this;
    }
    translate(x, y, z) { return this.mulM([1, 0, 0, 0, 1, 0, 0, 0, 1], [x, y, z]); }
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return this.mulM([c, 0, s, 0, 1, 0, -s, 0, c], [0, 0, 0]); }
    rotX(a) { const c = Math.cos(a), s = Math.sin(a); return this.mulM([1, 0, 0, 0, c, -s, 0, s, c], [0, 0, 0]); }
    rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return this.mulM([c, -s, 0, s, c, 0, 0, 0, 1], [0, 0, 0]); }
    scale(s) { return this.mulM([s, 0, 0, 0, s, 0, 0, 0, s], [0, 0, 0]); }
    heading(psi) { return this.rotY(-psi); }
    c(h) { this.col = typeof h === 'number' ? hex(h) : h; return this; }
    set(mat, extra) { this.mat = mat; if (extra != null) this.extra = extra; return this; }
    o(obj) { this.obj = obj; return this; }
    xp(p) {
      const m = this.m;
      return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[9], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + m[10], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + m[11]];
    }
    xn(n) {
      const m = this.m;
      const r = [m[0] * n[0] + m[1] * n[1] + m[2] * n[2], m[3] * n[0] + m[4] * n[1] + m[5] * n[2], m[6] * n[0] + m[7] * n[1] + m[8] * n[2]];
      const l = Math.hypot(r[0], r[1], r[2]) || 1;
      return [r[0] / l, r[1] / l, r[2] / l];
    }
    rawVert(p, n, col, mat, obj, extra, extra2) {
      if (this.n >= this.cap) this.grow();
      const o = this.n * STRIDE;
      const f = o >> 2;
      this.f32[f] = p[0]; this.f32[f + 1] = p[1]; this.f32[f + 2] = p[2];
      this.i8[o + 12] = Math.round(n[0] * 127); this.i8[o + 13] = Math.round(n[1] * 127); this.i8[o + 14] = Math.round(n[2] * 127); this.i8[o + 15] = 0;
      this.u8[o + 16] = col[0]; this.u8[o + 17] = col[1]; this.u8[o + 18] = col[2]; this.u8[o + 19] = 255;
      this.u8[o + 20] = mat; this.u8[o + 21] = obj; this.u8[o + 22] = extra; this.u8[o + 23] = extra2;
      this.n++;
    }
    vert(p, n, col, extra) {
      this.rawVert(this.xp(p), this.xn(n), col || this.col, this.mat, this.obj, extra == null ? this.extra : extra, this.extra2);
    }
    tri(a, b, c, col) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n[0] /= l; n[1] /= l; n[2] /= l;
      this.vert(a, n, col); this.vert(b, n, col); this.vert(c, n, col);
      return this;
    }
    triN(a, b, c, na, nb, nc, col) { this.vert(a, na, col); this.vert(b, nb, col); this.vert(c, nc, col); return this; }
    quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); return this; }
    box(cx, cy, cz, hx, hy, hz, opt) {
      opt = opt || {};
      const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
      const col = opt.col;
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opt.top || col);
      if (!opt.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], opt.front || col);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], opt.back || col);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], opt.side || col);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], opt.side || col);
      return this;
    }
    boxAB(x0, y0, z0, x1, y1, z1, opt) { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, opt); }
    cyl(cx, cy, cz, r, h, seg, opt) {
      opt = opt || {};
      const r2 = opt.r2 == null ? r : opt.r2;
      const slope = (r - r2) / h;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const n0 = [c0, slope, s0], n1 = [c1, slope, s1];
        const p00 = [cx + c0 * r, cy, cz + s0 * r], p10 = [cx + c1 * r, cy, cz + s1 * r];
        const p01 = [cx + c0 * r2, cy + h, cz + s0 * r2], p11 = [cx + c1 * r2, cy + h, cz + s1 * r2];
        const col = opt.colFn ? opt.colFn(i) : undefined;
        this.triN(p00, p11, p10, n0, n1, n1, col);
        this.triN(p00, p01, p11, n0, n0, n1, col);
        if (opt.cap !== false && r2 > 0) this.triN([cx, cy + h, cz], p11, p01, [0, 1, 0], [0, 1, 0], [0, 1, 0], opt.capCol || col);
        if (opt.bottom) this.triN([cx, cy, cz], p00, p10, [0, -1, 0], [0, -1, 0], [0, -1, 0], col);
      }
      return this;
    }
    sphere(cx, cy, cz, r, seg, rings, opt) {
      opt = opt || {};
      const sy = opt.sy || 1, sx = opt.sx || 1, sz = opt.sz || 1;
      const pt = (i, j) => {
        const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        const p = [cx + n[0] * r * sx, cy + n[1] * r * sy, cz + n[2] * r * sz];
        const nn = [n[0] / sx, n[1] / sy, n[2] / sz];
        const l = Math.hypot(nn[0], nn[1], nn[2]);
        return [p, [nn[0] / l, nn[1] / l, nn[2] / l]];
      };
      const j0 = opt.half ? 0 : 0, j1 = opt.half ? rings / 2 : rings;
      for (let j = j0; j < j1; j++) {
        for (let i = 0; i < seg; i++) {
          const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
          const col = opt.colFn ? opt.colFn(a[0], j) : undefined;
          if (j > 0) this.triN(a[0], b[0], c[0], a[1], b[1], c[1], col);
          if (j < rings - 1) this.triN(a[0], c[0], d[0], a[1], c[1], d[1], col);
        }
      }
      return this;
    }
    torus(cx, cy, cz, R, r, su, sv, colFn) {
      for (let i = 0; i < su; i++) {
        for (let j = 0; j < sv; j++) {
          const P = (a, b) => {
            const u = (a / su) * Math.PI * 2, v = (b / sv) * Math.PI * 2;
            const n = [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
            return [[cx + Math.cos(u) * (R + r * Math.cos(v)), cy + r * Math.sin(v), cz + Math.sin(u) * (R + r * Math.cos(v))], n];
          };
          const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
          const col = colFn ? colFn(i) : undefined;
          this.triN(a[0], c[0], b[0], a[1], c[1], b[1], col);
          this.triN(a[0], d[0], c[0], a[1], d[1], c[1], col);
        }
      }
      return this;
    }
    beam(p0, p1, t, opt) {
      const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      const yaw = Math.atan2(d[0], d[2]);
      const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      this.push().translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2).rotY(yaw).rotX(-pitch);
      this.box(0, 0, 0, t, t, len / 2, opt);
      return this.pop();
    }
    rock(cx, cy, cz, r, seed, squash) {
      const rnd = HC.mulberry32(seed);
      const t = (1 + Math.sqrt(5)) / 2;
      let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
      const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      V = V.map(v => { const l = Math.hypot(v[0], v[1], v[2]); const k = 1 + (rnd() - 0.5) * 0.55; return [v[0] / l * k * (1 + (rnd() - 0.5) * 0.3), v[1] / l * k * (squash || 0.7), v[2] / l * k]; });
      const yaw = rnd() * 6.28;
      this.push().translate(cx, cy, cz).rotY(yaw).scale(r);
      for (const f of F) this.tri(V[f[0]], V[f[1]], V[f[2]]);
      return this.pop();
    }
    finish() { return { data: new Uint8Array(this.buf, 0, this.n * STRIDE).slice(), count: this.n }; }
  }

  function cables(mb, list, thick) {
    for (const cb of list) {
      const a = cb.a, b = cb.b;
      const t = cb.t || thick;
      const offs = [[t, 0, t], [-t, 0, t], [-t, 0, -t], [t, 0, -t]];
      const sideN = [[1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1]].map(n => [n[0] * 0.7, 0, n[2] * 0.7]);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const A0 = [a[0] + offs[i][0], a[1], a[2] + offs[i][2]], A1 = [a[0] + offs[j][0], a[1], a[2] + offs[j][2]];
        const B0 = [b[0] + offs[i][0], b[1], b[2] + offs[i][2]], B1 = [b[0] + offs[j][0], b[1], b[2] + offs[j][2]];
        const n0 = sideN[i], n1 = sideN[j];
        mb.rawVert(A0, n0, mb.col, MAT.STEEL, cb.oa, 0, 0); mb.rawVert(B0, n0, mb.col, MAT.STEEL, cb.ob, 0, 0); mb.rawVert(B1, n1, mb.col, MAT.STEEL, cb.ob, 0, 0);
        mb.rawVert(A0, n0, mb.col, MAT.STEEL, cb.oa, 0, 0); mb.rawVert(B1, n1, mb.col, MAT.STEEL, cb.ob, 0, 0); mb.rawVert(A1, n1, mb.col, MAT.STEEL, cb.oa, 0, 0);
      }
      const offs2 = [[t, t, 0], [-t, t, 0], [-t, -t, 0], [t, -t, 0]];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const A0 = [a[0] + offs2[i][0], a[1] + offs2[i][1], a[2]], A1 = [a[0] + offs2[j][0], a[1] + offs2[j][1], a[2]];
        const B0 = [b[0] + offs2[i][0], b[1] + offs2[i][1], b[2]], B1 = [b[0] + offs2[j][0], b[1] + offs2[j][1], b[2]];
        const n0 = [offs2[i][0] / t * 0.7, offs2[i][1] / t * 0.7, 0], n1 = [offs2[j][0] / t * 0.7, offs2[j][1] / t * 0.7, 0];
        mb.rawVert(A0, n0, mb.col, MAT.STEEL, cb.oa, 0, 0); mb.rawVert(B0, n0, mb.col, MAT.STEEL, cb.ob, 0, 0); mb.rawVert(B1, n1, mb.col, MAT.STEEL, cb.ob, 0, 0);
        mb.rawVert(A0, n0, mb.col, MAT.STEEL, cb.oa, 0, 0); mb.rawVert(B1, n1, mb.col, MAT.STEEL, cb.ob, 0, 0); mb.rawVert(A1, n1, mb.col, MAT.STEEL, cb.oa, 0, 0);
      }
    }
  }

  function hullLoft(mb, o) {
    const N = o.stations || 18, S = o.sect || 7;
    const sec = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = -o.half + 2 * o.half * u;
      let b = o.beam / 2;
      const bowStart = o.bowStart;
      if (x > bowStart) { const t = (x - bowStart) / (o.half - bowStart); b *= Math.sqrt(Math.max(0, 1 - t * t)) * 0.97 + 0.03 * (1 - t); }
      const sternT = clamp01((-o.half + o.sternLen - x) / o.sternLen);
      const deck = o.deck + (x > bowStart ? Math.pow((x - bowStart) / (o.half - bowStart), 2) * o.sheer : 0) + (x < -o.half + 0.1 ? 0 : 0);
      const keel = -o.draft * (1 - 0.5 * Math.pow(sternT, 1.5)) * (x > bowStart ? 1 - 0.25 * Math.pow((x - bowStart) / (o.half - bowStart), 3) : 1);
      const pts = [];
      for (let k = 0; k <= S; k++) {
        const ph = (k / S) * Math.PI / 2;
        const ex = 2 / o.n;
        const z = b * Math.pow(Math.cos(ph), ex) * (1 - 0.15 * sternT * Math.sin(ph));
        const y = deck - (deck - keel) * Math.pow(Math.sin(ph), ex);
        pts.push([x, y, z]);
      }
      sec.push(pts);
    }
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < S; k++) {
          const a = sec[i][k], b = sec[i + 1][k], c = sec[i + 1][k + 1], d = sec[i][k + 1];
          const A = [a[0], a[1], a[2] * side], B = [b[0], b[1], b[2] * side], C = [c[0], c[1], c[2] * side], D = [d[0], d[1], d[2] * side];
          const col = o.colFn ? o.colFn(k, a[1]) : undefined;
          if (side > 0) mb.quad(A, D, C, B, col); else mb.quad(A, B, C, D, col);
        }
      }
    }
    const deckCol = o.deckCol;
    for (let i = 0; i < N; i++) {
      const a = sec[i][0], b = sec[i + 1][0];
      mb.quad([a[0], a[1], -a[2]], [a[0], a[1], a[2]], [b[0], b[1], b[2]], [b[0], b[1], -b[2]], deckCol);
    }
    const st = sec[0];
    for (let k = 0; k < S; k++) {
      mb.quad([st[k][0], st[k][1], -st[k][2]], [st[k + 1][0], st[k + 1][1], -st[k + 1][2]], [st[k + 1][0], st[k + 1][1], st[k + 1][2]], [st[k][0], st[k][1], st[k][2]], o.transomCol);
    }
    return sec;
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function buildShip(mb) {
    const S = HC.SHIP;
    mb.push().o(OBJ.SHIP);
    mb.set(MAT.HULL, 123).c(0x1f2b4a);
    hullLoft(mb, { half: S.half, beam: S.B, draft: S.draft, deck: S.deckY, bowStart: 0.36, sheer: 0.035, sternLen: 0.12, n: 5, deckCol: hex(0x8a3b2e), transomCol: hex(0x1f2b4a) });
    mb.set(MAT.MATTE, 0);
    for (let b = 0; b < 6; b++) mb.c(0x6d7178).box(-0.342 + 0.155 * b, S.deckY + 0.0075, 0, 0.074, 0.0075, 0.135);
    mb.c(0x1f2b4a).boxAB(0.51, S.deckY, -0.11, 0.56, S.deckY + 0.06, 0.11);
    mb.c(0x8a3b2e).boxAB(0.56, S.deckY + 0.025, -0.09, 0.66, S.deckY + 0.032, 0.09);
    mb.c(0x26282c).cyl(S.bollard, S.deckY + 0.032, 0, 0.008, 0.016, 8);
    mb.c(0xf3f1ea).set(MAT.MATTE);
    mb.boxAB(-0.705, S.deckY, -0.13, -0.47, 0.2, 0.13);
    mb.boxAB(-0.69, 0.2, -0.12, -0.49, 0.28, 0.12);
    mb.boxAB(-0.66, 0.28, -0.125, -0.5, 0.345, 0.125);
    mb.boxAB(-0.56, 0.31, -0.185, -0.5, 0.33, 0.185);
    mb.c(0xe9e6dc).boxAB(-0.67, 0.345, -0.13, -0.49, 0.352, 0.13);
    mb.set(MAT.GLASS).c(0x22303c);
    mb.boxAB(-0.501, 0.3, -0.12, -0.496, 0.335, 0.12);
    for (const y of [0.13, 0.17, 0.235]) mb.boxAB(-0.473, y, -0.1, -0.468, y + 0.018, 0.1);
    for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) mb.boxAB(-0.68 + i * 0.05, 0.22, sz * 0.122 - 0.002, -0.66 + i * 0.05, 0.245, sz * 0.122 + 0.002);
    mb.set(MAT.MATTE).c(0x1f2b4a).boxAB(-0.69, 0.352, -0.035, -0.62, 0.45, 0.035);
    mb.c(0xf2c230).boxAB(-0.692, 0.4, -0.037, -0.618, 0.42, 0.037);
    mb.c(0x15161a).boxAB(-0.688, 0.45, -0.032, -0.622, 0.458, 0.032);
    mb.c(0xd9d6cc).cyl(-0.55, 0.352, 0, 0.005, 0.09, 6);
    mb.c(0xe0672d).set(MAT.PAINT);
    for (const sz of [-1, 1]) mb.push().translate(-0.6, 0.215, sz * 0.145).rotZ(Math.PI / 2).cyl(0, -0.04, 0, 0.012, 0.08, 8).pop();
    mb.set(MAT.MATTE).c(0x8a3b2e).boxAB(-0.735, -0.1, -0.004, -0.705, -0.02, 0.004);
    mb.c(0xdedad0).cyl(0.62, S.deckY + 0.03, 0, 0.004, 0.13, 6);
    mb.pop();

    mb.push().o(OBJ.RADAR).set(MAT.STEEL).c(0xe8e6df);
    mb.boxAB(-0.035, 0.0, -0.004, 0.035, 0.006, 0.004);
    mb.c(0x2b2c30).cyl(0, -0.01, 0, 0.004, 0.01, 6);
    mb.pop();

    mb.push().o(OBJ.SHIP_PROP).set(MAT.STEEL).c(0xc9a34a);
    mb.push().rotZ(Math.PI / 2).cyl(0, -0.008, 0, 0.007, 0.016, 8).pop();
    for (let i = 0; i < 4; i++) {
      mb.push().rotX((i / 4) * Math.PI * 2);
      mb.quad([0.004, 0.004, -0.007], [-0.004, 0.004, 0.007], [-0.004, 0.035, 0.009], [0.004, 0.035, -0.005]);
      mb.quad([0.004, 0.035, -0.005], [-0.004, 0.035, 0.009], [-0.004, 0.004, 0.007], [0.004, 0.004, -0.007]);
      mb.pop();
    }
    mb.pop();
  }

  function buildTug(mb) {
    const T = HC.TUG;
    mb.push().o(OBJ.TUG);
    mb.set(MAT.HULL, 108).c(0x16171a);
    hullLoft(mb, { half: T.half, beam: T.B, draft: T.draft, deck: 0.035, bowStart: 0.02, sheer: 0.02, sternLen: 0.05, n: 2.6, deckCol: hex(0x5a2a24), transomCol: hex(0x16171a), stations: 14, sect: 6 });
    mb.set(MAT.RUBBER, 0).c(0x1b1b1d);
    const ring = [];
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const x = -T.half + 0.01 + (2 * T.half - 0.03) * u;
      let b = T.B / 2;
      if (x > 0.02) { const t = (x - 0.02) / (T.half - 0.02); b *= Math.sqrt(Math.max(0, 1 - t * t)) * 0.97 + 0.03; }
      ring.push([x, b]);
    }
    for (const side of [1, -1]) for (let i = 0; i < ring.length; i += 2) {
      const [x, b] = ring[i];
      mb.push().translate(x, 0.025, side * (b + 0.004)).rotX(Math.PI / 2).torus(0, 0, 0, 0.009, 0.0045, 8, 5).pop();
    }
    for (let k = -2; k <= 2; k++) mb.push().translate(-T.half + 0.002, 0.025, k * 0.022).rotZ(Math.PI / 2).torus(0, 0, 0, 0.009, 0.0045, 8, 5).pop();
    mb.cyl(T.half - 0.004, -0.012, 0, 0.022, 0.05, 12, { r2: 0.024 });
    mb.set(MAT.MATTE).c(0xf3f1ea);
    mb.boxAB(-0.06, 0.035, -0.045, 0.08, 0.085, 0.045);
    mb.boxAB(0.0, 0.085, -0.04, 0.075, 0.125, 0.04);
    mb.c(0xc8372d).boxAB(-0.002, 0.125, -0.043, 0.077, 0.133, 0.043);
    mb.c(0xc8372d).boxAB(-0.062, 0.035, -0.047, 0.082, 0.045, 0.047);
    mb.set(MAT.GLASS).c(0x22303c);
    mb.boxAB(0.075, 0.098, -0.035, 0.078, 0.118, 0.035);
    for (const sz of [-1, 1]) mb.boxAB(0.01, 0.098, sz * 0.0405 - 0.001, 0.065, 0.118, sz * 0.0405 + 0.001);
    mb.set(MAT.MATTE).c(0xc8372d).boxAB(-0.05, 0.085, -0.018, -0.02, 0.15, 0.018);
    mb.c(0x15161a).boxAB(-0.051, 0.15, -0.019, -0.019, 0.16, 0.019);
    mb.c(0xe9e6dc).cyl(0.04, 0.133, 0, 0.003, 0.07, 5);
    mb.c(0x2b2c30).cyl(T.hook, 0.035, 0, 0.006, 0.02, 6);
    mb.pop();
    mb.push().o(OBJ.TUG_PROP).set(MAT.STEEL).c(0xc9a34a);
    for (let i = 0; i < 4; i++) {
      mb.push().rotX((i / 4) * Math.PI * 2);
      mb.quad([0.003, 0.002, -0.004], [-0.003, 0.002, 0.004], [-0.003, 0.02, 0.005], [0.003, 0.02, -0.003]);
      mb.quad([0.003, 0.02, -0.003], [-0.003, 0.02, 0.005], [-0.003, 0.002, 0.004], [0.003, 0.002, -0.004]);
      mb.pop();
    }
    mb.pop();
  }

  function buildCrane(mb, k, color, cab) {
    const g = OBJ.GANTRY[k], bm = OBJ.BOOM[k], tr = OBJ.TROLLEY[k], sp = OBJ.SPREADER[k];
    const Y0 = K.LAND_Y, BY = K.BOOM_Y;
    mb.push().o(g).set(MAT.PAINT).c(color);
    const lh = K.LEG_HALF;
    for (const sx of [-lh, lh]) for (const z of [K.RAIL_W, K.RAIL_L]) {
      mb.boxAB(sx - 0.011, Y0 + 0.03, z - 0.011, sx + 0.011, BY, z + 0.011);
      mb.set(MAT.STEEL).c(0x3a3c40).boxAB(sx - 0.04, Y0 + 0.003, z - 0.014, sx + 0.04, Y0 + 0.03, z + 0.014).set(MAT.PAINT).c(color);
    }
    for (const z of [K.RAIL_W, K.RAIL_L]) mb.boxAB(-lh - 0.011, 0.5, z - 0.012, lh + 0.011, 0.53, z + 0.012);
    for (const sx of [-lh, lh]) {
      mb.boxAB(sx - 0.01, 0.5, K.RAIL_L, sx + 0.01, 0.525, K.RAIL_W);
      mb.beam([sx, Y0 + 0.08, K.RAIL_W], [sx, 0.5, K.RAIL_L], 0.005);
    }
    for (const sx of [-0.05, 0.05]) {
      mb.boxAB(sx - 0.009, BY, -1.4, sx + 0.009, BY + 0.04, K.HINGE_Z);
      mb.beam([sx, BY + 0.04, K.HINGE_Z], [sx * 0.6, 1.0, -0.94], 0.008);
      mb.beam([sx, BY + 0.04, -1.13], [sx * 0.6, 1.0, -0.94], 0.008);
    }
    for (const sx of [-lh, lh]) for (const z of [K.RAIL_W, K.RAIL_L]) mb.beam([sx, BY, z], [Math.sign(sx) * 0.05, BY + 0.01, z], 0.008);
    mb.boxAB(-0.04, 0.99, -0.955, 0.04, 1.02, -0.925);
    mb.c(0xf1efe8).set(MAT.CORRUG).boxAB(-0.075, BY + 0.04, -1.41, 0.075, BY + 0.11, -1.24);
    mb.set(MAT.PAINT).c(color);
    mb.c(0x3a3c40).set(MAT.STEEL);
    mb.boxAB(-0.06, BY + 0.11, -1.4, 0.06, BY + 0.115, -1.25);
    mb.pop();

    mb.push().o(bm).set(MAT.PAINT).c(color);
    for (const sx of [-0.05, 0.05]) {
      mb.boxAB(sx - 0.009, -0.02, 0, sx + 0.009, 0.02, 0.52);
      for (let i = 0; i < 6; i++) mb.beam([sx, 0.02, i * 0.085], [sx, -0.02, i * 0.085 + 0.0425], 0.003);
    }
    for (let i = 0; i < 4; i++) mb.boxAB(-0.05, 0.016, 0.03 + i * 0.16, 0.05, 0.022, 0.04 + i * 0.16);
    mb.c(0xe0b030).set(MAT.LAMP, 60).boxAB(-0.012, 0.02, 0.505, 0.012, 0.03, 0.52);
    mb.pop();

    mb.push().o(tr).set(MAT.PAINT).c(0x3b3d42);
    mb.boxAB(-0.07, 0.0, -0.035, 0.07, 0.035, 0.035);
    mb.set(MAT.MATTE).c(0xf1efe8).boxAB(0.065, -0.08, -0.002, 0.105, -0.025, 0.04);
    mb.set(MAT.GLASS).c(0x28394a).boxAB(0.066, -0.075, 0.039, 0.104, -0.035, 0.042);
    mb.set(MAT.PAINT).c(0x3b3d42).boxAB(0.07, -0.025, 0.0, 0.1, 0.0, 0.03);
    mb.pop();

    mb.push().o(sp).set(MAT.PAINT).c(0xf2c230);
    mb.boxAB(-0.074, 0.0, -0.006, 0.074, 0.012, 0.006);
    mb.boxAB(-0.074, 0.0, -0.03, -0.066, 0.012, 0.03);
    mb.boxAB(0.066, 0.0, -0.03, 0.074, 0.012, 0.03);
    mb.boxAB(-0.02, 0.012, -0.012, 0.02, 0.022, 0.012);
    mb.pop();

    const c = [];
    for (const sx of [-0.03, 0.03]) for (const sz of [-0.02, 0.02]) c.push({ oa: tr, a: [sx, 0, sz], ob: sp, b: [sx * 0.6, 0.022, sz * 0.5] });
    for (const sx of [-0.05, 0.05]) {
      c.push({ oa: g, a: [sx * 0.6, 1.0, -0.94], ob: bm, b: [sx, 0.02, 0.26] });
      c.push({ oa: g, a: [sx * 0.6, 1.0, -0.94], ob: bm, b: [sx, 0.02, 0.5] });
      c.push({ oa: g, a: [sx * 0.6, 1.0, -0.94], ob: g, b: [sx, BY + 0.11, -1.4], t: 0.003 });
    }
    mb.push().c(0x2a2b2e);
    cables(mb, c, 0.0016);
    mb.pop();
  }

  function weedTuft(mb, x, y, z, h, n, seed, col) {
    const rnd = HC.mulberry32(seed);
    mb.push().set(MAT.WEED).c(col || 0x4f7a3a);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, r = rnd() * 0.012;
      const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
      const hh = h * (0.6 + rnd() * 0.6);
      const w = 0.003 + rnd() * 0.002;
      const ox = Math.cos(a + 1.57) * w, oz = Math.sin(a + 1.57) * w;
      const lean = (rnd() - 0.5) * 0.02;
      const segs = 3;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const w0 = 1 - t0 * 0.8, w1 = 1 - t1 * 0.8;
        const p0 = [bx + lean * t0, y + hh * t0, bz], p1 = [bx + lean * t1, y + hh * t1, bz];
        const e0 = Math.round(t0 * 255), e1 = Math.round(t1 * 255);
        const n = [Math.cos(a), 0.2, Math.sin(a)];
        const A = [p0[0] - ox * w0, p0[1], p0[2] - oz * w0], B = [p0[0] + ox * w0, p0[1], p0[2] + oz * w0];
        const C = [p1[0] + ox * w1, p1[1], p1[2] + oz * w1], D = [p1[0] - ox * w1, p1[1], p1[2] - oz * w1];
        mb.vert(A, n, undefined, e0); mb.vert(B, n, undefined, e0); mb.vert(C, n, undefined, e1);
        mb.vert(A, n, undefined, e0); mb.vert(C, n, undefined, e1); mb.vert(D, n, undefined, e1);
        const m = [-n[0], 0.2, -n[2]];
        mb.vert(A, m, undefined, e0); mb.vert(C, m, undefined, e1); mb.vert(B, m, undefined, e0);
        mb.vert(A, m, undefined, e0); mb.vert(D, m, undefined, e1); mb.vert(C, m, undefined, e1);
      }
    }
    mb.pop();
  }

  const PERCHES = [];
  function house(mb, x, z, w, d, h, wall, roof, slate, rnd, gableFront) {
    const by = HC.landH(x, z + d / 2) - 0.04;
    const ty = HC.landH(x, z + d / 2) + h;
    mb.push().set(MAT.MATTE).c(wall);
    mb.boxAB(x - w / 2, by, z - d / 2, x + w / 2, ty, z + d / 2);
    const rh = gableFront ? w * 0.45 : d * 0.55;
    mb.set(slate ? MAT.SLATE : MAT.TILE).c(roof);
    const o = 0.012;
    if (!gableFront) {
      const x0 = x - w / 2 - o, x1 = x + w / 2 + o, z0 = z - d / 2 - o, z1 = z + d / 2 + o;
      mb.quad([x0, ty, z1], [x1, ty, z1], [x1, ty + rh, z], [x0, ty + rh, z]);
      mb.quad([x1, ty, z0], [x0, ty, z0], [x0, ty + rh, z], [x1, ty + rh, z]);
      mb.quad([x0, ty - 0.004, z1], [x0, ty + rh, z], [x1, ty + rh, z], [x1, ty - 0.004, z1]);
      mb.set(MAT.MATTE).c(wall);
      mb.tri([x - w / 2, ty, z + d / 2], [x - w / 2, ty + rh - 0.01, z], [x - w / 2, ty, z - d / 2]);
      mb.tri([x + w / 2, ty, z - d / 2], [x + w / 2, ty + rh - 0.01, z], [x + w / 2, ty, z + d / 2]);
    } else {
      const x0 = x - w / 2 - o, x1 = x + w / 2 + o, z0 = z - d / 2 - o, z1 = z + d / 2 + o;
      mb.quad([x0, ty, z0], [x0, ty, z1], [x, ty + rh, z1], [x, ty + rh, z0]);
      mb.quad([x1, ty, z1], [x1, ty, z0], [x, ty + rh, z0], [x, ty + rh, z1]);
      mb.set(MAT.MATTE).c(wall);
      mb.tri([x - w / 2, ty, z + d / 2], [x + w / 2, ty, z + d / 2], [x, ty + rh - 0.01, z + d / 2]);
      mb.tri([x + w / 2, ty, z - d / 2], [x - w / 2, ty, z - d / 2], [x, ty + rh - 0.01, z - d / 2]);
    }
    if (rnd() < 0.5) PERCHES.push({ p: gableFront ? [x, ty + rh, z + (rnd() - 0.5) * d * 0.6] : [x + (rnd() - 0.5) * w * 0.6, ty + rh, z], yaw: gableFront ? Math.PI / 2 : 0, kind: 'roof' });
    const fy = HC.landH(x, z + d / 2);
    const fz = z + d / 2;
    const nWin = Math.max(2, Math.round(w / 0.06));
    for (let i = 0; i < nWin; i++) {
      const wx = x - w / 2 + (i + 0.5) * (w / nWin);
      for (const wy of h > 0.11 ? [fy + 0.03, fy + 0.085] : [fy + 0.045]) {
        if (wy === fy + 0.03 && i === Math.floor(nWin / 2)) continue;
        mb.set(MAT.MATTE).c(0xf7f5ee).boxAB(wx - 0.013, wy - 0.017, fz, wx + 0.013, wy + 0.017, fz + 0.003);
        mb.set(MAT.GLASS).c(0x2a3440).boxAB(wx - 0.009, wy - 0.013, fz + 0.002, wx + 0.009, wy + 0.013, fz + 0.004);
        mb.set(MAT.MATTE).c(0xf7f5ee).boxAB(wx - 0.0012, wy - 0.013, fz + 0.003, wx + 0.0012, wy + 0.013, fz + 0.0045);
      }
    }
    const dx = x - w / 2 + (Math.floor(nWin / 2) + 0.5) * (w / nWin);
    if (h > 0.11) {
      mb.set(MAT.MATTE).c(0xf7f5ee).boxAB(dx - 0.014, fy - 0.01, fz, dx + 0.014, fy + 0.05, fz + 0.003);
      mb.c(rnd() < 0.5 ? 0x2e4d3b : 0x3b4a66).boxAB(dx - 0.01, fy - 0.01, fz + 0.002, dx + 0.01, fy + 0.046, fz + 0.005);
    }
    const cx = x + (rnd() - 0.5) * w * 0.5, cz = z + (rnd() - 0.5) * d * 0.3;
    mb.set(MAT.MASONRY).c(0x8e6e5a).boxAB(cx - 0.011, ty + rh * 0.4, cz - 0.011, cx + 0.011, ty + rh + 0.03, cz + 0.011);
    mb.set(MAT.MATTE).c(0x3a3434).boxAB(cx - 0.013, ty + rh + 0.03, cz - 0.013, cx + 0.013, ty + rh + 0.036, cz + 0.013);
    mb.pop();
  }

  function tree(mb, x, z, r, rnd) {
    const y = HC.landH(x, z);
    mb.push().set(MAT.TIMBER).c(0x6b4a32).cyl(x, y - 0.02, z, 0.006, r * 1.1 + 0.02, 5);
    mb.set(MAT.FOLIAGE).c(rnd() < 0.5 ? 0x5f8f4a : 0x6f9a52).sphere(x, y + r * 1.1 + r * 0.8, z, r, 10, 7, { sy: 1.05 });
    mb.pop();
  }

  function church(mb, x, z) {
    const y = HC.landH(x, z + 0.12);
    mb.push().set(MAT.MATTE).c(0xf6f3ea);
    const ty = y + 0.17;
    mb.boxAB(x - 0.08, y - 0.05, z - 0.18, x + 0.08, ty, z + 0.1);
    mb.set(MAT.SLATE).c(0x4a4f57);
    mb.quad([x - 0.095, ty, z - 0.19], [x - 0.095, ty, z + 0.1], [x, ty + 0.09, z + 0.1], [x, ty + 0.09, z - 0.19]);
    mb.quad([x + 0.095, ty, z + 0.1], [x + 0.095, ty, z - 0.19], [x, ty + 0.09, z - 0.19], [x, ty + 0.09, z + 0.1]);
    mb.set(MAT.MATTE).c(0xf6f3ea);
    mb.tri([x - 0.08, ty, z - 0.18], [x + 0.08, ty, z - 0.18], [x, ty + 0.085, z - 0.18]);
    const tz = z + 0.15;
    mb.boxAB(x - 0.05, y - 0.05, tz - 0.05, x + 0.05, y + 0.32, tz + 0.05);
    mb.set(MAT.GLASS).c(0x2a3440);
    for (let i = 0; i < 3; i++) mb.boxAB(x - 0.07 + i * 0.07 - 0.012, y + 0.06, z + 0.1, x - 0.07 + i * 0.07 + 0.012, y + 0.13, z + 0.103);
    mb.boxAB(x - 0.012, y + 0.22, tz + 0.05, x + 0.012, y + 0.27, tz + 0.053);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) mb.boxAB(x + sx * 0.081 - 0.002, y + 0.06, z - 0.15 + i * 0.065, x + sx * 0.081 + 0.002, y + 0.13, z - 0.12 + i * 0.065);
    mb.set(MAT.MATTE).c(0x5a3a2a).boxAB(x - 0.016, y - 0.01, tz + 0.05, x + 0.016, y + 0.07, tz + 0.054);
    mb.set(MAT.PAINT).c(0x5fae94);
    const sy = y + 0.32;
    const s = 0.055;
    mb.tri([x - s, sy, tz + s], [x + s, sy, tz + s], [x, sy + 0.3, tz]);
    mb.tri([x + s, sy, tz + s], [x + s, sy, tz - s], [x, sy + 0.3, tz]);
    mb.tri([x + s, sy, tz - s], [x - s, sy, tz - s], [x, sy + 0.3, tz]);
    mb.tri([x - s, sy, tz - s], [x - s, sy, tz + s], [x, sy + 0.3, tz]);
    PERCHES.push({ p: [x, sy + 0.302, tz], yaw: 0.3, kind: 'spire' });
    mb.set(MAT.STEEL).c(0xc9a34a).cyl(x, sy + 0.29, tz, 0.002, 0.05, 4);
    mb.boxAB(x - 0.012, sy + 0.325, tz - 0.0015, x + 0.012, sy + 0.329, tz + 0.0015);
    mb.pop();
  }

  function town(mb, rnd) {
    const walls = [0x8f2b20, 0xc9963a, 0xf2efe6, 0x9fbcd4, 0xa8d8bf, 0xe8b4b0, 0x8f2b20, 0xf2efe6];
    const roofsTile = [0x9c4a32, 0xa85a3c, 0x7e3a2a];
    const roofsSlate = [0x4b5059, 0x3f444c, 0x5a5f66];
    const rows = [-1.97, -2.22, -2.46];
    rows.forEach((rz, ri) => {
      let x = -2.48 + rnd() * 0.06 + ri * 0.05;
      while (x < 2.45) {
        const w = 0.16 + rnd() * 0.1;
        if (x + w > 2.5) break;
        const cx = x + w / 2;
        if (ri === 1 && Math.abs(cx - 0.05) < 0.17) { x += 0.1; continue; }
        if (rnd() < 0.12) { tree(mb, cx, rz + (rnd() - 0.5) * 0.06, 0.045 + rnd() * 0.02, rnd); x += 0.1; continue; }
        const slate = rnd() < 0.4;
        house(mb, cx, rz, w, 0.15 + rnd() * 0.03, 0.1 + rnd() * 0.06, walls[Math.floor(rnd() * walls.length)],
          slate ? roofsSlate[Math.floor(rnd() * 3)] : roofsTile[Math.floor(rnd() * 3)], slate, rnd, rnd() < 0.35);
        x += w + 0.035 + rnd() * 0.05;
      }
    });
    church(mb, 0.05, -2.3);
    for (let i = 0; i < 26; i++) {
      const x = -2.5 + rnd() * 5.0, z = -1.84 - rnd() * 0.72;
      if (rows.some(r => Math.abs(z - r) < 0.1)) continue;
      tree(mb, x, z, 0.03 + rnd() * 0.03, rnd);
    }
  }

  function terminal(mb, rnd) {
    const Y = K.LAND_Y + 0.001;
    mb.push().set(MAT.ASPHALT).c(0x4a4b4f);
    mb.quad([-2.6, Y, -0.7], [0.6, Y, -0.7], [0.6, Y, -1.8], [-2.6, Y, -1.8]);
    mb.set(MAT.CONCRETE).c(0xbab6ad);
    for (const z of [K.RAIL_W, K.RAIL_L]) mb.quad([-2.6, Y + 0.0005, z + 0.04], [0.6, Y + 0.0005, z + 0.04], [0.6, Y + 0.0005, z - 0.04], [-2.6, Y + 0.0005, z - 0.04]);
    mb.set(MAT.MATTE).c(0xf2efe6);
    for (const z of [-1.415, -1.485, -1.555, -1.625, -1.695, -1.765]) mb.quad([-2.52, Y + 0.0008, z + 0.002], [0.1, Y + 0.0008, z + 0.002], [0.1, Y + 0.0008, z - 0.002], [-2.52, Y + 0.0008, z - 0.002]);
    mb.c(0xf2c230);
    for (const z of [-1.145, -1.355]) mb.quad([-2.55, Y + 0.0008, z + 0.002], [0.5, Y + 0.0008, z + 0.002], [0.5, Y + 0.0008, z - 0.002], [-2.55, Y + 0.0008, z - 0.002]);
    for (let x = -2.4; x < 0.5; x += 0.155) mb.quad([x - 0.002, Y + 0.0008, -1.15], [x + 0.002, Y + 0.0008, -1.15], [x + 0.002, Y + 0.0008, -1.35], [x - 0.002, Y + 0.0008, -1.35]);
    mb.set(MAT.STEEL).c(0x55585e);
    for (const z of [K.RAIL_W, K.RAIL_L]) for (const dz of [-0.014, 0.014]) mb.boxAB(-2.6, Y, z + dz - 0.002, 0.6, Y + 0.005, z + dz + 0.002);
    for (const x of [-2.45, -1.0, 0.47]) {
      PERCHES.push({ p: [x + 0.02, K.LAND_Y + 0.736, -1.77], yaw: 1.2, kind: 'tower' });
      mb.set(MAT.STEEL).c(0x9a9da2).cyl(x, K.LAND_Y, -1.77, 0.008, 0.72, 6);
      mb.boxAB(x - 0.04, K.LAND_Y + 0.72, -1.775, x + 0.04, K.LAND_Y + 0.735, -1.765);
      mb.set(MAT.LAMP, 200).c(0xfff3d0);
      for (let i = 0; i < 4; i++) mb.boxAB(x - 0.035 + i * 0.02, K.LAND_Y + 0.705, -1.764, x - 0.025 + i * 0.02, K.LAND_Y + 0.72, -1.758);
    }
    mb.set(MAT.MATTE).c(0xeeece6).boxAB(0.14, K.LAND_Y, -1.72, 0.5, K.LAND_Y + 0.15, -1.45);
    mb.c(0x2f62b5).boxAB(0.135, K.LAND_Y + 0.15, -1.725, 0.505, K.LAND_Y + 0.16, -1.445);
    mb.set(MAT.GLASS).c(0x2a3a4c);
    for (const y of [0.03, 0.09]) mb.boxAB(0.16, K.LAND_Y + y, -1.452, 0.48, K.LAND_Y + y + 0.035, -1.447);
    mb.set(MAT.MATTE).c(0x3a3c40).boxAB(0.3, K.LAND_Y + 0.16, -1.6, 0.36, K.LAND_Y + 0.19, -1.54);
    mb.pop();
  }

  function quayWall(mb, rnd) {
    mb.push();
    mb.set(MAT.CONCRETE).c(0xb8b3a8);
    mb.boxAB(-2.6, K.SEABED - 0.06, -0.73, K.SPLIT_X, K.LAND_Y, -0.7, { noBottom: true });
    mb.c(0xc9c4b8).boxAB(-2.6, K.LAND_Y - 0.02, -0.705, K.SPLIT_X, K.LAND_Y + 0.004, -0.695);
    mb.set(MAT.MASONRY).c(0xa9a092);
    mb.boxAB(K.SPLIT_X, K.SEABED - 0.06, -0.73, 2.6, K.LAND_Y, -0.7, { noBottom: true });
    mb.set(MAT.MASONRY).c(0xbfb4a0).boxAB(K.SPLIT_X, K.LAND_Y - 0.015, -0.71, 2.6, K.LAND_Y + 0.006, -0.695);
    mb.set(MAT.RUBBER).c(0x1d1d1f);
    for (let x = -2.45; x < K.SPLIT_X - 0.05; x += 0.2) mb.boxAB(x - 0.014, -0.06, -0.7, x + 0.014, K.LAND_Y - 0.025, K.FENDER_Z);
    for (let x = 0.75; x < 2.55; x += 0.22) if (Math.abs(x - 1.9) > 0.12) mb.push().translate(x, -0.0, -0.69).rotZ(Math.PI / 2).cyl(0, -0.03, 0, 0.012, 0.06, 8).pop();
    mb.set(MAT.STEEL).c(0x2b2c30);
    for (let x = -2.35; x < 2.5; x += 0.3) {
      if (Math.abs(x - 1.9) < 0.12) continue;
      mb.cyl(x, K.LAND_Y, -0.72, 0.009, 0.018, 8, { r2: 0.008 });
      mb.cyl(x, K.LAND_Y + 0.018, -0.72, 0.012, 0.004, 8);
    }
    mb.c(0x9b9ea3);
    for (const x of [-1.95, -0.25, 1.25, 2.4]) {
      for (const dx of [-0.012, 0.012]) mb.boxAB(x + dx - 0.0015, -0.35, -0.699, x + dx + 0.0015, K.LAND_Y + 0.03, -0.694);
      for (let y = -0.33; y < K.LAND_Y; y += 0.025) mb.boxAB(x - 0.012, y, -0.698, x + 0.012, y + 0.003, -0.694);
    }
    mb.pop();
    for (let i = 0; i < 70; i++) {
      const x = -2.55 + rnd() * 5.1;
      if (Math.abs(x - 1.9) < 0.1) continue;
      weedTuft(mb, x, K.SEABED + 0.01, -0.69 + rnd() * 0.02, 0.06 + rnd() * 0.06, 3, 900 + i, rnd() < 0.5 ? 0x4f7a3a : 0x6e7f2e);
    }
  }

  function fishingQuay(mb, rnd) {
    const Y = K.LAND_Y + 0.001;
    mb.push().set(MAT.COBBLE).c(0xa59c8d);
    mb.quad([K.SPLIT_X, Y, -0.7], [2.6, Y, -0.7], [2.6, Y, -1.02], [K.SPLIT_X, Y, -1.02]);
    mb.set(MAT.CONCRETE).c(0x9e9688);
    mb.quad([K.SPLIT_X, Y, -1.02], [2.6, Y, -1.02], [2.6, Y, -1.8], [K.SPLIT_X, Y, -1.8]);
    const x0 = 1.0, x1 = 1.72, z0 = -1.48, z1 = -1.12, h = 0.13;
    mb.set(MAT.CORRUG).c(0x6f9fa0).boxAB(x0, K.LAND_Y, z0, x1, K.LAND_Y + h, z1);
    mb.set(MAT.CORRUG).c(0xb9bcbf);
    const ty = K.LAND_Y + h, rh = 0.08, o = 0.015;
    mb.quad([x0 - o, ty, z1 + o], [x1 + o, ty, z1 + o], [x1 + o, ty + rh, (z0 + z1) / 2], [x0 - o, ty + rh, (z0 + z1) / 2]);
    mb.quad([x1 + o, ty, z0 - o], [x0 - o, ty, z0 - o], [x0 - o, ty + rh, (z0 + z1) / 2], [x1 + o, ty + rh, (z0 + z1) / 2]);
    mb.set(MAT.CORRUG).c(0x6f9fa0);
    mb.tri([x0, ty, z1], [x0, ty + rh - 0.005, (z0 + z1) / 2], [x0, ty, z0]);
    mb.tri([x1, ty, z0], [x1, ty + rh - 0.005, (z0 + z1) / 2], [x1, ty, z1]);
    mb.set(MAT.MATTE).c(0x2d4f63);
    for (let i = 0; i < 4; i++) mb.boxAB(x0 + 0.06 + i * 0.17, K.LAND_Y, z1, x0 + 0.15 + i * 0.17, K.LAND_Y + 0.09, z1 + 0.004);
    mb.c(0xf2efe6).boxAB(x0 + 0.1, K.LAND_Y + 0.1, z1, x1 - 0.1, K.LAND_Y + 0.122, z1 + 0.004);
    mb.c(0xc8372d);
    for (let i = 0; i < 6; i++) mb.boxAB(x0 + 0.13 + i * 0.075, K.LAND_Y + 0.104, z1 + 0.004, x0 + 0.17 + i * 0.075, K.LAND_Y + 0.118, z1 + 0.006);
    for (const x of [0.72, 1.12, 1.55, 2.25, 2.5]) {
      PERCHES.push({ p: [x, K.LAND_Y + 0.173, -0.77], yaw: Math.PI / 2, kind: 'lamp' });
      mb.set(MAT.PAINT).c(0x2c4a3e).cyl(x, K.LAND_Y, -0.78, 0.0045, 0.17, 6);
      mb.boxAB(x - 0.002, K.LAND_Y + 0.165, -0.78, x + 0.002, K.LAND_Y + 0.17, -0.76);
      mb.set(MAT.LAMP, 255).c(0xffe2a0).sphere(x, K.LAND_Y + 0.158, -0.76, 0.009, 8, 6);
      mb.set(MAT.PAINT).c(0x2c4a3e).cyl(x, K.LAND_Y + 0.166, -0.76, 0.011, 0.006, 8, { r2: 0.003 });
    }
    mb.set(MAT.TIMBER).c(0x7a5a3c);
    for (const x of [0.9, 1.35, 2.15]) {
      mb.boxAB(x - 0.04, K.LAND_Y + 0.02, -0.92, x + 0.04, K.LAND_Y + 0.026, -0.9);
      mb.boxAB(x - 0.04, K.LAND_Y + 0.026, -0.905, x + 0.04, K.LAND_Y + 0.05, -0.9);
      mb.boxAB(x - 0.035, K.LAND_Y, -0.915, x - 0.03, K.LAND_Y + 0.02, -0.905);
      mb.boxAB(x + 0.03, K.LAND_Y, -0.915, x + 0.035, K.LAND_Y + 0.02, -0.905);
    }
    mb.set(MAT.PAINT);
    const crateCols = [0x2f62b5, 0xc8372d, 0xe0a33a];
    for (let i = 0; i < 9; i++) {
      const x = 1.78 + (i % 3) * 0.03 + rnd() * 0.01, z = -1.2 - Math.floor(i / 3) * 0.03;
      mb.c(crateCols[i % 3]).boxAB(x, K.LAND_Y, z, x + 0.025, K.LAND_Y + 0.016 + (i % 2) * 0.016, z + 0.025);
    }
    mb.pop();
  }

  function pier(mb, rnd) {
    const P = L.pier;
    mb.push().set(MAT.TIMBER).c(0x8b6a48);
    const dy = 0.09;
    for (let z = P.z0; z < P.z1; z += 0.022) mb.boxAB(P.x0, dy, z + 0.001, P.x1, dy + 0.012, Math.min(P.z1, z + 0.021), { col: hex(rnd() < 0.5 ? 0x8b6a48 : 0x806040) });
    mb.c(0x6e5236);
    for (const x of [P.x0 + 0.01, P.x1 - 0.01]) mb.boxAB(x - 0.005, dy - 0.02, P.z0, x + 0.005, dy, P.z1);
    const zs = [];
    for (let z = P.z0 + 0.08; z <= P.z1 - 0.005; z += 0.13) zs.push(z);
    zs.push(P.z1 - 0.01);
    for (const z of zs) {
      for (const x of [P.x0 + 0.012, P.x1 - 0.012]) {
        const base = HC.seabedH(x, z) - 0.02;
        mb.set(MAT.PILE).c(0x6e5236).cyl(x, base, z, 0.011, dy - base, 8);
      }
      mb.set(MAT.TIMBER).c(0x6e5236);
      mb.beam([P.x0 + 0.012, -0.25, z], [P.x1 - 0.012, 0.06, z], 0.003);
      mb.beam([P.x1 - 0.012, -0.25, z], [P.x0 + 0.012, 0.06, z], 0.003);
    }
    for (let i = 0; i < zs.length - 1; i++) for (const x of [P.x0 + 0.012, P.x1 - 0.012]) {
      mb.set(MAT.PILE).c(0x6e5236);
      mb.beam([x, -0.32, zs[i]], [x, 0.05, zs[i + 1]], 0.003);
      mb.beam([x, 0.05, zs[i]], [x, -0.32, zs[i + 1]], 0.003);
    }
    mb.set(MAT.TIMBER).c(0x6e5236);
    for (const z of [P.z0 + 0.25, P.z0 + 0.6, P.z1 - 0.02]) for (const x of [P.x0 + 0.004, P.x1 - 0.004]) {
      mb.cyl(x, dy + 0.012, z, 0.006, 0.02, 6);
    }
    mb.set(MAT.STEEL).c(0x9b9ea3);
    for (const x of [P.x0 + 0.002, P.x1 - 0.002]) for (let z = P.z0 + 0.02; z < P.z1; z += 0.1) mb.boxAB(x - 0.001, dy + 0.012, z, x + 0.001, dy + 0.05, z + 0.003);
    mb.pop();
  }

  function breakwater(mb, rnd) {
    const a = L.breakwater.a, b = L.breakwater.b;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
    const seaSide = nz > 0 ? 1 : -1;
    mb.push();
    let seed = 500;
    for (let i = 0; i < 260; i++) {
      const t = rnd() * 1.08 - 0.02;
      const off = (rnd() * 2 - 1);
      const d = off * 0.5;
      const big = Math.abs(d) < 0.16;
      let x = a[0] + dx * Math.min(t, 1) + nx * d, z = a[1] + dz * Math.min(t, 1) + nz * d;
      if (t > 1) { const ang = rnd() * 6.28; const rr = Math.abs(d); x = b[0] + Math.cos(ang) * rr; z = b[1] + Math.sin(ang) * rr; }
      if (x > 2.58 || z > 2.58 || z < -0.69) continue;
      const r = big ? 0.045 + rnd() * 0.035 : 0.022 + rnd() * 0.025;
      const y = HC.seabedH(x, z);
      if (y < K.SEABED + 0.02 && rnd() < 0.6) continue;
      const tone = 0.75 + rnd() * 0.25;
      const base = big ? [150, 146, 138] : [118, 116, 104];
      mb.set(MAT.ROCK).c([base[0] * tone | 0, base[1] * tone | 0, base[2] * tone | 0]);
      mb.rock(x, y + r * 0.3, z, r, seed++, 0.75);
      if (!big && y < -0.04 && rnd() < 0.5) weedTuft(mb, x, y + r * 0.4, z, 0.04 + rnd() * 0.05, 3, seed++, rnd() < 0.5 ? 0x5c8a3e : 0x7a6a2e);
    }
    mb.set(MAT.CONCRETE).c(0xc2bdb2);
    const N = 10;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N - 0.004;
      const p0 = [a[0] + dx * t0 + nx * 0.045 * seaSide, a[1] + dz * t0 + nz * 0.045 * seaSide];
      const p1 = [a[0] + dx * t1 + nx * 0.045 * seaSide, a[1] + dz * t1 + nz * 0.045 * seaSide];
      mb.push().translate((p0[0] + p1[0]) / 2, 0, (p0[1] + p1[1]) / 2).rotY(Math.atan2(tx, tz));
      mb.boxAB(-0.022, 0.06, -len / N / 2, 0.022, 0.2, len / N / 2);
      mb.pop();
    }
    mb.c(0xb3ada2);
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N - 0.004;
      const p0 = [a[0] + dx * t0 - nx * 0.02 * seaSide, a[1] + dz * t0 - nz * 0.02 * seaSide];
      const p1 = [a[0] + dx * t1 - nx * 0.02 * seaSide, a[1] + dz * t1 - nz * 0.02 * seaSide];
      mb.push().translate((p0[0] + p1[0]) / 2, 0, (p0[1] + p1[1]) / 2).rotY(Math.atan2(tx, tz));
      mb.boxAB(-0.045, 0.04, -len / N / 2, 0.045, 0.125, len / N / 2);
      mb.pop();
    }
    const [lx, lz] = L.lighthouse;
    mb.set(MAT.CONCRETE).c(0xc9c4b8).cyl(lx, 0.02, lz, 0.09, 0.11, 18);
    mb.set(MAT.PAINT);
    const bands = 6, h0 = 0.13, h1 = 0.62;
    for (let i = 0; i < bands; i++) {
      const y0 = h0 + (h1 - h0) * i / bands, y1 = h0 + (h1 - h0) * (i + 1) / bands;
      const r0 = 0.055 - 0.015 * i / bands, r1 = 0.055 - 0.015 * (i + 1) / bands;
      mb.c(i % 2 ? 0xf4f2ec : 0xc8372d).cyl(lx, y0, lz, r0, y1 - y0, 18, { r2: r1, cap: false });
    }
    mb.set(MAT.GLASS).c(0x2a3440);
    for (let i = 0; i < 3; i++) mb.boxAB(lx - 0.008, 0.25 + i * 0.12, lz + 0.046 - i * 0.004, lx + 0.008, 0.28 + i * 0.12, lz + 0.052 - i * 0.004);
    mb.set(MAT.PAINT).c(0x2b2c30).cyl(lx, h1, lz, 0.065, 0.008, 18);
    mb.set(MAT.STEEL).c(0x2b2c30);
    for (let i = 0; i < 16; i++) { const an = i / 16 * 6.283; mb.cyl(lx + Math.cos(an) * 0.062, h1 + 0.008, lz + Math.sin(an) * 0.062, 0.0012, 0.025, 3); }
    mb.torus(lx, h1 + 0.033, lz, 0.062, 0.0015, 24, 3);
    for (const an of [0.5, 2.3, 4.1]) PERCHES.push({ p: [lx + Math.cos(an) * 0.062, h1 + 0.035, lz + Math.sin(an) * 0.062], yaw: an + Math.PI, kind: 'gallery' });
    mb.set(MAT.GLASS).c(0x9fb6c0).cyl(lx, h1 + 0.008, lz, 0.036, 0.07, 14, { cap: false });
    mb.set(MAT.PAINT).c(0xc8372d).cyl(lx, h1 + 0.078, lz, 0.042, 0.04, 14, { r2: 0.004 });
    mb.c(0x2b2c30).cyl(lx, h1 + 0.115, lz, 0.002, 0.03, 4);
    mb.pop();
    mb.push().o(OBJ.LAMP).set(MAT.LAMP, 255).c(0xfff0c0);
    mb.box(0, 0, 0, 0.012, 0.016, 0.012);
    mb.c(0xfff7e0).boxAB(0.012, -0.012, -0.01, 0.03, 0.012, 0.01);
    mb.boxAB(-0.03, -0.012, -0.01, -0.012, 0.012, 0.01);
    mb.pop();
  }

  function seabed(mb, rnd) {
    for (let i = 0; i < 90; i++) {
      const x = -2.5 + rnd() * 5, z = -0.6 + rnd() * 3.1;
      const h = HC.seabedH(x, z);
      if (h > K.SEABED + 0.05) continue;
      if (rnd() < 0.55) weedTuft(mb, x, h, z, 0.05 + rnd() * 0.12, 4 + Math.floor(rnd() * 4), 2000 + i, rnd() < 0.6 ? 0x4f8a3a : 0x8a7a2e);
      else { mb.push().set(MAT.ROCK).c([120 + rnd() * 40 | 0, 116 + rnd() * 30 | 0, 104 + rnd() * 20 | 0]).rock(x, h + 0.005, z, 0.012 + rnd() * 0.02, 3000 + i, 0.6).pop(); }
    }
    mb.push().set(MAT.PAINT);
    for (let i = 0; i < 9; i++) {
      const x = -2.3 + rnd() * 4.4, z = -0.4 + rnd() * 2.8;
      const h = HC.seabedH(x, z) + 0.004;
      mb.c(rnd() < 0.5 ? 0xe0662f : 0xc84a5a);
      const r = 0.018 + rnd() * 0.01, rot = rnd() * 6.28;
      for (let k = 0; k < 5; k++) {
        const a = rot + k * 1.2566;
        const tip = [x + Math.cos(a) * r, h, z + Math.sin(a) * r];
        const l = [x + Math.cos(a - 0.5) * r * 0.25, h + 0.003, z + Math.sin(a - 0.5) * r * 0.25];
        const rr = [x + Math.cos(a + 0.5) * r * 0.25, h + 0.003, z + Math.sin(a + 0.5) * r * 0.25];
        mb.tri(l, [x, h + 0.005, z], rr).tri(l, rr, tip);
      }
    }
    mb.pop();
    const ax = -0.35, az = 1.05, ah = HC.seabedH(ax, az);
    mb.push().translate(ax, ah + 0.012, az).rotY(0.7).rotZ(1.35).set(MAT.STEEL).c(0x4a3a30);
    mb.boxAB(-0.004, -0.06, -0.004, 0.004, 0.06, 0.004);
    mb.boxAB(-0.03, 0.05, -0.003, 0.03, 0.056, 0.003);
    mb.beam([0, -0.06, 0], [0.035, -0.035, 0], 0.004);
    mb.beam([0, -0.06, 0], [-0.035, -0.035, 0], 0.004);
    mb.beam([0.035, -0.035, 0], [0.042, -0.02, 0], 0.005);
    mb.beam([-0.035, -0.035, 0], [-0.042, -0.02, 0], 0.005);
    mb.pop();
    mb.push().set(MAT.STEEL).c(0x4a3a30);
    let cx = ax - 0.03, cz = az + 0.04;
    for (let i = 0; i < 22; i++) {
      const a = 1.2 + Math.sin(i * 0.5) * 0.7;
      cx += Math.cos(a) * 0.011; cz += Math.sin(a) * 0.011;
      const ch = HC.seabedH(cx, cz) + 0.003;
      mb.push().translate(cx, ch, cz).rotY(-a).rotX(i % 2 ? Math.PI / 2 : 0).torus(0, 0, 0, 0.005, 0.0015, 8, 4).pop();
    }
    mb.pop();
    const tx = 0.85, tz = 1.95;
    mb.push().translate(tx, HC.seabedH(tx, tz) + 0.012, tz).rotX(0.2).set(MAT.RUBBER).c(0x202022).torus(0, 0, 0, 0.032, 0.013, 16, 8).pop();
  }

  function terrain(mb) {
    const H = K.HALF;
    const xs = [], zs = [];
    const NX = 170;
    for (let i = 0; i <= NX; i++) xs.push(-H + 2 * H * i / NX);
    for (let i = 0; i <= NX; i++) zs.push(-H + 2 * H * i / NX);
    zs.push(K.QUAY_Z - 0.0005, K.QUAY_Z + 0.0005);
    zs.sort((a, b) => a - b);
    const col = (x, z, h) => {
      if (z < K.QUAY_Z) return z < -1.79 ? [126, 166, 94] : [150, 146, 136];
      if (h > -0.4) return [176, 168, 150];
      const s = 0.5 + 0.5 * Math.sin(x * 4.1 + Math.sin(z * 3.3) * 1.5) * Math.sin(z * 2.7 + x);
      return [232 - s * 22 | 0, 220 - s * 26 | 0, 190 - s * 30 | 0];
    };
    mb.push().set(MAT.TERRAIN);
    const P = (x, z) => [x, HC.terrainH(x, z), z];
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
        const a = P(x0, z1), b = P(x1, z1), c = P(x1, z0), d = P(x0, z0);
        const cc = col((x0 + x1) / 2, (z0 + z1) / 2, (a[1] + b[1] + c[1] + d[1]) / 4);
        mb.tri(a, b, c, cc); mb.tri(a, c, d, cc);
      }
    }
    mb.set(MAT.STRATA).c(0xffffff);
    const B = K.BOTTOM_Y;
    const edge = (pts, nx, nz) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const h0 = HC.terrainH(x0, z0), h1 = HC.terrainH(x1, z1);
        const n = [nx, 0, nz];
        mb.vert([x0, B, z0], n); mb.vert([x1, B, z1], n); mb.vert([x1, h1, z1], n);
        mb.vert([x0, B, z0], n); mb.vert([x1, h1, z1], n); mb.vert([x0, h0, z0], n);
      }
    };
    const fwd = a => a.slice(), rev = a => a.slice().reverse();
    edge(rev(zs.map(z => [H, z])), 1, 0);
    edge(fwd(zs.map(z => [-H, z])), -1, 0);
    edge(fwd(xs.map(x => [x, H])), 0, 1);
    edge(rev(xs.map(x => [x, -H])), 0, -1);
    mb.set(MAT.MATTE).c(0x9c8f80);
    mb.quad([-H, B, -H], [H, B, -H], [H, B, H], [-H, B, H]);
    mb.pop();
  }

  function backdrop(mb) {
    mb.push().o(OBJ.BACKDROP).set(MAT.PAPER).c(0xf0e9dc);
    const y = K.BOTTOM_Y - 0.002, R = 60;
    const seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * 6.283, a1 = (i + 1) / seg * 6.283;
      for (const [r0, r1] of [[0, 4], [4, 12], [12, R]]) {
        mb.quad([Math.cos(a0) * r0, y, Math.sin(a0) * r0], [Math.cos(a0) * r1, y, Math.sin(a0) * r1], [Math.cos(a1) * r1, y, Math.sin(a1) * r1], [Math.cos(a1) * r0, y, Math.sin(a1) * r0]);
      }
    }
    mb.pop();
  }

  function smallHull(mb, o) {
    hullLoft(mb, o);
  }

  function fishingBoat(mb, k, hullCol, houseCol) {
    const fb = L.fishingBoats[k];
    mb.push().o(OBJ.FBOAT[k]);
    mb.set(MAT.HULL, 120).c(hullCol);
    smallHull(mb, { half: fb.L / 2, beam: fb.B, draft: 0.035, deck: 0.025, bowStart: 0.02, sheer: 0.02, sternLen: 0.03, n: 2.4, deckCol: hex(0x8b6a48), transomCol: hex(hullCol), stations: 12, sect: 5 });
    mb.set(MAT.MATTE).c(houseCol).boxAB(-0.02, 0.025, -0.025, 0.04, 0.075, 0.025);
    mb.set(MAT.GLASS).c(0x22303c).boxAB(0.04, 0.05, -0.02, 0.042, 0.068, 0.02);
    mb.set(MAT.MATTE).c(0xf3f1ea).boxAB(-0.022, 0.075, -0.027, 0.042, 0.08, 0.027);
    mb.c(0xd9d6cc).cyl(0.06, 0.025, 0, 0.0025, 0.13, 5);
    mb.cyl(-0.06, 0.025, 0, 0.002, 0.08, 5);
    mb.set(MAT.PAINT).c(0xe0662f).boxAB(-0.1, 0.025, -0.02, -0.07, 0.04, 0.02);
    mb.pop();
  }

  function yacht(mb, k) {
    const y = L.yachts[k];
    const stripe = [0x2f62b5, 0xc8372d][k];
    mb.push().o(OBJ.YACHT[k]);
    mb.set(MAT.HULL, 118).c(0xf6f4ee);
    smallHull(mb, {
      half: y.len / 2, beam: y.beam, draft: 0.022, deck: 0.022, bowStart: -0.01, sheer: 0.012, sternLen: 0.02, n: 2.2, deckCol: hex(0xd8c8a8), transomCol: hex(0xf6f4ee), stations: 14, sect: 6,
      colFn: (kk) => kk === 1 ? hex(stripe) : undefined,
    });
    mb.set(MAT.PAINT).c(0x2b2c30).boxAB(-0.012, -0.075, -0.002, 0.018, -0.012, 0.002);
    mb.c(0x2b2c30).boxAB(-0.012, -0.08, -0.006, 0.022, -0.072, 0.006);
    mb.c(0xf6f4ee).boxAB(-0.095, -0.04, -0.0015, -0.085, 0.0, 0.0015);
    mb.c(0xf6f4ee).boxAB(-0.04, 0.022, -0.022, 0.03, 0.038, 0.022);
    mb.set(MAT.GLASS).c(0x22303c).boxAB(-0.03, 0.028, -0.0225, 0.02, 0.034, 0.0225);
    mb.set(MAT.STEEL).c(0xdedcd6).cyl(0.02, 0.022, 0, 0.0022, 0.28, 5);
    mb.push().translate(0.02, 0.06, 0).rotZ(Math.PI / 2).cyl(0, 0, 0, 0.0018, 0.09, 4).pop();
    mb.set(MAT.SAIL).c(stripe === 0x2f62b5 ? 0x2f62b5 : 0xece4d0);
    mb.push().translate(0.02, 0.06, 0).rotZ(Math.PI / 2).cyl(0, 0.004, 0, 0.0065, 0.08, 7, { r2: 0.004 }).pop();
    mb.c(0xece4d0);
    mb.beam([0.025, 0.28, 0], [0.098, 0.03, 0], 0.003);
    mb.set(MAT.LAMP, 120).c(0xffffff).sphere(0.02, 0.305, 0, 0.003, 5, 4);
    mb.pop();
  }

  function buoys(mb) {
    for (let k = 0; k < 2; k++) {
      mb.push().o(OBJ.MBUOY[k]).set(MAT.PAINT).c(0xf2c230).sphere(0, 0.004, 0, 0.022, 12, 8, { sy: 0.8 });
      mb.set(MAT.STEEL).c(0x5a5c60).torus(0, 0.022, 0, 0.005, 0.0015, 8, 4);
      mb.pop();
    }
    mb.push().o(OBJ.GBUOY).set(MAT.PAINT).c(0x2f8a4a);
    mb.cyl(0, -0.03, 0, 0.032, 0.05, 14, { r2: 0.028 });
    mb.cyl(0, 0.02, 0, 0.012, 0.06, 8, { r2: 0.008 });
    mb.c(0x2f8a4a).boxAB(-0.012, 0.08, -0.012, 0.012, 0.104, 0.012);
    mb.set(MAT.LAMP, 200).c(0x8fff9f).sphere(0, 0.112, 0, 0.006, 6, 4);
    mb.set(MAT.MATTE).c(0xf6f4ee).cyl(0, 0.015, 0, 0.0325, 0.006, 14);
    mb.pop();
  }

  function lifebuoys(mb) {
    for (let k = 0; k < 3; k++) {
      mb.push().o(OBJ.LIFEBUOY[k]).set(MAT.PAINT);
      mb.torus(0, 0, 0, 0.03, 0.009, 16, 8, i => hex(Math.floor(i / 2) % 2 ? 0xf4f2ec : 0xe8542a));
      mb.pop();
    }
  }

  function towLine(mb) {
    mb.push().c(0xd9c9a0);
    cables(mb, [{ oa: OBJ.TUG, a: [HC.TUG.hook, 0.05, 0], ob: OBJ.TOWHOOK, b: [0, 0, 0] }], 0.0018);
    mb.pop();
  }

  function buildScene() {
    const rnd = HC.mulberry32(42);
    const mb = new MB(1 << 18);
    backdrop(mb);
    terrain(mb);
    quayWall(mb, rnd);
    terminal(mb, rnd);
    fishingQuay(mb, rnd);
    pier(mb, rnd);
    breakwater(mb, rnd);
    seabed(mb, rnd);
    town(mb, rnd);
    buildShip(mb);
    buildTug(mb);
    buildCrane(mb, 0, 0xc8372d);
    buildCrane(mb, 1, 0x2f62b5);
    fishingBoat(mb, 0, 0x2f62b5, 0xf3f1ea);
    fishingBoat(mb, 1, 0xc8372d, 0xf3f1ea);
    yacht(mb, 0); yacht(mb, 1);
    buoys(mb);
    lifebuoys(mb);
    towLine(mb);
    const r = mb.finish();
    r.perches = PERCHES.slice();
    return r;
  }

  function buildContainer() {
    const mb = new MB(512);
    mb.set(MAT.CONTAINER, 0).c(0xffffff);
    const W = K.BOX_W / 2, H = K.BOX_H;
    mb.boxAB(-0.5, 0.0, -W, 0.5, H, W);
    mb.c(0x8a8a8a);
    const p = 0.0035;
    const post = (sx, sz) => {
      const x0 = sx > 0 ? 0.5 - 0.0001 : -0.5, x1 = sx > 0 ? 0.5 : -0.5 + 0.0001;
      mb.boxAB(sx > 0 ? 0.5 - 0.05 : -0.5, 0, sz > 0 ? W - p : -W - 0.0006, sx > 0 ? 0.5 : -0.5 + 0.05, H, sz > 0 ? W + 0.0006 : -W + p);
      return [x0, x1];
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(sx, sz);
    for (const sx of [-1, 1]) {
      mb.boxAB(sx > 0 ? 0.5 - 0.05 : -0.5 - 0.0006, 0, -W, sx > 0 ? 0.5 + 0.0006 : -0.5 + 0.05, 0.004, W);
      mb.boxAB(sx > 0 ? 0.5 - 0.05 : -0.5 - 0.0006, H - 0.004, -W, sx > 0 ? 0.5 + 0.0006 : -0.5 + 0.05, H, W);
    }
    return mb.finish();
  }

  function buildFish() {
    const mb = new MB(512);
    mb.set(MAT.FISH, 0).c(0xffffff);
    const seg = 8, rings = 6;
    const R = x => 0.17 * Math.sqrt(Math.max(0, 1 - Math.pow(x / 0.5, 2))) * (x < 0 ? 1 - 0.55 * (-x / 0.5) : 1);
    for (let i = 0; i < rings; i++) {
      const xa = 0.5 - i / rings, xb = 0.5 - (i + 1) / rings;
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * 6.283, a1 = (k + 1) / seg * 6.283;
        const P = (x, a) => [x, Math.cos(a) * R(x) * 1.15, Math.sin(a) * R(x) * 0.6];
        const N = (a) => [0, Math.cos(a), Math.sin(a)];
        const e = x => Math.round((0.5 - x) * 255);
        mb.vert(P(xa, a0), N(a0), undefined, e(xa)); mb.vert(P(xb, a0), N(a0), undefined, e(xb)); mb.vert(P(xb, a1), N(a1), undefined, e(xb));
        mb.vert(P(xa, a0), N(a0), undefined, e(xa)); mb.vert(P(xb, a1), N(a1), undefined, e(xb)); mb.vert(P(xa, a1), N(a1), undefined, e(xa));
      }
    }
    const tail = (y) => {
      mb.vert([-0.42, 0, 0], [0, 0, 1], undefined, 230); mb.vert([-0.68, y, 0], [0, 0, 1], undefined, 255); mb.vert([-0.62, 0, 0], [0, 0, 1], undefined, 255);
      mb.vert([-0.42, 0, 0], [0, 0, -1], undefined, 230); mb.vert([-0.62, 0, 0], [0, 0, -1], undefined, 255); mb.vert([-0.68, y, 0], [0, 0, -1], undefined, 255);
    };
    tail(0.17); tail(-0.17);
    mb.vert([0.1, 0.19, 0], [0, 0, 1], undefined, 100); mb.vert([-0.1, 0.19, 0], [0, 0, 1], undefined, 150); mb.vert([-0.02, 0.27, 0], [0, 0, 1], undefined, 130);
    mb.vert([0.1, 0.19, 0], [0, 0, -1], undefined, 100); mb.vert([-0.02, 0.27, 0], [0, 0, -1], undefined, 130); mb.vert([-0.1, 0.19, 0], [0, 0, -1], undefined, 150);
    return mb.finish();
  }

  function buildGull() {
    const mb = new MB(1024);
    mb.set(MAT.GULL, 0);
    mb.c(0xf7f6f2).sphere(0, 0, 0, 0.5, 10, 7, { sx: 1.0, sy: 0.32, sz: 0.3 });
    mb.sphere(0.42, 0.12, 0, 0.16, 8, 6);
    mb.c(0xf2c230);
    mb.push().translate(0.56, 0.11, 0).rotZ(-Math.PI / 2).cyl(0, 0, 0, 0.035, 0.14, 5, { r2: 0.008 }).pop();
    mb.c(0xd8342a).sphere(0.63, 0.085, 0, 0.018, 4, 3);
    mb.c(0x1b1b1d).sphere(0.5, 0.17, 0.09, 0.02, 4, 3).sphere(0.5, 0.17, -0.09, 0.02, 4, 3);
    mb.c(0xf2f1ec);
    mb.tri([-0.4, 0.04, 0], [-0.7, 0.03, -0.12], [-0.7, 0.03, 0.12]);
    mb.tri([-0.4, 0.04, 0], [-0.7, 0.03, 0.12], [-0.7, 0.03, -0.12]);
    for (const s of [1, -1]) {
      const inner = [[0.18, 0.06, 0.12 * s], [-0.22, 0.06, 0.12 * s], [-0.18, 0.06, 0.75 * s], [0.12, 0.06, 0.72 * s]];
      const outer = [[0.12, 0.06, 0.72 * s], [-0.18, 0.06, 0.75 * s], [-0.25, 0.06, 1.25 * s], [-0.02, 0.06, 1.3 * s]];
      const e = p => Math.round(Math.min(1, Math.abs(p[2]) / 1.3) * 255);
      const face = (q, colTop, colBot) => {
        const up = [0, 1, 0], dn = [0, -1, 0];
        const order = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const i of order) mb.vert(q[i], up, hex(colTop), e(q[i]));
        const order2 = s > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
        for (const i of order2) mb.vert([q[i][0], q[i][1] - 0.004, q[i][2]], dn, hex(colBot), e(q[i]));
      };
      face(inner, 0x9aa3ad, 0xeceae4);
      face(outer, 0x9aa3ad, 0xeceae4);
      const tip = [[-0.02, 0.061, 1.3 * s], [-0.25, 0.061, 1.25 * s], [-0.2, 0.061, 1.0 * s], [0.04, 0.061, 1.05 * s]];
      face(tip, 0x1b1b1d, 0x2a2a2c);
    }
    return mb.finish();
  }

  function buildJelly() {
    const mb = new MB(4096);
    mb.set(MAT.JELLY, 0).c(0xe9f2f4);
    mb.extra2 = 0;
    const seg = 20, rings = 7;
    const bell = (r0, j) => {
      const th = j / rings * Math.PI * 0.5;
      return [Math.sin(th) * r0, Math.cos(th) * 0.6 * r0];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a0 = i / seg * 6.283, a1 = (i + 1) / seg * 6.283;
      const [ra, ya] = bell(1, j), [rb, yb] = bell(1, j + 1);
      const P = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
      const N = (r, y, a) => { const l = Math.hypot(r, y / 0.6) || 1; return [Math.cos(a) * r / l, y / 0.6 / l, Math.sin(a) * r / l]; };
      const e = Math.round(j / rings * 255);
      const e2 = Math.round((j + 1) / rings * 255);
      mb.vert(P(ra, ya, a0), N(ra, ya, a0), undefined, e); mb.vert(P(rb, yb, a1), N(rb, yb, a1), undefined, e2); mb.vert(P(rb, yb, a0), N(rb, yb, a0), undefined, e2);
      mb.vert(P(ra, ya, a0), N(ra, ya, a0), undefined, e); mb.vert(P(ra, ya, a1), N(ra, ya, a1), undefined, e); mb.vert(P(rb, yb, a1), N(rb, yb, a1), undefined, e2);
    }
    mb.set(MAT.RING, 0).c(0xf08aa8);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      mb.push().translate(Math.cos(a) * 0.32, 0.38, Math.sin(a) * 0.32).rotX(Math.PI / 2 * 0.0).torus(0, 0, 0, 0.13, 0.04, 10, 4).pop();
    }
    mb.set(MAT.JELLY, 0).c(0xf5d9e2);
    mb.extra2 = 1;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const segs = 6;
      for (let s = 0; s < segs; s++) {
        const y0 = -s * 0.22, y1 = -(s + 1) * 0.22;
        const w0 = 0.12 * (1 - s / segs * 0.6), w1 = 0.12 * (1 - (s + 1) / segs * 0.6);
        const f0 = Math.sin(s * 2.1) * 0.05, f1 = Math.sin((s + 1) * 2.1) * 0.05;
        const ca = Math.cos(a), sa = Math.sin(a);
        const r0 = 0.08 + f0, r1 = 0.08 + f1;
        const A = [ca * r0 - sa * w0, y0, sa * r0 + ca * w0], B = [ca * r0 + sa * w0, y0, sa * r0 - ca * w0];
        const C = [ca * r1 + sa * w1, y1, sa * r1 - ca * w1], D = [ca * r1 - sa * w1, y1, sa * r1 + ca * w1];
        const n = [ca, 0, sa];
        const e0 = 128 + s * 20, e1 = 128 + (s + 1) * 20;
        mb.vert(A, n, undefined, e0); mb.vert(B, n, undefined, e0); mb.vert(C, n, undefined, e1);
        mb.vert(A, n, undefined, e0); mb.vert(C, n, undefined, e1); mb.vert(D, n, undefined, e1);
        const m = [-ca, 0, -sa];
        mb.vert(A, m, undefined, e0); mb.vert(C, m, undefined, e1); mb.vert(B, m, undefined, e0);
        mb.vert(A, m, undefined, e0); mb.vert(D, m, undefined, e1); mb.vert(C, m, undefined, e1);
      }
    }
    mb.c(0xf2e6ea);
    mb.extra2 = 2;
    const T = 32;
    for (let k = 0; k < T; k++) {
      const a = k / T * 6.283;
      const ca = Math.cos(a), sa = Math.sin(a);
      const len = 1.1 + 0.4 * Math.sin(k * 1.7);
      const w = 0.012;
      for (let s = 0; s < 4; s++) {
        const y0 = -len * s / 4, y1 = -len * (s + 1) / 4;
        const A = [ca * 0.98 - sa * w, y0, sa * 0.98 + ca * w], B = [ca * 0.98 + sa * w, y0, sa * 0.98 - ca * w];
        const C = [ca * 0.95 + sa * w, y1, sa * 0.95 - ca * w], D = [ca * 0.95 - sa * w, y1, sa * 0.95 + ca * w];
        const n = [ca, 0, sa];
        const e0 = 128 + s * 30, e1 = 128 + (s + 1) * 30;
        mb.vert(A, n, undefined, e0); mb.vert(B, n, undefined, e0); mb.vert(C, n, undefined, e1);
        mb.vert(A, n, undefined, e0); mb.vert(C, n, undefined, e1); mb.vert(D, n, undefined, e1);
      }
    }
    return mb.finish();
  }

  root.HarborGeo = { MAT, OBJ, MB, STRIDE, buildScene, buildContainer, buildFish, buildGull, buildJelly, hex };
})(typeof window !== 'undefined' ? window : globalThis);
