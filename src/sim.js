(function (root) {
  'use strict';
  const HC = root.HarborCore;
  const K = HC.K;

  class WaterSim {
    constructor(N) {
      this.N = N;
      this.dx = (2 * K.HALF) / N;
      const C = N * N;
      this.eta = new Float64Array(C);
      this.u = new Float64Array((N + 1) * N);
      this.v = new Float64Array(N * (N + 1));
      this.ground = new Float32Array(C);
      this.depth = new Float32Array(C);
      this.wet = new Uint8Array(C);
      this.foam = new Float32Array(C);
      this.foam2 = new Float32Array(C);
      this.lap = new Float64Array(C);
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
      const N = this.N, dep = this.depth, wet = this.wet;
      for (let c = 0; c < N * N; c++) {
        const d = level - this.ground[c];
        wet[c] = d > 0.015 ? 1 : 0;
        dep[c] = wet[c] ? Math.min(0.6, d) : 0;
        if (!wet[c]) { this.eta[c] = 0; this.foam[c] = 0; }
      }
      const hu = this.hu || (this.hu = new Float64Array((N + 1) * N)), mu = this.mu || (this.mu = new Float64Array((N + 1) * N));
      const hv = this.hv || (this.hv = new Float64Array(N * (N + 1))), mv = this.mv || (this.mv = new Float64Array(N * (N + 1)));
      hu.fill(0); mu.fill(0); hv.fill(0); mv.fill(0);
      for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
        const c = j * N + i;
        if (wet[c - 1] && wet[c]) { const f = j * (N + 1) + i; hu[f] = Math.min(dep[c - 1], dep[c]); mu[f] = 1; }
      }
      for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (wet[c - N] && wet[c]) { hv[c] = Math.min(dep[c - N], dep[c]); mv[c] = 1; }
      }
      this.pres = this.pres || new Float64Array(N * N);
      this.tex.fill(0);

      let j0 = N, j1 = -1;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (wet[j * N + i]) { if (j < j0) j0 = j; if (j > j1) j1 = j; break; }
      this.j0 = j0; this.j1 = j1;
    }
    reset() {
      this.eta.fill(0); this.u.fill(0); this.v.fill(0); this.foam.fill(0); this.hull.fill(0); this.primed = false;
    }
    step(dt, p) {
      const N = this.N, N1 = N + 1, dx = this.dx, eta = this.eta, u = this.u, v = this.v, lap = this.lap, P = this.pres;
      const hu = this.hu, mu = this.mu, hv = this.hv, mv = this.mv;
      const g = p.g, sig = p.sigma / (dx * dx), damp = Math.exp(-dt * p.damp), sm = p.smooth;
      const kx = dt / dx, ax = dt * p.ax, az = dt * p.az;
      const j0 = this.j0, j1 = this.j1;
      for (let j = j0; j <= j1; j++) {
        const row = j * N, frow = j * N1;
        const edgeRow = j === 0 || j === N - 1;
        for (let i = 0; i < N; i++) {
          const c = row + i, e = eta[c];
          let l;
          if (edgeRow || i === 0 || i === N - 1) {
            l = 0;
            if (i > 0) l += mu[frow + i] * (eta[c - 1] - e);
            if (i < N - 1) l += mu[frow + i + 1] * (eta[c + 1] - e);
            if (j > 0) l += mv[c] * (eta[c - N] - e);
            if (j < N - 1) l += mv[c + N] * (eta[c + N] - e);
          } else {
            l = mu[frow + i] * (eta[c - 1] - e) + mu[frow + i + 1] * (eta[c + 1] - e) + mv[c] * (eta[c - N] - e) + mv[c + N] * (eta[c + N] - e);
          }
          lap[c] = l;
          P[c] = g * e - sig * l;
        }
      }
      for (let j = j0; j <= j1; j++) {
        const row = j * N1, cr = j * N;
        for (let i = 1; i < N; i++) {
          const f = row + i;
          u[f] = mu[f] * (u[f] - kx * (P[cr + i] - P[cr + i - 1]) + ax) * damp;
        }
      }
      for (let c = Math.max(N, j0 * N), ce = Math.min(N * N, (j1 + 1) * N); c < ce; c++) v[c] = mv[c] * (v[c] - kx * (P[c] - P[c - N]) + az) * damp;
      let en = 0;
      for (let j = j0; j <= j1; j++) {
        const row = j * N, frow = j * N1;
        for (let i = 0; i < N; i++) {
          const c = row + i, f = frow + i;
          const e = eta[c] - kx * (hu[f + 1] * u[f + 1] - hu[f] * u[f] + hv[c + N] * v[c + N] - hv[c] * v[c]) + lap[c] * sm;
          eta[c] = e;
          en += e * e;
        }
      }
      this.energy = en;
    }
    velAt(i, j) {
      const N = this.N, o = this._vel || (this._vel = [0, 0]);
      o[0] = 0.5 * (this.u[j * (N + 1) + i] + this.u[j * (N + 1) + i + 1]);
      o[1] = 0.5 * (this.v[j * N + i] + this.v[(j + 1) * N + i]);
      return o;
    }
    advectFoam(dt) {
      const N = this.N, f = this.foam, f2 = this.foam2, wet = this.wet, U = this.u, V = this.v;
      const decay = Math.exp(-dt * 0.45), k = dt / this.dx * 0.8, EPS = 1e-4;
      for (let j = this.j0; j <= this.j1; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const c = row + i;
          if (!wet[c]) { f2[c] = 0; continue; }
          if (f[c] < EPS && (i === 0 || f[c - 1] < EPS) && (i === N - 1 || f[c + 1] < EPS) && (j === 0 || f[c - N] < EPS) && (j === N - 1 || f[c + N] < EPS)) { f2[c] = 0; continue; }
          const fu = j * (N + 1) + i;
          f2[c] = this.bilin(f, i - (U[fu] + U[fu + 1]) * k, j - (V[c] + V[c + N]) * k) * decay;
        }
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
      for (let cc = this.j0 * N, ce = (this.j1 + 1) * N; cc < ce; cc++) {
        const d = hn[cc] - h[cc];
        if (d !== 0) { this.eta[cc] -= d; h[cc] = hn[cc]; }
      }
    }
    whitecaps(dt) {
      const N = this.N, e = this.eta, f = this.foam;
      for (let j = Math.max(1, this.j0), je = Math.min(N - 1, this.j1 + 1); j < je; j++) for (let i = 1; i < N - 1; i++) {
        const c = j * N + i;
        if (!this.wet[c]) continue;
        const gx = e[c + 1] - e[c - 1], gz = e[c + N] - e[c - N];
        const s = Math.sqrt(gx * gx + gz * gz) / (2 * this.dx);
        if (s > 0.35) f[c] = Math.min(1.5, f[c] + (s - 0.35) * dt * 4);
        if (this.depth[c] < 0.03 && Math.abs(e[c]) > 0.006) f[c] = Math.min(0.8, f[c] + Math.abs(e[c]) * dt * 15);
      }
    }
    pack() {
      const N = this.N, t = this.tex, U = this.u, V = this.v, E = this.eta, Fo = this.foam;
      for (let j = this.j0; j <= this.j1; j++) {
        const row = j * N, frow = j * (N + 1);
        for (let i = 0; i < N; i++) {
          const c = row + i, o = c * 4;
          t[o] = E[c]; t[o + 1] = Fo[c]; t[o + 2] = 0.5 * (U[frow + i] + U[frow + i + 1]); t[o + 3] = 0.5 * (V[c] + V[c + N]);
        }
      }
      return t;
    }
  }

  root.HarborSim = { WaterSim };
})(typeof window !== 'undefined' ? window : globalThis);
