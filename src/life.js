(function (root) {
  'use strict';
  const HC = root.HarborCore;
  const K = HC.K, L = HC.LAYOUT;
  const { qmul, qaxis, qyaw, qrot, clamp, wrapAngle, mulberry32 } = HC;

  class Floater {
    constructor(x, z, psi, half, beam) {
      this.x = x; this.z = z; this.psi = psi; this.half = half; this.beam = beam;
      this.y = 0; this.vy = 0; this.pitch = 0; this.vp = 0; this.roll = 0; this.vr = 0; this.q = [0, 0, 0, 1];
    }
    update(sim, dt, k) {
      k = k || 50;
      const c = Math.cos(this.psi), s = Math.sin(this.psi);
      const P = (lx, lz) => sim.height(this.x + c * lx - s * lz, this.z + s * lx + c * lz);
      const hb = P(this.half, 0), hs = P(-this.half, 0), hp = P(0, -this.beam / 2), hq = P(0, this.beam / 2), hc = P(0, 0);
      const mean = (hb + hs + hp + hq + 2 * hc) / 6;
      const pT = Math.atan2(hb - hs, 2 * this.half), rT = -Math.atan2(hq - hp, this.beam);
      this.vy += (k * (mean - this.y) - 7 * this.vy) * dt; this.y += this.vy * dt;
      this.vp += (k * (pT - this.pitch) - 7 * this.vp) * dt; this.pitch += this.vp * dt;
      this.vr += (k * (rT - this.roll) - 5 * this.vr) * dt; this.roll += this.vr * dt;
      this.q = qmul(qmul(qyaw(this.psi), qaxis(0, 0, 1, this.pitch)), qaxis(1, 0, 0, this.roll));
    }
  }

  function create(opts) {
    const sim = opts.sim;
    const perchesStatic = opts.perches;
    const rnd = mulberry32(opts.seed || 99);
    const reduced = !!opts.reduced;
    const Life = { t: 0 };

    const yachts = L.yachts.map((y, i) => {
      const f = new Floater(y.buoy[0], y.buoy[1] + y.rope + y.len / 2, -Math.PI / 2, y.len / 2, y.beam);
      f.base = i ? 1.3 : -1.9; f.cfg = y; f.wpsi = 0;
      return f;
    });
    const mbuoys = L.yachts.map(y => new Floater(y.buoy[0], y.buoy[1], 0, 0.02, 0.02));
    const gbuoy = new Floater(L.channelBuoy[0], L.channelBuoy[1], 0, 0.03, 0.03);
    const fboats = L.fishingBoats.map(b => new Floater(b.x, b.z, b.psi, b.L / 2, b.B));

    function updateFloaters(dt) {
      const t = Life.t;
      yachts.forEach((y, i) => {
        const cfg = y.cfg;
        const [vu, vv] = sim.velocity(y.x, y.z);
        const target = y.base + 0.55 * Math.sin(t * 0.045 + i * 2.1) + 0.25 * Math.sin(t * 0.11 + i);
        const flow = Math.hypot(vu, vv) > 0.01 ? Math.atan2(-vv, -vu) : target;
        let want = target + wrapAngle(flow - target) * clamp(Math.hypot(vu, vv) * 6, 0, 0.6);
        y.wpsi += (wrapAngle(want - y.psi) * 0.4 - y.wpsi * 0.9) * dt;
        y.psi = wrapAngle(y.psi + y.wpsi * dt);
        const r = cfg.rope + cfg.len / 2;
        y.x = cfg.buoy[0] - Math.cos(y.psi) * r;
        y.z = cfg.buoy[1] - Math.sin(y.psi) * r;
        y.update(sim, dt, 40);
      });
      for (const b of mbuoys) b.update(sim, dt, 80);
      gbuoy.update(sim, dt, 60);
      for (const b of fboats) b.update(sim, dt, 45);
    }

    const buoys = [[-0.3, 1.0], [1.15, 1.85], [-2.0, 1.95]].map(([x, z]) => ({
      x, z, y: 0, vx: 0, vy: 0, vz: 0, state: 'float', q: [0, 0, 0, 1], spin: rnd() * 6, wob: 0,
    }));
    const BR = 0.04;

    function hullPush(b, body, half, beam, dt) {
      const c = Math.cos(body.psi), s = Math.sin(body.psi);
      const dx = b.x - body.x, dz = b.z - body.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      const hx = half + BR, hz = beam / 2 + BR;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
        const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
        let nlx = 0, nlz = 0;
        if (px < pz) nlx = Math.sign(lx) || 1; else nlz = Math.sign(lz) || 1;
        const pen = Math.min(px, pz);
        const nx = nlx * c - nlz * s, nz = nlx * s + nlz * c;
        b.x += nx * pen; b.z += nz * pen;
        const vn = (b.vx - body.vx) * nx + (b.vz - body.vz) * nz;
        if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vz -= 1.5 * vn * nz; }
        b.vx += body.vx * dt * 4; b.vz += body.vz * dt * 4;
        return true;
      }
      return false;
    }

    function landBounce(b) {
      const level = sim.level;
      const H = HC.terrainH(b.x, b.z);
      const pr = L.pier;
      const inPier = b.x > pr.x0 - BR && b.x < pr.x1 + BR && b.z < pr.z1 + BR && b.z > pr.z0;
      if (Math.abs(b.x) > K.HALF - BR) { b.x = Math.sign(b.x) * (K.HALF - BR); b.vx = -b.vx * 0.6; }
      if (Math.abs(b.z) > K.HALF - BR) { b.z = Math.sign(b.z) * (K.HALF - BR); b.vz = -b.vz * 0.6; }
      if (inPier && b.y < 0.11) {
        const dl = b.x - (pr.x0 - BR), dr = pr.x1 + BR - b.x, df = pr.z1 + BR - b.z;
        const m = Math.min(dl, dr, df);
        if (m === dl) { b.x = pr.x0 - BR; b.vx = -Math.abs(b.vx) * 0.6; }
        else if (m === dr) { b.x = pr.x1 + BR; b.vx = Math.abs(b.vx) * 0.6; }
        else { b.z = pr.z1 + BR; b.vz = Math.abs(b.vz) * 0.6; }
      }
      if (H > level - 0.015 && b.state === 'float') {
        const e = 0.02;
        const gx = HC.terrainH(b.x + e, b.z) - HC.terrainH(b.x - e, b.z);
        const gz = HC.terrainH(b.x, b.z + e) - HC.terrainH(b.x, b.z - e);
        const gl = Math.hypot(gx, gz) || 1;
        const nx = -gx / gl, nz = -gz / gl;
        for (let k = 0; k < 8 && HC.terrainH(b.x, b.z) > level - 0.015; k++) { b.x += nx * 0.006; b.z += nz * 0.006; }
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; }
      }
    }

    function updateBuoys(dt, core) {
      for (const b of buoys) {
        if (b.state === 'held') continue;
        if (b.state === 'air') {
          b.vy -= 3.2 * dt;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          b.spin += dt * 6;
          if (Math.abs(b.x) > K.HALF - BR) { b.x = Math.sign(b.x) * (K.HALF - BR); b.vx *= -0.5; }
          if (Math.abs(b.z) > K.HALF - BR) { b.z = Math.sign(b.z) * (K.HALF - BR); b.vz *= -0.5; }
          const H = HC.terrainH(b.x, b.z);
          const pr = L.pier;
          const onPier = b.x > pr.x0 && b.x < pr.x1 && b.z < pr.z1 && b.z > pr.z0;
          const ground = Math.max(H, onPier ? 0.105 : -9);
          const wh = sim.height(b.x, b.z);
          if (ground > sim.level - 0.01 && b.y < ground + 0.01) {
            b.y = ground + 0.01; b.vy = Math.abs(b.vy) * 0.35; b.vx *= 0.6; b.vz *= 0.6;
            if (Math.abs(b.vy) < 0.15) { b.vy = 0; b.state = 'land'; }
          } else if (b.y < wh && ground < sim.level - 0.01) {
            b.state = 'float';
            const sp = Math.min(1, Math.abs(b.vy) / 2);
            sim.splash(b.x, b.z, 0.012 + 0.02 * sp, 0.05, 1.0);
            Life.splash(b.x, wh, b.z, 0.6 + sp);
            b.vy = 0;
          }
          continue;
        }
        if (b.state === 'land') {
          b.vx *= Math.exp(-dt * 6); b.vz *= Math.exp(-dt * 6);
          b.x += b.vx * dt; b.z += b.vz * dt;
          if (HC.terrainH(b.x, b.z) < sim.level - 0.015) { b.state = 'float'; }
          continue;
        }
        const [vu, vv] = sim.velocity(b.x, b.z);
        b.vx += (vu * 0.8 - b.vx) * dt * 1.5;
        b.vz += (vv * 0.8 - b.vz) * dt * 1.5;
        b.x += b.vx * dt; b.z += b.vz * dt;
        if (hullPush(b, core.ship, HC.SHIP.half, HC.SHIP.B, dt)) Life.foamAt(b.x, b.z, 0.2);
        hullPush(b, core.tug, HC.TUG.half + 0.02, HC.TUG.B + 0.02, dt);
        for (const f of fboats) hullPush(b, { x: f.x, z: f.z, psi: f.psi, vx: 0, vz: 0 }, f.half, f.beam, dt);
        for (const y of yachts) hullPush(b, { x: y.x, z: y.z, psi: y.psi, vx: 0, vz: 0 }, y.half, y.beam, dt);
        landBounce(b);
        const e = 0.03;
        const hx = sim.height(b.x + e, b.z) - sim.height(b.x - e, b.z);
        const hz = sim.height(b.x, b.z + e) - sim.height(b.x, b.z - e);
        b.y = sim.height(b.x, b.z) + 0.003;
        const n = [-hx / (2 * e), 1, -hz / (2 * e)];
        const nl = Math.hypot(n[0], n[1], n[2]);
        const ax = [n[2] / nl, 0, -n[0] / nl];
        const al = Math.hypot(ax[0], ax[2]);
        const ang = Math.acos(clamp(n[1] / nl, -1, 1));
        const tq = al > 1e-6 ? qaxis(ax[0] / al, 0, ax[2] / al, ang) : [0, 0, 0, 1];
        b.spin += (b.vx * 3 + b.vz * 2) * dt;
        b.q = qmul(tq, qaxis(0, 1, 0, b.spin));
      }
      for (let i = 0; i < buoys.length; i++) for (let j = i + 1; j < buoys.length; j++) {
        const a = buoys[i], c = buoys[j];
        if (a.state === 'held' || c.state === 'held') continue;
        const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
        if (d < 2 * BR && d > 1e-5) {
          const p = (2 * BR - d) / 2, nx = dx / d, nz = dz / d;
          a.x -= nx * p; a.z -= nz * p; c.x += nx * p; c.z += nz * p;
        }
      }
    }

    const particles = [];
    const MAXP = 700;
    function emit(p) { if (particles.length < MAXP) particles.push(p); }

    Life.splash = (x, y, z, k) => {
      const n = Math.round((reduced ? 6 : 14) * k);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, s = 0.2 + rnd() * 0.5;
        emit({ p: [x, y + 0.01, z], v: [Math.cos(a) * s * 0.4, 0.5 + rnd() * 0.9 * k, Math.sin(a) * s * 0.4], life: 0, max: 0.6 + rnd() * 0.4, size: 0.006 + rnd() * 0.006, grow: 0, col: [0.95, 0.98, 1, 0.9], kind: 1, g: 3.2, water: true });
      }
      scatters.push({ x, y: y - 0.05, z, r: 0.6, s: 2.5, life: 1.2 });
    };
    Life.foamAt = (x, z, a) => sim.addFoam(x, z, a, 0.04);

    const bubbles = [];
    for (let i = 0; i < (reduced ? 30 : 60); i++) {
      let x, z, H;
      do { x = (rnd() * 2 - 1) * 2.5; z = rnd() * 3.1 - 0.6; H = HC.terrainH(x, z); } while (H > -0.2);
      bubbles.push({ x, z, y: H + rnd() * (-H - 0.04), r: 0.003 + rnd() * 0.005, ph: rnd() * 6 });
    }

    const food = [];
    Life.feed = () => {
      const pr = L.pier;
      for (let i = 0; i < 16; i++) {
        food.push({ x: (pr.x0 + pr.x1) / 2 + (rnd() - 0.5) * 0.05, y: 0.13, z: pr.z1 - 0.02, vx: (rnd() - 0.5) * 0.5, vy: 0.3 + rnd() * 0.4, vz: 0.25 + rnd() * 0.5, state: 'air', life: 0 });
      }
      for (const g of gulls.filter(g => g.state === 'fly').slice(0, 3)) { g.state = 'dive'; g.t = 0; g.from = g.p.slice(); }
      for (const g of gulls.filter(g => g.state === 'perched' && rnd() < 0.3)) takeoff(g);
    };
    function updateFood(dt) {
      for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        f.life += dt;
        if (f.state === 'air') {
          f.vy -= 3 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
          const wh = sim.height(f.x, f.z);
          if (f.y < wh) {
            if (!sim.isWet(f.x, f.z)) { food.splice(i, 1); continue; }
            f.state = 'float'; f.y = wh; sim.splash(f.x, f.z, 0.002, 0.02, 0.3);
          }
        } else if (f.state === 'float') {
          f.y = sim.height(f.x, f.z);
          if (f.life > 2.5 + (i % 5) * 0.4) f.state = 'sink';
        } else {
          f.y -= dt * 0.035;
          const H = HC.terrainH(f.x, f.z);
          if (f.y < H + 0.005) f.y = H + 0.005;
        }
        if (f.life > 30) food.splice(i, 1);
      }
    }

    const scatters = [];

    const fish = [];
    const species = [
      { n: 30, size: 0.034, speed: 0.22, depth: [-0.35, -0.06], col: 0 },
      { n: 36, size: 0.028, speed: 0.2, depth: [-0.3, -0.05], col: 1 },
      { n: 12, size: 0.022, speed: 0.12, depth: [-0.52, -0.3], col: 2 },
    ];
    const schools = species.map((sp, si) => {
      const home = [[-0.6, 0.9], [0.4, 1.6], [1.25, 0.2]][si];
      const sc = { sp, target: [home[0], (sp.depth[0] + sp.depth[1]) / 2, home[1]], tt: 0, home, members: [] };
      for (let i = 0; i < sp.n; i++) {
        const f = { p: [home[0] + (rnd() - 0.5) * 0.3, sc.target[1] + (rnd() - 0.5) * 0.1, home[1] + (rnd() - 0.5) * 0.3], v: [(rnd() - 0.5) * 0.1, 0, (rnd() - 0.5) * 0.1], ph: rnd() * 6, school: si, size: sp.size * (0.85 + rnd() * 0.3), yaw: 0, pitch: 0 };
        fish.push(f); sc.members.push(f);
      }
      return sc;
    });

    function inWater(x, y, z) {
      if (Math.abs(x) > K.HALF - 0.04 || Math.abs(z) > K.HALF - 0.04) return false;
      return y < sim.level - 0.03 && y > HC.terrainH(x, z) + 0.025;
    }

    function updateFish(dt, core) {
      const bodies = [
        { b: core.ship, half: HC.SHIP.half + 0.04, beam: HC.SHIP.B + 0.06, draft: HC.SHIP.draft + 0.05 },
        { b: core.tug, half: HC.TUG.half + 0.04, beam: HC.TUG.B + 0.06, draft: HC.TUG.draft + 0.04 },
      ];
      for (const sc of schools) {
        sc.tt -= dt;
        if (sc.tt <= 0) {
          sc.tt = 4 + rnd() * 6;
          for (let tries = 0; tries < 20; tries++) {
            const x = sc.home[0] + (rnd() - 0.5) * 2.2, z = sc.home[1] + (rnd() - 0.5) * 2.0;
            const y = sc.sp.depth[0] + rnd() * (sc.sp.depth[1] - sc.sp.depth[0]);
            if (inWater(x, y, z) && HC.terrainH(x, z) < y - 0.08) { sc.target = [x, y, z]; break; }
          }
        }
        const ms = sc.members;
        const sp = sc.sp;
        let fx = 0, fy = 0, fz = 0, fn = 0;
        for (const f of food) if (f.state !== 'air') { fx += f.x; fy += f.y; fz += f.z; fn++; }
        for (let i = 0; i < ms.length; i++) {
          const f = ms[i];
          let ax = 0, ay = 0, az = 0;
          let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0;
          for (let j = 0; j < ms.length; j++) {
            if (i === j) continue;
            const o = ms[j];
            const dx = o.p[0] - f.p[0], dy = o.p[1] - f.p[1], dz = o.p[2] - f.p[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > 0.04) continue;
            n++; cx += dx; cy += dy; cz += dz; vx += o.v[0]; vy += o.v[1]; vz += o.v[2];
            if (d2 < 0.0012) { const k = 0.0012 / (d2 + 1e-5) * 0.02; ax -= dx * k * 30; ay -= dy * k * 30; az -= dz * k * 30; }
          }
          if (n) {
            ax += cx / n * 1.2 + (vx / n - f.v[0]) * 1.4;
            ay += cy / n * 1.2 + (vy / n - f.v[1]) * 1.4;
            az += cz / n * 1.2 + (vz / n - f.v[2]) * 1.4;
          }
          let tx = sc.target[0], ty = sc.target[1], tz = sc.target[2];
          let tk = 0.35;
          if (fn) {
            const cxF = fx / fn, cyF = fy / fn, czF = fz / fn;
            if (Math.hypot(cxF - f.p[0], czF - f.p[2]) < 1.6) { tx = cxF; ty = Math.min(cyF - 0.04, sim.level - 0.05); tz = czF; tk = 1.4; }
          }
          ax += (tx - f.p[0]) * tk; ay += (ty - f.p[1]) * tk; az += (tz - f.p[2]) * tk;
          for (const s of scatters) {
            const dx = f.p[0] - s.x, dy = f.p[1] - s.y, dz = f.p[2] - s.z;
            const d = Math.hypot(dx, dy * 0.5, dz);
            if (d < s.r) { const k = s.s * (1 - d / s.r) / (d + 0.02); ax += dx * k; ay += dy * k * 0.3; az += dz * k; }
          }
          for (const B of bodies) {
            const b = B.b;
            const c = Math.cos(b.psi), s = Math.sin(b.psi);
            const dx = f.p[0] - b.x, dz = f.p[2] - b.z;
            const lx = dx * c + dz * s, lz = -dx * s + dz * c;
            if (b.speed > 0.03) {
              const d = Math.hypot(dx, dz);
              if (d < B.half + 0.35) { const k = b.speed * 3 / (d + 0.05); ax += dx * k; az += dz * k; }
            }
            if (Math.abs(lx) < B.half && Math.abs(lz) < B.beam / 2 && f.p[1] > sim.level - B.draft) {
              ay -= 3.5;
              const nlz = Math.sign(lz) || 1;
              ax += -nlz * s * 1.5; az += nlz * c * 1.5;
            }
          }
          const H = HC.terrainH(f.p[0], f.p[2]);
          if (f.p[1] < H + 0.06) ay += (H + 0.06 - f.p[1]) * 40;
          if (f.p[1] > sim.level - 0.06) ay -= (f.p[1] - sim.level + 0.06) * 40;
          for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const dd = K.HALF - (f.p[0] * ex + f.p[2] * ez);
            if (dd < 0.15) { ax -= ex * (0.15 - dd) * 30; az -= ez * (0.15 - dd) * 30; }
          }
          const ahead = [f.p[0] + f.v[0] * 0.5, f.p[2] + f.v[2] * 0.5];
          if (HC.terrainH(ahead[0], ahead[1]) > f.p[1] - 0.04 || ahead[1] < K.QUAY_Z + 0.06) {
            const e = 0.03;
            const gx = HC.terrainH(f.p[0] + e, f.p[2]) - HC.terrainH(f.p[0] - e, f.p[2]);
            const gz = HC.terrainH(f.p[0], f.p[2] + e) - HC.terrainH(f.p[0], f.p[2] - e);
            ax -= gx * 30 + f.v[0] * 2; az -= gz * 30 + f.v[2] * 2;
            if (ahead[1] < K.QUAY_Z + 0.06) az += 2;
          }
          f.v[0] += ax * dt; f.v[1] += ay * dt; f.v[2] += az * dt;
          const sp2 = Math.hypot(f.v[0], f.v[1], f.v[2]);
          const vmax = sp.speed * (scatters.length ? 2.4 : 1) * (fn ? 1.5 : 1);
          const vmin = sp.speed * 0.25;
          const k = sp2 > vmax ? vmax / sp2 : (sp2 < vmin ? vmin / (sp2 + 1e-6) : 1);
          f.v[0] *= k; f.v[1] *= k * 0.6; f.v[2] *= k;
          f.p[0] += f.v[0] * dt; f.p[1] += f.v[1] * dt; f.p[2] += f.v[2] * dt;
          const Hn = HC.terrainH(f.p[0], f.p[2]);
          if (Hn > sim.level - 0.06 || f.p[2] < K.QUAY_Z + 0.03) { f.p[0] -= f.v[0] * dt * 2; f.p[2] -= f.v[2] * dt * 2; f.v[0] *= -0.5; f.v[2] *= -0.5; }
          f.p[1] = clamp(f.p[1], Math.max(Hn, -0.6) + 0.025, sim.level - 0.035);
          f.p[0] = clamp(f.p[0], -K.HALF + 0.04, K.HALF - 0.04); f.p[2] = clamp(f.p[2], -K.HALF + 0.04, K.HALF - 0.04);
          const hs = Math.hypot(f.v[0], f.v[2]);
          if (hs > 1e-4) f.yaw += wrapAngle(Math.atan2(f.v[2], f.v[0]) - f.yaw) * Math.min(1, dt * 8);
          f.pitch = Math.atan2(f.v[1], hs + 1e-4) * 0.8;
          f.ph += dt * (10 + sp2 * 60);
          for (let fi = food.length - 1; fi >= 0; fi--) {
            const fo = food[fi];
            if (fo.state === 'air') continue;
            if (Math.abs(fo.x - f.p[0]) < 0.03 && Math.abs(fo.z - f.p[2]) < 0.03 && Math.abs(fo.y - f.p[1]) < 0.06) { food.splice(fi, 1); break; }
          }
        }
      }
    }

    const jellies = [];
    for (let i = 0; i < 6; i++) {
      let x, z;
      do { x = -2.2 + rnd() * 4.2; z = -0.3 + rnd() * 2.6; } while (HC.terrainH(x, z) > -0.4);
      jellies.push({ p: [x, -0.15 - rnd() * 0.25, z], ph: rnd() * 6, rate: 1.8 + rnd() * 0.8, vy: 0, yaw: rnd() * 6, tilt: 0, size: 0.045 + rnd() * 0.02, seed: rnd() * 10 });
    }
    function updateJellies(dt, core) {
      for (const j of jellies) {
        j.ph += dt * j.rate;
        const [vu, vv] = sim.velocity(j.p[0], j.p[2]);
        const pulse = Math.max(0, Math.sin(j.ph)) ** 2;
        j.vy += (pulse * 0.08 - 0.03) * dt - j.vy * dt * 1.5;
        j.p[0] += (vu * 0.6 + Math.sin(Life.t * 0.07 + j.seed) * 0.01) * dt;
        j.p[2] += (vv * 0.6 + Math.cos(Life.t * 0.05 + j.seed) * 0.01) * dt;
        j.p[1] += j.vy * dt;
        const H = HC.terrainH(j.p[0], j.p[2]);
        const bottom = H + 0.12;
        if (j.p[1] < bottom) { j.p[1] = bottom; j.vy = Math.abs(j.vy); }
        if (j.p[1] > sim.level - 0.06) { j.p[1] = sim.level - 0.06; j.vy = -Math.abs(j.vy) * 0.5; }
        if (H > sim.level - 0.25 || j.p[2] < K.QUAY_Z + 0.08) { j.p[0] -= vu * dt * 2; j.p[2] += 0.02 * dt + Math.abs(vv) * dt; }
        j.p[0] = clamp(j.p[0], -K.HALF + 0.08, K.HALF - 0.08); j.p[2] = clamp(j.p[2], K.QUAY_Z + 0.08, K.HALF - 0.08);
        for (const b of [core.ship, core.tug]) {
          const d = Math.hypot(j.p[0] - b.x, j.p[2] - b.z);
          if (d < 0.25 && j.p[1] > -0.2) j.vy -= dt * 0.2;
        }
        j.tilt = Math.sin(j.ph * 0.5) * 0.12;
        j.yaw += dt * 0.05;
      }
    }

    const gulls = [];
    function dynPerches(core, objs) {
      const out = [];
      for (let k = 0; k < 2; k++) {
        const cr = core.cranes[k];
        out.push({ get: () => [cr.x, 1.04, -0.94], yaw: 0.4, kind: 'crane' + k });
      }
      out.push({ get: () => core.shipWorld([0.62, HC.SHIP.deckY + 0.165, 0]), yawFn: () => core.ship.psi, kind: 'mast' });
      out.push({ get: () => { const t = core.tug; const r = qrot(t.q, [0.04, 0.205, 0]); return [t.x + r[0], t.y + r[1], t.z + r[2]]; }, yawFn: () => core.tug.psi, kind: 'tug' });
      yachts.forEach((y, i) => out.push({ get: () => { const r = qrot(y.q, [0.02, 0.31, 0]); return [y.x + r[0], y.y + r[1], y.z + r[2]]; }, yawFn: () => y.psi, kind: 'yacht' + i }));
      return out;
    }
    let perches = [];
    function initGulls(core) {
      perches = perchesStatic.map(p => ({ get: () => p.p, yaw: p.yaw, kind: p.kind })).concat(dynPerches(core));
      for (let i = 0; i < 10; i++) {
        const g = {
          p: [0, 1.2, 0], v: [0, 0, 0], yaw: 0, bank: 0, pitch: 0, flap: rnd() * 6, flapAmp: 0.8, fold: 0,
          state: 'fly', t: 0, c: [(rnd() - 0.5) * 3, 0.9 + rnd() * 0.6, (rnd() - 0.2) * 2.5], R: 0.6 + rnd() * 0.9,
          w: (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.2), ang: rnd() * 6.28, perch: null, timer: 4 + rnd() * 12, size: 0.07 + rnd() * 0.012,
        };
        if (i < 6) {
          const p = perches[Math.floor(rnd() * perches.length)];
          if (!gulls.some(o => o.perch === p)) { g.state = 'perched'; g.perch = p; g.timer = 5 + rnd() * 20; }
        }
        g.p = g.state === 'perched' ? g.perch.get().slice() : [g.c[0] + Math.cos(g.ang) * g.R, g.c[1], g.c[2] + Math.sin(g.ang) * g.R];
        gulls.push(g);
      }
    }
    function takeoff(g) {
      if (g.state !== 'perched' && g.state !== 'land') return;
      g.state = 'takeoff'; g.t = 0; g.from = g.p.slice();
      g.ang = rnd() * 6.28; g.c = [g.p[0] + (rnd() - 0.5), 1.0 + rnd() * 0.6, g.p[2] + (rnd() - 0.5)];
      g.c[0] = clamp(g.c[0], -1.8, 1.8); g.c[2] = clamp(g.c[2], -1.8, 1.8);
      g.perch = null;
    }
    Life.scareGulls = () => {
      for (const g of gulls) {
        if (g.state === 'perched' || g.state === 'land') takeoff(g);
        else if (g.state === 'fly') { g.R = Math.min(1.8, g.R + 0.4); g.c[1] = Math.min(2.0, g.c[1] + 0.3); g.flapAmp = 1.0; }
        g.timer = 6 + rnd() * 10;
      }
    };
    function bezier(a, b, c, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], u * u * a[2] + 2 * u * t * b[2] + t * t * c[2]]; }

    function updateGulls(dt) {
      for (const g of gulls) {
        const prev = g.p.slice();
        g.t += dt; g.timer -= dt;
        switch (g.state) {
          case 'fly': {
            g.ang += g.w * dt;
            const tp = [g.c[0] + Math.cos(g.ang) * g.R, g.c[1] + 0.08 * Math.sin(g.ang * 2), g.c[2] + Math.sin(g.ang) * g.R];
            for (let k = 0; k < 3; k++) g.p[k] += (tp[k] - g.p[k]) * Math.min(1, dt * 1.5);
            g.bank = -Math.sign(g.w) * 0.45;
            const cyc = (Life.t * 0.25 + g.size * 50) % 1;
            g.flapAmp = cyc < 0.3 ? 0.75 : 0.05;
            g.fold = 0;
            if (g.timer <= 0) {
              const free = perches.filter(p => !gulls.some(o => o.perch === p));
              if (free.length && rnd() < 0.7) {
                g.perch = free[Math.floor(rnd() * free.length)];
                g.state = 'approach'; g.t = 0; g.from = g.p.slice();
                const pp = g.perch.get();
                g.dur = Math.max(2.5, Math.hypot(pp[0] - g.p[0], pp[2] - g.p[2]) / 0.45);
              } else { g.timer = 5 + rnd() * 8; g.c = [(rnd() - 0.5) * 3, 0.9 + rnd() * 0.6, (rnd() - 0.3) * 2.6]; }
            }
            break;
          }
          case 'approach': {
            const pp = g.perch.get();
            const u = Math.min(1, g.t / g.dur);
            const ctrl = [(g.from[0] + pp[0]) / 2, Math.max(g.from[1], pp[1]) + 0.25, (g.from[2] + pp[2]) / 2];
            const e = u * u * (3 - 2 * u);
            g.p = bezier(g.from, ctrl, [pp[0], pp[1] + 0.012, pp[2]], e);
            g.flapAmp = u > 0.8 ? 1.1 : 0.15; g.bank *= 0.95; g.fold = 0;
            if (u >= 1) { g.state = 'perched'; g.timer = 8 + rnd() * 20; }
            break;
          }
          case 'perched': {
            const pp = g.perch.get();
            g.p = [pp[0], pp[1] + 0.012, pp[2]];
            g.flapAmp = 0; g.bank = 0; g.fold = Math.min(1, g.fold + dt * 3);
            if (g.perch.yawFn) g.yaw = g.perch.yawFn() + (g.perch.yaw || 0);
            if (g.timer <= 0) takeoff(g);
            break;
          }
          case 'takeoff': {
            const u = Math.min(1, g.t / 2.2);
            const tp = [g.c[0] + Math.cos(g.ang) * g.R, g.c[1], g.c[2] + Math.sin(g.ang) * g.R];
            const ctrl = [g.from[0], g.from[1] + 0.35, g.from[2]];
            g.p = bezier(g.from, ctrl, tp, u * u * (3 - 2 * u));
            g.flapAmp = 1.15; g.fold = Math.max(0, g.fold - dt * 4);
            if (u >= 1) { g.state = 'fly'; g.timer = 6 + rnd() * 12; }
            break;
          }
          case 'dive': {
            const target = food.find(f => f.state === 'float') || food[0];
            if (!target) { g.state = 'takeoff'; g.t = 0; g.from = g.p.slice(); break; }
            const tp = [target.x, (target.y || sim.level) + 0.02, target.z];
            const d = [tp[0] - g.p[0], tp[1] - g.p[1], tp[2] - g.p[2]];
            const dl = Math.hypot(d[0], d[1], d[2]);
            const sp = 1.0;
            for (let k = 0; k < 3; k++) g.p[k] += d[k] / (dl + 1e-5) * Math.min(dl, sp * dt);
            g.flapAmp = 0.2; g.fold = 0.3;
            if (dl < 0.03) {
              sim.splash(tp[0], tp[2], 0.006, 0.03, 0.5);
              Life.splash(tp[0], tp[1], tp[2], 0.4);
              const ix = food.indexOf(target); if (ix >= 0) food.splice(ix, 1);
              g.state = 'takeoff'; g.t = 0; g.from = g.p.slice();
            }
            break;
          }
        }
        const dx = g.p[0] - prev[0], dy = g.p[1] - prev[1], dz = g.p[2] - prev[2];
        if (g.state !== 'perched' && Math.hypot(dx, dz) > 1e-5) g.yaw += wrapAngle(Math.atan2(dz, dx) - g.yaw) * Math.min(1, dt * 6);
        g.pitch = g.state === 'perched' ? 0 : clamp(Math.atan2(dy, Math.hypot(dx, dz) + 1e-5), -0.6, 0.6);
        g.flap += dt * (g.flapAmp > 0.3 ? 11 : 3);
      }
    }

    function updateParticles(dt, core, events) {
      const t = core.tug;
      const smokeRate = reduced ? 3 : 7 * t.smoke;
      Life.smokeAcc = (Life.smokeAcc || 0) + dt * smokeRate;
      while (Life.smokeAcc > 1) {
        Life.smokeAcc -= 1;
        const r = qrot(t.q, [-0.035, 0.165, 0]);
        emit({ p: [t.x + r[0], t.y + r[1], t.z + r[2]], v: [(rnd() - 0.5) * 0.02, 0.09 + rnd() * 0.04, (rnd() - 0.5) * 0.02], life: 0, max: 2.2, size: 0.012, grow: 0.03, col: [0.35, 0.34, 0.34, 0.5], kind: 0, g: 0 });
      }
      if (Life.steam > 0) {
        Life.steam -= dt;
        for (let k = 0; k < (reduced ? 1 : 3); k++) {
          const p = core.shipWorld([-0.655, 0.47, 0]);
          emit({ p, v: [(rnd() - 0.5) * 0.06, 0.28 + rnd() * 0.12, (rnd() - 0.5) * 0.06], life: 0, max: 1.8, size: 0.018, grow: 0.06, col: [1, 1, 1, 0.55], kind: 0, g: -0.05 });
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life > p.max) { particles.splice(i, 1); continue; }
        p.v[1] -= p.g * dt;
        p.p[0] += p.v[0] * dt + (p.kind === 0 ? 0.03 * dt : 0); p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
        p.size += p.grow * dt;
        if (p.water && p.v[1] < 0 && p.p[1] < sim.height(p.p[0], p.p[2])) { particles.splice(i, 1); }
      }
      for (let i = scatters.length - 1; i >= 0; i--) { scatters[i].life -= dt; if (scatters[i].life <= 0) scatters.splice(i, 1); }
    }

    Life.finger = (x, y, z) => { scatters.push({ x, y: y - 0.08, z, r: 0.45, s: 2.0, life: 0.4 }); };
    Life.horn = () => { Life.steam = 2.2; Life.scareGulls(); };

    Life.update = (dt, core) => {
      Life.t += dt;
      updateFloaters(dt);
      updateBuoys(dt, core);
      updateFood(dt);
      updateFish(dt, core);
      updateJellies(dt, core);
      updateGulls(dt);
      updateParticles(dt, core);
    };

    Life.writeFish = (arr) => {
      let n = 0;
      for (const f of fish) {
        const o = n * 12;
        arr[o] = f.p[0]; arr[o + 1] = f.p[1]; arr[o + 2] = f.p[2]; arr[o + 3] = f.yaw;
        arr[o + 4] = f.pitch; arr[o + 5] = 0; arr[o + 6] = f.size; arr[o + 7] = f.ph;
        arr[o + 8] = species[f.school].col; arr[o + 9] = 0; arr[o + 10] = 0; arr[o + 11] = 0;
        n++;
      }
      return n;
    };
    Life.writeGulls = (arr) => {
      let n = 0;
      for (const g of gulls) {
        const o = n * 12;
        arr[o] = g.p[0]; arr[o + 1] = g.p[1] + (g.state === 'perched' ? g.size * 0.15 : 0); arr[o + 2] = g.p[2]; arr[o + 3] = g.yaw;
        arr[o + 4] = g.pitch * 0.5; arr[o + 5] = g.bank; arr[o + 6] = g.size; arr[o + 7] = g.flap;
        arr[o + 8] = 0; arr[o + 9] = g.flapAmp; arr[o + 10] = 1; arr[o + 11] = g.fold * -1.1;
        n++;
      }
      return n;
    };
    Life.writeJellies = (arr) => {
      let n = 0;
      for (const j of jellies) {
        const o = n * 12;
        arr[o] = j.p[0]; arr[o + 1] = j.p[1]; arr[o + 2] = j.p[2]; arr[o + 3] = j.yaw;
        arr[o + 4] = j.tilt; arr[o + 5] = j.tilt * 0.6; arr[o + 6] = j.size; arr[o + 7] = j.ph;
        arr[o + 8] = j.seed; arr[o + 9] = 0; arr[o + 10] = 0; arr[o + 11] = 0;
        n++;
      }
      return n;
    };
    Life.writeParticles = (arr, max) => {
      let n = 0;
      const put = (x, y, z, size, r, g, b, a, kind, rot) => {
        if (n >= max) return;
        const o = n * 12;
        arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; arr[o + 3] = size;
        arr[o + 4] = r; arr[o + 5] = g; arr[o + 6] = b; arr[o + 7] = a;
        arr[o + 8] = kind; arr[o + 9] = rot; arr[o + 10] = 0; arr[o + 11] = 0;
        n++;
      };
      for (const p of particles) {
        const u = p.life / p.max;
        const a = p.col[3] * (p.kind === 0 ? Math.sin(Math.min(1, u) * Math.PI) : 1 - u * u);
        put(p.p[0], p.p[1], p.p[2], p.size, p.col[0], p.col[1], p.col[2], a, p.kind, p.life * 0.5);
      }
      for (const f of food) put(f.x, f.y + 0.003, f.z, 0.005, 0.45, 0.3, 0.15, 1, 1, 0);
      const t = Life.t;
      for (const b of bubbles) {
        const y = b.y + Math.sin(t * 0.3 + b.ph) * 0.01;
        put(b.x + Math.sin(t * 0.5 + b.ph) * 0.004, Math.min(y, sim.level - 0.02), b.z, b.r, 0.9, 0.97, 1.0, 0.7, 2, 0);
      }
      return n;
    };

    Life.buoys = buoys; Life.yachts = yachts; Life.mbuoys = mbuoys; Life.gbuoy = gbuoy; Life.fboats = fboats;
    Life.fish = fish; Life.gulls = gulls; Life.jellies = jellies; Life.food = food; Life.particles = particles;
    Life.init = initGulls;
    Life.BR = BR;
    return Life;
  }

  root.HarborLife = { create, Floater };
})(typeof window !== 'undefined' ? window : globalThis);
