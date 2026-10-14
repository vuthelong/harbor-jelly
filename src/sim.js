(function (root) {
  'use strict';
  const HC = root.HarborCore;
  const K = HC.K;

  class WaterSim {
    constructor(N) {
      this.N = N;
      this.dx = (2 * K.HALF) / N;
      const C = N * N;
      this.eta = new Float32Array(C);
      this.u = new Float32Array((N + 1) * N);
      this.v = new Float32Array(N * (N + 1));
      this.ground = new Float32Array(C);
      this.depth = new Float32Array(C);
      this.wet = new Uint8Array(C);
      this.foam = new Float32Array(C);
      this.foam2 = new Float32Array(C);
      this.lap = new Float32Array(C);
      this.hull = new Float32Array(C);
      this.hullNew = new Float32Array(C);
      this.tex = new Float32Array(C * 4);
      this.level = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = this.cx(i), z = this.cx(j);
        this.ground[j * N + i] = HC.terrainH(x, z);
      }
      this.setLevel(0);
      this.energy = 0;
    }
    cx(i) { return -K.HALF + (i + 0.5) * this.dx; }
    setLevel(level) {
      this.level = level;
      const N = this.N;
      for (let c = 0; c < N * N; c++) {
        const d = level - this.ground[c];
        this.wet[c] = d > 0.015 ? 1 : 0;
        this.depth[c] = this.wet[c] ? Math.min(0.6, d) : 0;
        if (!this.wet[c]) this.eta[c] = 0;
      }
    }
    reset() {
      this.eta.fill(0); this.u.fill(0); this.v.fill(0); this.foam.fill(0); this.hull.fill(0); this.primed = false;
    }
    step(dt, p) {
      const N = this.N, dx = this.dx, eta = this.eta, u = this.u, v = this.v, wet = this.wet, dep = this.depth, lap = this.lap;
      const g = p.g, sig = p.sigma / (dx * dx), damp = Math.exp(-dt * p.damp);
      const ax = p.ax, az = p.az;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const c = j * N + i;
          if (!wet[c]) { lap[c] = 0; continue; }
          const e = eta[c];
          const l = i > 0 && wet[c - 1] ? eta[c - 1] : e;
          const r = i < N - 1 && wet[c + 1] ? eta[c + 1] : e;
          const d = j > 0 && wet[c - N] ? eta[c - N] : e;
          const t = j < N - 1 && wet[c + N] ? eta[c + N] : e;
          lap[c] = l + r + d + t - 4 * e;
        }
      }
      const kx = dt / dx;
      for (let j = 0; j < N; j++) {
        const row = j * (N + 1), cr = j * N;
        for (let i = 1; i < N; i++) {
          const cL = cr + i - 1, cR = cr + i;
          const f = row + i;
          if (wet[cL] && wet[cR]) {
            const pL = g * eta[cL] - sig * lap[cL], pR = g * eta[cR] - sig * lap[cR];
            u[f] = (u[f] - kx * (pR - pL) + dt * ax) * damp;
          } else u[f] = 0;
        }
      }
      for (let j = 1; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const cD = (j - 1) * N + i, cU = j * N + i;
          const f = j * N + i;
          if (wet[cD] && wet[cU]) {
            const pD = g * eta[cD] - sig * lap[cD], pU = g * eta[cU] - sig * lap[cU];
            v[f] = (v[f] - kx * (pU - pD) + dt * az) * damp;
          } else v[f] = 0;
        }
      }
      let en = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const c = j * N + i;
          if (!wet[c]) continue;
          const hc = dep[c];
          const hl = i > 0 ? Math.min(hc, dep[c - 1]) : 0, hr = i < N - 1 ? Math.min(hc, dep[c + 1]) : 0;
          const hd = j > 0 ? Math.min(hc, dep[c - N]) : 0, hu = j < N - 1 ? Math.min(hc, dep[c + N]) : 0;
          const fl = u[j * (N + 1) + i] * hl, fr = u[j * (N + 1) + i + 1] * hr;
          const fd = v[j * N + i] * hd, fu = v[(j + 1) * N + i] * hu;
          eta[c] -= kx * (fr - fl + fu - fd);
          eta[c] += lap[c] * p.smooth;
          en += eta[c] * eta[c];
        }
      }
      this.energy = en;
    }
    velAt(i, j) {
      const N = this.N;
      const u = 0.5 * (this.u[j * (N + 1) + i] + this.u[j * (N + 1) + i + 1]);
      const v = 0.5 * (this.v[j * N + i] + this.v[(j + 1) * N + i]);
      return [u, v];
    }
    advectFoam(dt) {
      const N = this.N, f = this.foam, f2 = this.foam2;
      const decay = Math.exp(-dt * 0.45);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (!this.wet[c]) { f2[c] = 0; continue; }
        const vu = 0.5 * (this.u[j * (N + 1) + i] + this.u[j * (N + 1) + i + 1]);
        const vv = 0.5 * (this.v[j * N + i] + this.v[(j + 1) * N + i]);
        const si = i - vu * dt / this.dx * 1.6, sj = j - vv * dt / this.dx * 1.6;
        f2[c] = this.bilin(f, si, sj) * decay;
      }
      this.foam = f2; this.foam2 = f;
    }
    bilin(a, si, sj) {
      const N = this.N;
      si = Math.max(0, Math.min(N - 1.001, si)); sj = Math.max(0, Math.min(N - 1.001, sj));
      const i = Math.floor(si), j = Math.floor(sj), fi = si - i, fj = sj - j;
      const c = j * N + i;
      return (a[c] * (1 - fi) + a[c + 1] * fi) * (1 - fj) + (a[c + N] * (1 - fi) + a[c + N + 1] * fi) * fj;
    }
    toGrid(x) { return (x + K.HALF) / this.dx - 0.5; }
    height(x, z) { return this.level + this.bilin(this.eta, this.toGrid(x), this.toGrid(z)); }
    velocity(x, z) {
      const N = this.N;
      const i = Math.max(0, Math.min(N - 1, Math.round(this.toGrid(x)))), j = Math.max(0, Math.min(N - 1, Math.round(this.toGrid(z))));
      return this.velAt(i, j);
    }
    isWet(x, z) {
      const N = this.N;
      const i = Math.round(this.toGrid(x)), j = Math.round(this.toGrid(z));
      if (i < 0 || j < 0 || i >= N || j >= N) return false;
      return !!this.wet[j * N + i];
    }
    splash(x, z, amp, rad, foam) {
      const N = this.N, dx = this.dx;
      const gi = this.toGrid(x), gj = this.toGrid(z);
      const r = Math.ceil(rad / dx * 2);
      let sum = 0;
      const w = [];
      for (let j = Math.floor(gj) - r; j <= Math.ceil(gj) + r; j++) for (let i = Math.floor(gi) - r; i <= Math.ceil(gi) + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const c = j * N + i;
        if (!this.wet[c]) continue;
        const d2 = ((i - gi) * dx) ** 2 + ((j - gj) * dx) ** 2;
        const k = Math.exp(-d2 / (rad * rad));
        if (k < 0.01) continue;
        w.push(c, k); sum += k;
      }
      for (let n = 0; n < w.length; n += 2) {
        this.eta[w[n]] -= amp * w[n + 1];
        if (foam) this.foam[w[n]] = Math.min(1.5, this.foam[w[n]] + foam * w[n + 1]);
      }
      return sum;
    }
    addFoam(x, z, amount, rad) {
      const N = this.N, dx = this.dx;
      const gi = this.toGrid(x), gj = this.toGrid(z);
      const r = Math.ceil(rad / dx);
      for (let j = Math.floor(gj) - r; j <= Math.ceil(gj) + r; j++) for (let i = Math.floor(gi) - r; i <= Math.ceil(gi) + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const c = j * N + i;
        if (!this.wet[c]) continue;
        const d = Math.hypot((i - gi) * dx, (j - gj) * dx) / rad;
        if (d < 1) this.foam[c] = Math.min(1.5, this.foam[c] + amount * (1 - d));
      }
    }
    displace(bodies, dt) {
      const N = this.N, dx = this.dx, hn = this.hullNew;
      hn.fill(0);
      for (const b of bodies) {
        const c = Math.cos(b.psi), s = Math.sin(b.psi);
        const ext = b.half + b.beam;
        const i0 = Math.max(0, Math.floor(this.toGrid(b.x - ext))), i1 = Math.min(N - 1, Math.ceil(this.toGrid(b.x + ext)));
        const j0 = Math.max(0, Math.floor(this.toGrid(b.z - ext))), j1 = Math.min(N - 1, Math.ceil(this.toGrid(b.z + ext)));
        const sp = Math.min(1, b.speed / 0.3);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const cc = j * N + i;
          if (!this.wet[cc]) continue;
          const x = this.cx(i) - b.x, z = this.cx(j) - b.z;
          const lx = x * c + z * s, lz = -x * s + z * c;
          let half = b.half;
          const u = lx / half;
          if (Math.abs(u) > 1) continue;
          let bw = b.beam / 2 * (u > 0.45 ? Math.sqrt(Math.max(0, 1 - ((u - 0.45) / 0.55) ** 2)) : 1);
          const v = Math.abs(lz) / Math.max(1e-4, bw);
          if (v > 1) {
            if (v < 1.9 && sp > 0.05) this.foam[cc] = Math.min(1.4, this.foam[cc] + dt * sp * 2.6 * (u > 0.2 ? 1.6 : 0.8) * (1.9 - v));
            continue;
          }
          const d = b.draft * b.disp * Math.sqrt(1 - v * v) * Math.min(1, (1 - Math.abs(u)) * 6);
          hn[cc] += d;
          if (u < -0.75 && b.wash > 0.05) this.foam[cc] = Math.min(1.5, this.foam[cc] + dt * b.wash * 3);
        }
        if (b.wash > 0.05) {
          const sx = b.x - c * (b.half + 0.04), sz = b.z - s * (b.half + 0.04);
          const dir = b.reverse ? -1 : 1;
          const gi = Math.round(this.toGrid(sx)), gj = Math.round(this.toGrid(sz));
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = gi + di, jj = gj + dj;
            if (ii < 1 || jj < 1 || ii >= N - 1 || jj >= N - 1) continue;
            const cc = jj * N + ii;
            if (!this.wet[cc]) continue;
            this.u[jj * (N + 1) + ii] -= c * b.wash * 0.25 * dt * dir * 10;
            this.v[jj * N + ii] -= s * b.wash * 0.25 * dt * dir * 10;
            this.foam[cc] = Math.min(1.5, this.foam[cc] + dt * b.wash * 2.2);
          }
        }
      }
      const h = this.hull;
      if (!this.primed) { h.set(hn); this.primed = true; return; }
      for (let cc = 0; cc < N * N; cc++) {
        const d = hn[cc] - h[cc];
        if (d !== 0) { this.eta[cc] -= d; h[cc] = hn[cc]; }
      }
    }
    whitecaps(dt) {
      const N = this.N, e = this.eta, f = this.foam;
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const c = j * N + i;
        if (!this.wet[c]) continue;
        const gx = e[c + 1] - e[c - 1], gz = e[c + N] - e[c - N];
        const s = Math.sqrt(gx * gx + gz * gz) / (2 * this.dx);
        if (s > 0.35) f[c] = Math.min(1.5, f[c] + (s - 0.35) * dt * 4);
        if (this.depth[c] < 0.03 && Math.abs(e[c]) > 0.006) f[c] = Math.min(0.8, f[c] + Math.abs(e[c]) * dt * 15);
      }
    }
    pack() {
      const N = this.N, t = this.tex;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const vu = 0.5 * (this.u[j * (N + 1) + i] + this.u[j * (N + 1) + i + 1]);
        const vv = 0.5 * (this.v[j * N + i] + this.v[(j + 1) * N + i]);
        t[c * 4] = this.eta[c]; t[c * 4 + 1] = this.foam[c]; t[c * 4 + 2] = vu; t[c * 4 + 3] = vv;
      }
      return t;
    }
  }

  root.HarborSim = { WaterSim };
})(typeof window !== 'undefined' ? window : globalThis);
