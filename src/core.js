(function (root) {
  'use strict';

  const K = {
    HALF: 2.6, QUAY_Z: -0.7, LAND_Y: 0.12, BOTTOM_Y: -1.0, SEABED: -0.55, SPLIT_X: 0.6,
    FENDER_Z: -0.67,
    BOX_L: 0.148, BOX_L40: 0.304, BOX_W: 0.06, BOX_H: 0.064,
    RAIL_W: -0.78, RAIL_L: -1.08, HINGE_Z: -0.8,
    BOOM_Y: 0.64, SAFE_Y: 0.46, CLEAR_Y: 0.4, MIN_SEP: 0.3, LEG_HALF: 0.13,
    TROLLEY_PARK: -0.93, BOOM_UP: 1.25,
    YARD_LANES: [-1.18, -1.25, -1.32],
    PARK_X: [-2.25, 0.15],
    TIDE_MAX: 0.1,
  };
  const SHIP = { L: 1.46, B: 0.3, draft: 0.11, half: 0.73, deckY: 0.06, hatchY: 0.075, bollard: 0.66 };
  const TUG = { L: 0.3, B: 0.12, draft: 0.07, half: 0.15, hook: -0.13, nose: 0.17 };
  const BERTH = { x: -1.15, z: -0.52, psi: 0 };
  const TOW_END = { x: -1.05, z: -0.25, psi: 0.35 };
  const ARRIVE = { x: -1.15, z: -0.15, psi: 0 };
  const TUG_HOME = { x: 1.1, z: -0.45 };
  const STANDBY = { x: -0.72, z: 0.78 };
  const LINE_LEN = 0.26;
  const TOW_START_PSI = 0.3;

  const LAYOUT = {
    pier: { x0: 1.82, x1: 1.98, z0: -0.7, z1: 0.25 },
    breakwater: { a: [2.62, 1.0], b: [1.45, 0.62] },
    lighthouse: [1.45, 0.62],
    yachts: [
      { buoy: [-1.0, 2.25], rope: 0.08, len: 0.22, beam: 0.07, hue: 0 },
      { buoy: [0.3, 2.22], rope: 0.08, len: 0.2, beam: 0.065, hue: 1 },
    ],
    channelBuoy: [1.02, 1.55],
    fishingBoats: [
      { x: 1.735, z: -0.32, psi: Math.PI / 2, L: 0.24, B: 0.08 },
      { x: 2.065, z: -0.1, psi: Math.PI / 2, L: 0.22, B: 0.075 },
    ],
  };
  LAYOUT.yachts.forEach(y => { y.swing = y.rope + y.len * 0.5 + 0.03; });

  const LIVERIES = 10;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function qmul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }
  function qaxis(ax, ay, az, ang) {
    const s = Math.sin(ang / 2);
    return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
  }
  function qrot(q, v) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + y * tz - z * ty,
      v[1] + w * ty + z * tx - x * tz,
      v[2] + w * tz + x * ty - y * tx,
    ];
  }
  const qyaw = psi => qaxis(0, 1, 0, -psi);

  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  }

  function landH(x, z) {
    const t = clamp((-1.8 - z) / 0.8, 0, 1);
    return K.LAND_Y + 0.5 * Math.pow(t, 1.15) + 0.04 * t * Math.sin(x * 2.1 + 0.6);
  }
  function seabedH(x, z) {
    let h = K.SEABED + 0.025 * Math.sin(x * 1.9 + z * 0.7) * Math.sin(z * 2.3 - 0.4) + 0.02 * Math.sin(x * 5.1 + z * 3.7);
    const bw = LAYOUT.breakwater;
    const d = segDist(x, z, bw.a[0], bw.a[1], bw.b[0], bw.b[1]);
    const mound = 0.1 - Math.max(0, d - 0.07) * 1.3;
    return Math.max(h, mound);
  }
  function terrainH(x, z) {
    if (z < K.QUAY_Z) return landH(x, z);
    return seabedH(x, z);
  }

  function makePath(pts, startPsi, endPsi) {
    const P = pts.map(p => [p[0], p[1]]);
    const d0 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
    const n = P.length;
    const dn = Math.hypot(P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]);
    const pre = startPsi == null
      ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]]
      : [P[0][0] - Math.cos(startPsi) * d0, P[0][1] - Math.sin(startPsi) * d0];
    const post = endPsi == null
      ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]]
      : [P[n - 1][0] + Math.cos(endPsi) * dn, P[n - 1][1] + Math.sin(endPsi) * dn];
    const Q = [pre, ...P, post];
    const xs = [], zs = [];
    const STEPS = 48;
    for (let i = 1; i < Q.length - 2; i++) {
      const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
      for (let k = 0; k < STEPS; k++) {
        const t = k / STEPS, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        xs.push(f(p0[0], p1[0], p2[0], p3[0]));
        zs.push(f(p0[1], p1[1], p2[1], p3[1]));
      }
    }
    xs.push(P[n - 1][0]); zs.push(P[n - 1][1]);
    const s = [0];
    for (let i = 1; i < xs.length; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    const len = s[s.length - 1];
    function at(sq) {
      sq = clamp(sq, 0, len);
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= sq) lo = m; else hi = m; }
      const f = (sq - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
      const x = xs[lo] + (xs[hi] - xs[lo]) * f, z = zs[lo] + (zs[hi] - zs[lo]) * f;
      const a = Math.max(0, lo - 2), b = Math.min(xs.length - 1, hi + 2);
      const psi = Math.atan2(zs[b] - zs[a], xs[b] - xs[a]);
      return { x, z, psi };
    }
    return { len, at, xs, zs };
  }

  function approach(cur, vel, target, vmax, acc, dt) {
    const d = target - cur;
    if (Math.abs(d) < 1e-5 && Math.abs(vel) < 1e-3) return [target, 0];
    const desired = Math.sign(d) * Math.min(vmax, Math.sqrt(2 * acc * Math.abs(d)));
    const maxdv = acc * dt;
    vel += clamp(desired - vel, -maxdv, maxdv);
    let next = cur + vel * dt;
    if ((target - next) * d < 0 && Math.abs(vel) < acc * dt * 6) { next = target; vel = 0; }
    if (Math.abs(target - next) < 2e-4 && Math.abs(vel) < acc * dt * 2) { next = target; vel = 0; }
    return [next, vel];
  }

  function bodyPoint(b, lx, lz) {
    const c = Math.cos(b.psi), s = Math.sin(b.psi);
    return [b.x + c * lx - s * lz, b.z + s * lx + c * lz];
  }

  function obbSigned(b, half, beam, px, pz) {
    const c = Math.cos(b.psi), s = Math.sin(b.psi);
    const dx = px - b.x, dz = pz - b.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    const qx = Math.abs(lx) - half, qz = Math.abs(lz) - beam / 2;
    const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
  }

  function hullPoints(b, half, beam, nl, nb) {
    const pts = [];
    for (let i = 0; i <= nl; i++) {
      const lx = -half + (2 * half * i) / nl;
      for (let j = 0; j <= nb; j++) {
        const lz = -beam / 2 + (beam * j) / nb;
        pts.push(bodyPoint(b, lx, lz));
      }
    }
    return pts;
  }

  function create(opts) {
    opts = opts || {};
    const rnd = mulberry32(opts.seed == null ? 1234 : opts.seed);
    const S = {
      t: 0, tide: 0, cycle: 1, phase: 'unload', phaseT: 0,
      tally: { boxes: 0, voyages: 0 },
      castOffRequested: false, hurry: false,
      towing: false, pushing: false, hornAt: -1,
      events: [],
      unload: { target: 8, assigned: 0, done: 0, perBay: [0, 0, 0, 0, 0, 0] },
      load: { target: 8, assigned: 0, done: 0, perBay: [0, 0, 0, 0, 0, 0] },
      lapStart: 0,
      cycleStartT: 0, cycleDurations: [],
    };

    const ship = {
      x: BERTH.x, z: BERTH.z, psi: BERTH.psi, y: 0, heave: 0, vh: 0, pitch: 0, vp: 0, roll: 0, vr: 0,
      vx: 0, vz: 0, speed: 0, turn: 0, mode: 'berth', path: null, s: 0, v: 0, q: [0, 0, 0, 1], wash: 0, radar: 0, prop: 0,
      half: SHIP.half, beam: SHIP.B, draft: SHIP.draft, towT: 0, pushT: 0,
    };
    const tug = {
      x: TUG_HOME.x, z: TUG_HOME.z, psi: Math.PI, y: 0, heave: 0, vh: 0, pitch: 0, vp: 0, roll: 0, vr: 0,
      vx: 0, vz: 0, speed: 0, turn: 0, q: [0, 0, 0, 1], wash: 0, prop: 0, w: 0, v: 0,
      half: TUG.half, beam: TUG.B, draft: TUG.draft,
      queue: [], act: null, attached: false, smoke: 0, standby: false, home: true,
    };

    const bayLX = b => -0.342 + 0.155 * b;
    const rowLZ = r => (r - 1.5) * 0.068;
    const bayWX = b => BERTH.x + bayLX(b);

    const containers = [];
    const shipGrid = [], yardGrid = [];
    for (let b = 0; b < 6; b++) {
      shipGrid.push([]); yardGrid.push([]);
      for (let r = 0; r < 4; r++) {
        const st = [];
        for (let t = 0; t < 2; t++) {
          const c = { id: containers.length, livery: Math.floor(rnd() * LIVERIES), len: 20, where: 'ship', cycle: 0 };
          containers.push(c); st.push(c.id);
        }
        shipGrid[b].push(st);
      }
      for (let l = 0; l < 3; l++) yardGrid[b].push([]);
    }
    const exportSlots = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [1, 1], [4, 1]];
    for (const [b, l] of exportSlots) {
      const c = { id: containers.length, livery: Math.floor(rnd() * LIVERIES), len: 20, where: 'yard', cycle: 0 };
      containers.push(c); yardGrid[b][l].push(c.id);
    }
    const dynamicCount = containers.length;

    const statics = [];
    const staticLanes = [-1.45, -1.52, -1.59, -1.66, -1.73];
    for (const lz of staticLanes) {
      let x = -2.5;
      let blockN = 0;
      while (x < 0.02) {
        const forty = rnd() < 0.4;
        const L = forty ? K.BOX_L40 : K.BOX_L;
        if (x + L > 0.05) break;
        const tiers = 2 + Math.floor(rnd() * 3);
        const liv = Math.floor(rnd() * LIVERIES);
        for (let t = 0; t < tiers; t++) {
          const c = {
            id: containers.length, livery: rnd() < 0.35 ? liv : Math.floor(rnd() * LIVERIES), len: forty ? 40 : 20,
            where: 'static', pos: [x + L / 2, K.LAND_Y + t * K.BOX_H, lz], yaw: 0,
          };
          containers.push(c); statics.push(c.id);
        }
        x += L + 0.008;
        blockN++;
        if (blockN % 6 === 0) x += 0.06;
      }
    }

    const cranes = [0, 1].map(i => ({
      i, x: i === 0 ? -1.8 : -0.35, vx: 0, tz: K.TROLLEY_PARK, vz: 0, sy: K.SAFE_Y, vy: 0, boom: 0, vb: 0,
      targetX: i === 0 ? -1.8 : -0.35, job: null, step: 0, timer: 0, held: -1, latched: false,
    }));

    function shipWorld(lp) {
      const r = qrot(ship.q, lp);
      return [r[0] + ship.x, r[1] + ship.y, r[2] + ship.z];
    }
    function shipSlotTop(b, r, tier) {
      return shipWorld([bayLX(b), SHIP.hatchY + (tier + 1) * K.BOX_H, rowLZ(r)]);
    }

    function setPhase(p) { S.phase = p; S.phaseT = 0; }

    function shipWork(kind) {
      const list = [];
      for (let b = 0; b < 6; b++) {
        if (kind === 'unload') {
          let rows = [];
          for (let r = 0; r < 4; r++) if (shipGrid[b][r].length) rows.push(r);
          const lanes = [];
          for (let l = 0; l < 3; l++) {
            const st = yardGrid[b][l];
            if (st.length < 2 && (!st.length || st[st.length - 1] < 0 || containers[st[st.length - 1]].cycle === S.cycle)) lanes.push(l);
          }
          if (!rows.length || !lanes.length) continue;
          const maxH = Math.max(...rows.map(r => shipGrid[b][r].length));
          rows = rows.filter(r => shipGrid[b][r].length === maxH);
          list.push({ b, rows, lanes });
        } else {
          const lanes = [];
          for (let l = 0; l < 3; l++) {
            const st = yardGrid[b][l];
            if (st.length && containers[st[st.length - 1]].cycle !== S.cycle) lanes.push(l);
          }
          const rows = [];
          for (let r = 0; r < 4; r++) if (shipGrid[b][r].length < 2) rows.push(r);
          if (!rows.length || !lanes.length) continue;
          const minH = Math.min(...rows.map(r => shipGrid[b][r].length));
          list.push({ b, rows: rows.filter(r => shipGrid[b][r].length === minH), lanes });
        }
      }
      return list;
    }

    function pickLane(b, lanes) {
      let best = lanes[0], bestScore = -1e9;
      for (const l of lanes) {
        const st = yardGrid[b][l];
        let score = st.length === 0 ? 2 : (containers[st[st.length - 1]].cycle === S.cycle ? 1 : -2);
        score += rnd() * 0.5;
        if (score > bestScore) { bestScore = score; best = l; }
      }
      return best;
    }

    function workPhase() { return S.phase === 'unload' || S.phase === 'load'; }
    function phaseCounter() { return S.phase === 'unload' ? S.unload : S.load; }

    function remainingWork() {
      if (!workPhase() || S.castOffRequested) return [];
      const pc = phaseCounter();
      if (pc.assigned >= pc.target) return [];
      return shipWork(S.phase);
    }

    function claimJob(cr, other) {
      let work = remainingWork();
      if (!work.length) return 'none';
      const used = S.phase === 'unload' ? S.unload.perBay : S.load.perBay;
      const eligible = b => yardGrid[b].reduce((n, st) => n + st.filter(id => id >= 0 && containers[id].cycle !== S.cycle).length, 0);
      if (S.phase === 'unload') {
        const quota = work.filter(w => used[w.b] < eligible(w.b));
        if (quota.length) work = quota;
      }
      const lo = Math.min(other.x, other.targetX), hi = Math.max(other.x, other.targetX);
      const feasible = work.filter(w => {
        const x = bayWX(w.b);
        if (other.job && other.job.b === w.b) return false;
        return cr.i === 0 ? x <= lo - K.MIN_SEP : x >= hi + K.MIN_SEP;
      });
      if (!feasible.length) return 'blocked';
      const score = w => used[w.b] * 2 + Math.abs(bayWX(w.b) - cr.x) + (cr.i === 0 ? w.b : 5 - w.b) * 0.05;
      feasible.sort((a, c) => score(a) - score(c));
      const w = feasible[0];
      used[w.b]++;
      const r = w.rows[Math.floor(rnd() * w.rows.length)];
      const pc = phaseCounter();
      pc.assigned++;
      let job;
      if (S.phase === 'unload') {
        const l = pickLane(w.b, w.lanes);
        const st = shipGrid[w.b][r];
        const id = st.pop();
        const tier = yardGrid[w.b][l].length;
        yardGrid[w.b][l].push(-1);
        job = { kind: 'unload', b: w.b, id, src: { type: 'ship', r, tier: st.length }, dst: { type: 'yard', l, tier } };
      } else {
        const l = w.lanes[Math.floor(rnd() * w.lanes.length)];
        const st = yardGrid[w.b][l];
        const id = st.pop();
        const tier = shipGrid[w.b][r].length;
        shipGrid[w.b][r].push(-1);
        job = { kind: 'load', b: w.b, id, src: { type: 'yard', l, tier: st.length }, dst: { type: 'ship', r, tier } };
      }
      containers[job.id].pending = job;
      cr.job = job; cr.step = 0; cr.timer = 0; cr.targetX = bayWX(w.b);
      return 'ok';
    }

    function slotZ(p) { return p.type === 'ship' ? BERTH.z + rowLZ(p.r) : K.YARD_LANES[p.l]; }
    function slotTop(b, p) {
      if (p.type === 'ship') return shipSlotTop(b, p.r, p.tier)[1];
      return K.LAND_Y + (p.tier + 1) * K.BOX_H;
    }

    function moveCrane(cr, gx, gz, gy, dt) {
      [cr.x, cr.vx] = approach(cr.x, cr.vx, gx, 0.5, 1.2, dt);
      [cr.tz, cr.vz] = approach(cr.tz, cr.vz, gz, 1.5, 3.2, dt);
      [cr.sy, cr.vy] = approach(cr.sy, cr.vy, gy, 1.0, 3.2, dt);
    }

    function stepCrane(cr, other, dt) {
      const boomTarget = (S.phase === 'boomsUp' || S.phase === 'tugComing' || S.phase === 'tow' || S.phase === 'release' || S.phase === 'atSea' || S.phase === 'berthing') ? 1 : (S.phase === 'boomsDown' || workPhase() ? 0 : cr.boom);
      if (!cr.job) {
        let state = 'none';
        if (cr.boom < 0.001) state = claimJob(cr, other);
        if (state !== 'ok') {
          let gx = cr.x;
          if (state === 'blocked') gx = K.PARK_X[cr.i];
          cr.targetX = gx;
          const gy = Math.max(cr.sy, K.SAFE_Y);
          moveCrane(cr, gx, K.TROLLEY_PARK, gy, dt);
          const trolleyHome = Math.abs(cr.tz - K.TROLLEY_PARK) < 0.002;
          if (trolleyHome || cr.boom > 0) {
            [cr.boom, cr.vb] = approach(cr.boom, cr.vb, trolleyHome ? boomTarget : cr.boom, 0.45, 0.8, dt);
          }
          return;
        }
      }
      const j = cr.job;
      const jx = bayWX(j.b);
      const sz = slotZ(j.src), dz = slotZ(j.dst);
      switch (cr.step) {
        case 0:
          moveCrane(cr, jx, cr.tz, K.SAFE_Y, dt);
          if (cr.x === jx && cr.sy >= K.CLEAR_Y) cr.step = 1;
          break;
        case 1:
          moveCrane(cr, jx, sz, K.SAFE_Y, dt);
          if (cr.tz === sz && cr.sy > K.SAFE_Y - 0.01) cr.step = 2;
          break;
        case 2: {
          const ty = slotTop(j.b, j.src);
          moveCrane(cr, jx, sz, ty, dt);
          if (Math.abs(cr.sy - ty) < 0.0025) { cr.step = 3; cr.timer = 0; }
          break;
        }
        case 3: {
          const ty = slotTop(j.b, j.src);
          cr.sy = ty; cr.vy = 0;
          cr.timer += dt;
          if (cr.timer > 0.25) {
            const c = containers[j.id];
            c.where = 'crane'; c.crane = cr.i; c.pending = null;
            cr.held = j.id; cr.step = 4;
            S.events.push({ type: 'latch', crane: cr.i });
          }
          break;
        }
        case 4:
          moveCrane(cr, jx, sz, K.SAFE_Y, dt);
          if (cr.sy >= K.CLEAR_Y) cr.step = 5;
          break;
        case 5:
          moveCrane(cr, jx, dz, K.SAFE_Y, dt);
          if (cr.tz === dz && cr.sy > K.SAFE_Y - 0.01) cr.step = 6;
          break;
        case 6: {
          const ty = slotTop(j.b, j.dst);
          moveCrane(cr, jx, dz, ty, dt);
          if (Math.abs(cr.sy - ty) < 0.0025) { cr.step = 7; cr.timer = 0; }
          break;
        }
        case 7: {
          const ty = slotTop(j.b, j.dst);
          cr.sy = ty; cr.vy = 0;
          cr.timer += dt;
          if (cr.timer > 0.25) {
            const c = containers[j.id];
            if (j.dst.type === 'ship') {
              const st = shipGrid[j.b][j.dst.r];
              st[st.indexOf(-1)] = j.id;
              c.where = 'ship';
            } else {
              const st = yardGrid[j.b][j.dst.l];
              st[st.indexOf(-1)] = j.id;
              c.where = 'yard';
              c.cycle = S.cycle;
            }
            cr.held = -1; cr.step = 8;
            S.tally.boxes++;
            (j.kind === 'unload' ? S.unload : S.load).done++;
            S.events.push({ type: 'unlatch', crane: cr.i });
          }
          break;
        }
        case 8:
          moveCrane(cr, jx, dz, K.SAFE_Y, dt);
          if (cr.sy >= K.CLEAR_Y) { cr.job = null; cr.step = 0; }
          break;
      }
    }

    function craneIdle(cr) { return !cr.job; }
    function cranesParked() {
      return cranes.every(c => !c.job && Math.abs(c.tz - K.TROLLEY_PARK) < 0.002 && c.sy >= K.SAFE_Y - 0.002);
    }

    function startUnload() {
      setPhase('unload');
      S.unload = { target: 8, assigned: 0, done: 0, perBay: [0, 0, 0, 0, 0, 0] };
      S.load = { target: 8, assigned: 0, done: 0, perBay: [0, 0, 0, 0, 0, 0] };
      S.castOffRequested = false;
    }

    function tugPush(a) { tug.queue.push(a); }
    function tugIdle() { return !tug.act && !tug.queue.length && !tug.attached; }

    function tugStep(dt) {
      if (tug.attached) return;
      if (!tug.act) {
        if (!tug.queue.length) { tug.w = 0; tug.v = approach(tug.v, 0, 0, 1, 1, dt)[0]; tug.wash *= Math.exp(-dt * 2); return; }
        const a = tug.queue.shift();
        if (a.type === 'path') {
          const pts = [[tug.x, tug.z], ...a.pts];
          a.path = makePath(pts, null, a.endPsi);
          a.s = 0; a.v = 0;
          const p0 = a.path.at(0.02);
          if (Math.abs(wrapAngle(p0.psi - tug.psi)) > 0.03) {
            tug.queue.unshift(a);
            tug.act = { type: 'pivot', psi: p0.psi, w: 0 };
            return;
          }
        }
        if (a.type === 'pivot') a.w = 0;
        if (a.type === 'reverse') { a.d = 0; a.v = 0; }
        if (a.type === 'wait') a.t = a.t || 0;
        tug.act = a;
      }
      const a = tug.act;
      tug.wash = Math.max(0, tug.wash - dt * 0.8);
      if (a.type === 'pivot') {
        const target = tug.psi + wrapAngle(a.psi - tug.psi);
        const [p, w] = approach(tug.psi, a.w, target, 1.3, 1.8, dt);
        tug.psi = wrapAngle(p); a.w = w; tug.w = w;
        tug.wash = Math.max(tug.wash, Math.min(1, Math.abs(w)));
        if (p === target) { tug.act = null; tug.w = 0; }
      } else if (a.type === 'path') {
        const vmax = a.vmax || 0.32;
        const remain = a.path.len - a.s;
        const desired = Math.min(vmax, Math.sqrt(2 * 0.25 * Math.max(0, remain)) + 0.004);
        a.v += clamp(desired - a.v, -0.25 * dt, 0.25 * dt);
        a.s = Math.min(a.path.len, a.s + a.v * dt);
        const p = a.path.at(a.s);
        tug.x = p.x; tug.z = p.z; tug.psi = p.psi;
        tug.wash = Math.max(tug.wash, a.v / vmax);
        a.progress = a.s / a.path.len;
        if (a.s >= a.path.len - 1e-5) { tug.act = null; if (a.onDone) a.onDone(); }
      } else if (a.type === 'reverse') {
        const remain = a.dist - a.d;
        const desired = Math.min(0.14, Math.sqrt(2 * 0.2 * remain) + 0.003);
        a.v += clamp(desired - a.v, -0.2 * dt, 0.2 * dt);
        const step = Math.min(remain, a.v * dt);
        a.d += step;
        tug.x -= Math.cos(tug.psi) * step; tug.z -= Math.sin(tug.psi) * step;
        tug.wash = Math.max(tug.wash, 0.8);
        if (a.d >= a.dist - 1e-6) tug.act = null;
      } else if (a.type === 'wait') {
        a.t -= dt;
        if (a.t <= 0) tug.act = null;
      }
    }

    function towStartTug() {
      const bx = BERTH.x + Math.cos(BERTH.psi) * SHIP.bollard, bz = BERTH.z + Math.sin(BERTH.psi) * SHIP.bollard;
      const a = TOW_START_PSI;
      const hx = bx + Math.cos(a) * LINE_LEN, hz = bz + Math.sin(a) * LINE_LEN;
      return { x: hx - Math.cos(a) * TUG.hook, z: hz - Math.sin(a) * TUG.hook, psi: a };
    }

    const lapPts = (() => {
      const d = 0.7;
      const p1 = [TOW_END.x + Math.cos(TOW_END.psi) * d, TOW_END.z + Math.sin(TOW_END.psi) * d];
      return [[TOW_END.x, TOW_END.z], p1, [0.28, 0.38], [0.6, 0.98], [0.32, 1.48], [-0.5, 1.64], [-1.5, 1.42], [-2.0, 0.82], [-1.86, 0.16], [ARRIVE.x, ARRIVE.z]];
    })();
    const LAP = makePath(lapPts, TOW_END.psi, ARRIVE.psi);

    const tugRoutes = {
      toTow: () => { const p = towStartTug(); return [[0.5, -0.42], [p.x, p.z]]; },
      home: [[0.5, -0.12], [TUG_HOME.x, TUG_HOME.z]],
      standby: [[0.55, -0.36], [0.05, 0.12], [-0.42, 0.55], [STANDBY.x, STANDBY.z]],
      noseIn: () => [[-1.05, 0.62], [ARRIVE.x, 0.42], [ARRIVE.x, ARRIVE.z + SHIP.B / 2 + TUG.nose]],
      homeFromPush: [[-0.5, 0.24], [0.4, -0.22], [TUG_HOME.x, TUG_HOME.z]],
    };

    function updateFloat(b, sample, dt, half, beam) {
      const P = (lx, lz) => { const p = bodyPoint(b, lx, lz); return sample(p[0], p[1]); };
      const hb = P(half * 0.75, 0), hs = P(-half * 0.75, 0), hp = P(0, -beam * 0.5), hq = P(0, beam * 0.5), hc = P(0, 0);
      const mean = (hb + hs + hp + hq + 2 * hc) / 6;
      const pT = Math.atan2(hb - hs, 1.5 * half);
      const rT = -Math.atan2(hq - hp, beam) + clamp(-b.turn * b.speed * 1.6, -0.08, 0.08);
      const k = 60, c = 9;
      b.vh += (k * (mean - b.heave) - c * b.vh) * dt; b.heave += b.vh * dt;
      b.vp += (k * (pT - b.pitch) - c * b.vp) * dt; b.pitch += b.vp * dt;
      b.vr += (40 * (rT - b.roll) - 5 * b.vr) * dt; b.roll += b.vr * dt;
      b.y = b.heave;
      b.q = qmul(qmul(qyaw(b.psi), qaxis(0, 0, 1, b.pitch)), qaxis(1, 0, 0, b.roll));
    }

    let prevShip = { x: ship.x, z: ship.z, psi: ship.psi };
    let prevTug = { x: tug.x, z: tug.z, psi: tug.psi };

    function shipMode(dt) {
      if (ship.mode === 'berth') {
        ship.x = BERTH.x; ship.z = BERTH.z; ship.psi = BERTH.psi;
      } else if (ship.mode === 'tow') {
        ship.towT += dt;
        const u = clamp(ship.towT / 7, 0, 1);
        const ez = smooth(u), ep = Math.pow(smooth(u), 1.6);
        ship.x = BERTH.x + (TOW_END.x - BERTH.x) * ez;
        ship.z = BERTH.z + (TOW_END.z - BERTH.z) * ez;
        ship.psi = BERTH.psi + (TOW_END.psi - BERTH.psi) * ep;
        const bx = ship.x + Math.cos(ship.psi) * SHIP.bollard, bz = ship.z + Math.sin(ship.psi) * SHIP.bollard;
        const a = TOW_START_PSI + (0.72 - TOW_START_PSI) * smooth(u);
        const hx = bx + Math.cos(a) * LINE_LEN, hz = bz + Math.sin(a) * LINE_LEN;
        tug.x = hx - Math.cos(a) * TUG.hook; tug.z = hz - Math.sin(a) * TUG.hook; tug.psi = a;
        tug.wash = 1;
      } else if (ship.mode === 'lap') {
        const vmax = S.hurry ? 0.6 : 0.34;
        const remain = LAP.len - ship.s;
        const desired = Math.min(vmax, Math.sqrt(2 * 0.06 * Math.max(0, remain)) + 0.002);
        ship.v += clamp(desired - ship.v, -0.06 * dt, (S.hurry ? 0.09 : 0.05) * dt);
        ship.s = Math.min(LAP.len, ship.s + ship.v * dt);
        const p = LAP.at(ship.s);
        ship.x = p.x; ship.z = p.z; ship.psi = p.psi;
        ship.wash = ship.v / 0.3;
      } else if (ship.mode === 'arrived') {
        ship.x = ARRIVE.x; ship.z = ARRIVE.z; ship.psi = ARRIVE.psi;
      } else if (ship.mode === 'push') {
        ship.pushT += dt;
        const u = smooth(ship.pushT / 5.5);
        ship.x = ARRIVE.x; ship.psi = ARRIVE.psi;
        ship.z = ARRIVE.z + (BERTH.z - ARRIVE.z) * u;
        tug.x = ship.x; tug.z = ship.z + SHIP.B / 2 + TUG.nose; tug.psi = -Math.PI / 2;
        tug.wash = 1;
      }
    }

    function phaseLogic(dt) {
      S.phaseT += dt;
      switch (S.phase) {
        case 'unload': {
          const noWork = !remainingWork().length;
          if ((S.unload.done >= S.unload.target || noWork) && cranes.every(craneIdle)) {
            if (S.castOffRequested) setPhase('boomsUp');
            else { setPhase('load'); S.load = { target: 8, assigned: 0, done: 0, perBay: [0, 0, 0, 0, 0, 0] }; }
          }
          break;
        }
        case 'load': {
          const noWork = !remainingWork().length;
          if ((S.load.done >= S.load.target || noWork) && cranes.every(craneIdle)) setPhase('boomsUp');
          break;
        }
        case 'boomsUp':
          if (cranes.every(c => c.boom > 0.999)) {
            setPhase('tugComing');
            tugPush({ type: 'path', pts: tugRoutes.toTow(), vmax: 0.3 });
            tugPush({ type: 'pivot', psi: TOW_START_PSI });
            tugPush({ type: 'wait', t: 1.0 });
            tug.home = false;
          }
          break;
        case 'tugComing':
          if (tugIdle()) {
            const p = towStartTug();
            tug.x = p.x; tug.z = p.z; tug.psi = p.psi;
            setPhase('tow');
            tug.attached = true; S.towing = true;
            ship.mode = 'tow'; ship.towT = 0;
            S.events.push({ type: 'line', on: true });
          }
          break;
        case 'tow':
          if (ship.towT >= 7) {
            setPhase('release');
            S.towing = false; tug.attached = false;
            S.events.push({ type: 'line', on: false });
            ship.mode = 'lapWait'; ship.s = 0; ship.v = 0;
            tugPush({ type: 'wait', t: 0.6 });
            tugPush({ type: 'path', pts: tugRoutes.home, vmax: 0.34 });
            S.hornAt = -1;
          }
          break;
        case 'release': {
          const a = tug.act;
          const p = a && a.type === 'path' ? a.progress || 0 : (tugIdle() ? 1 : 0);
          if (S.hornAt < 0 && p >= 0.55) { S.hornAt = S.t; S.events.push({ type: 'horn', source: 'ship' }); }
          if (S.hornAt >= 0 && S.t - S.hornAt > 1.4) {
            setPhase('atSea'); ship.mode = 'lap'; S.lapStart = S.t; tug.home = true;
          }
          break;
        }
        case 'atSea': {
          const prog = ship.s / LAP.len;
          if (!tug.standby && tug.home && tugIdle() && prog >= 0.4) {
            tug.home = false; tug.standby = true;
            tugPush({ type: 'path', pts: tugRoutes.standby, vmax: 0.3 });
          }
          if (ship.s >= LAP.len - 1e-4 && ship.v < 0.01) {
            ship.mode = 'arrived'; ship.v = 0; ship.wash = 0;
            setPhase('berthing');
            S.berthStep = 'wait';
          }
          break;
        }
        case 'berthing': {
          if (S.berthStep === 'wait' && tugIdle() && tug.standby) {
            S.berthStep = 'nose';
            tugPush({ type: 'path', pts: tugRoutes.noseIn(), vmax: 0.3, endPsi: -Math.PI / 2 });
          } else if (S.berthStep === 'wait' && tugIdle() && !tug.standby) {
            tug.standby = true; tug.home = false;
            tugPush({ type: 'path', pts: tugRoutes.standby, vmax: 0.34 });
          } else if (S.berthStep === 'nose' && tugIdle()) {
            S.berthStep = 'push'; ship.mode = 'push'; ship.pushT = 0;
            tug.attached = true; S.pushing = true;
          } else if (S.berthStep === 'push' && ship.pushT >= 5.5) {
            ship.mode = 'berth'; S.pushing = false; tug.attached = false;
            S.berthStep = 'back';
            tugPush({ type: 'reverse', dist: 0.36 });
            S.events.push({ type: 'berthed' });
          } else if (S.berthStep === 'back' && tugIdle()) {
            tug.standby = false;
            tugPush({ type: 'path', pts: tugRoutes.homeFromPush, vmax: 0.32 });
            tug.home = true;
            S.tally.voyages++;
            S.hurry = false;
            setPhase('boomsDown');
          }
          break;
        }
        case 'boomsDown':
          if (cranes.every(c => c.boom < 0.001)) {
            S.cycleDurations.push(S.t - S.cycleStartT);
            S.cycleStartT = S.t;
            S.cycle++;
            startUnload();
          }
          break;
      }
    }

    function update(dt, sample) {
      dt = Math.min(dt, 1 / 20);
      sample = sample || ((x, z) => S.tide);
      S.t += dt;
      phaseLogic(dt);
      stepCrane(cranes[0], cranes[1], dt);
      stepCrane(cranes[1], cranes[0], dt);
      tugStep(dt);
      shipMode(dt);
      for (const [b, prev] of [[ship, prevShip], [tug, prevTug]]) {
        b.vx = (b.x - prev.x) / dt; b.vz = (b.z - prev.z) / dt;
        b.speed = Math.hypot(b.vx, b.vz);
        b.turn = wrapAngle(b.psi - prev.psi) / dt;
        prev.x = b.x; prev.z = b.z; prev.psi = b.psi;
      }
      updateFloat(ship, sample, dt, SHIP.half, SHIP.B);
      updateFloat(tug, sample, dt, TUG.half, TUG.B);
      ship.radar += dt * 2.4;
      ship.prop += dt * (2 + ship.v * 60);
      tug.prop += dt * (2 + tug.wash * 30);
      tug.smoke = 0.25 + tug.wash * 0.75;
    }

    function canCastOff() { return workPhase() && !S.castOffRequested; }
    function castOff() { if (canCastOff()) { S.castOffRequested = true; return true; } return false; }
    function canCallIn() { return S.phase === 'atSea' && !S.hurry && ship.s / LAP.len < 0.8; }
    function callIn() { if (canCallIn()) { S.hurry = true; return true; } return false; }

    function button() {
      if (S.phase === 'atSea') return { label: 'Call her in', enabled: canCallIn(), action: 'callIn' };
      if (S.phase === 'berthing' || (S.phase === 'release' && ship.mode === 'lapWait' && S.hornAt >= 0)) return { label: 'Call her in', enabled: false, action: 'callIn' };
      return { label: 'Cast off', enabled: canCastOff(), action: 'castOff' };
    }

    function status() {
      switch (S.phase) {
        case 'unload': return S.castOffRequested ? 'Finishing up' : `Unloading ${Math.min(S.unload.done + 1, S.unload.target)} / ${S.unload.target}`;
        case 'load': return S.castOffRequested ? 'Finishing up' : `Loading ${Math.min(S.load.done + 1, S.load.target)} / ${S.load.target}`;
        case 'boomsUp': return 'Booms up';
        case 'tugComing': return 'Tug coming';
        case 'tow': case 'release': return 'Casting off';
        case 'atSea': { const p = ship.s / LAP.len; return p > 0.8 ? 'Coming in' : `At sea ${Math.round(p * 100)}%`; }
        case 'berthing': return 'Berthing';
        case 'boomsDown': return 'Booms down';
      }
      return '';
    }

    function craneSpreader(cr) { return [cr.x, cr.sy, cr.tz]; }

    function containerFrame(c, out) {
      if (c.where === 'static') { out.obj = 'world'; out.p = c.pos; return out; }
      if (c.where === 'crane') { out.obj = 'spreader' + c.crane; out.p = [0, -K.BOX_H, 0]; return out; }
      if (c.pending) {
        const j = c.pending, sp = j.src;
        if (sp.type === 'ship') { out.obj = 'ship'; out.p = [bayLX(j.b), SHIP.hatchY + sp.tier * K.BOX_H, rowLZ(sp.r)]; }
        else { out.obj = 'world'; out.p = [bayWX(j.b), K.LAND_Y + sp.tier * K.BOX_H, K.YARD_LANES[sp.l]]; }
        return out;
      }
      for (let b = 0; b < 6; b++) {
        for (let r = 0; r < 4; r++) {
          const t = shipGrid[b][r].indexOf(c.id);
          if (t >= 0) { out.obj = 'ship'; out.p = [bayLX(b), SHIP.hatchY + t * K.BOX_H, rowLZ(r)]; return out; }
        }
        for (let l = 0; l < 3; l++) {
          const t = yardGrid[b][l].indexOf(c.id);
          if (t >= 0) { out.obj = 'world'; out.p = [bayWX(b), K.LAND_Y + t * K.BOX_H, K.YARD_LANES[l]]; return out; }
        }
      }
      out.obj = 'hidden'; out.p = [0, -10, 0];
      return out;
    }

    function collisions() {
      const v = [];
      const level = S.tide;
      const bodies = [
        { name: 'ship', b: ship, half: SHIP.half, beam: SHIP.B, draft: SHIP.draft },
        { name: 'tug', b: tug, half: TUG.half + 0.02, beam: TUG.B + 0.02, draft: TUG.draft },
      ];
      for (const B of bodies) {
        const pts = hullPoints(B.b, B.half, B.beam, 14, 4);
        for (const [x, z] of pts) {
          const H = terrainH(x, z);
          if (Math.abs(x) > K.HALF - 0.03 || Math.abs(z) > K.HALF - 0.03) { v.push(`${B.name} leaves block at ${x.toFixed(2)},${z.toFixed(2)}`); break; }
          if (z < K.FENDER_Z - 0.003) { v.push(`${B.name} hits quay at ${x.toFixed(2)},${z.toFixed(2)}`); break; }
          if (H > level - B.draft - 0.02) { v.push(`${B.name} grounds at ${x.toFixed(2)},${z.toFixed(2)} H=${H.toFixed(3)}`); break; }
          const pr = LAYOUT.pier;
          if (x > pr.x0 - 0.02 && x < pr.x1 + 0.02 && z < pr.z1 + 0.02) { v.push(`${B.name} hits pier`); break; }
          let hit = null;
          for (const fb of LAYOUT.fishingBoats) if (obbSigned(fb, fb.L / 2, fb.B, x, z) < 0.02) hit = 'fishing boat';
          for (const y of LAYOUT.yachts) if (Math.hypot(x - y.buoy[0], z - y.buoy[1]) < y.swing + 0.02) hit = 'yacht';
          if (Math.hypot(x - LAYOUT.channelBuoy[0], z - LAYOUT.channelBuoy[1]) < 0.07) hit = 'channel buoy';
          if (hit) { v.push(`${B.name} hits ${hit} at ${x.toFixed(2)},${z.toFixed(2)}`); break; }
        }
      }
      const contact = S.phase === 'berthing' && (S.berthStep === 'nose' || S.berthStep === 'push' || S.berthStep === 'back');
      const allow = contact ? -0.012 : 0.005;
      let minD = 1e9;
      for (const [x, z] of hullPoints(tug, TUG.half + 0.02, TUG.B + 0.02, 10, 3)) minD = Math.min(minD, obbSigned(ship, SHIP.half, SHIP.B, x, z));
      for (const [x, z] of hullPoints(ship, SHIP.half, SHIP.B, 20, 4)) minD = Math.min(minD, obbSigned(tug, TUG.half + 0.02, TUG.B + 0.02, x, z));
      if (minD < allow) v.push(`ship/tug overlap ${minD.toFixed(3)} in ${S.phase}`);
      const sep = Math.abs(cranes[0].x - cranes[1].x);
      if (sep < K.MIN_SEP - 1e-6) v.push(`cranes too close ${sep.toFixed(3)}`);
      if (cranes[0].x > cranes[1].x) v.push('cranes crossed');
      if (ship.mode !== 'berth' && cranes.some(c => c.boom < 0.999)) v.push(`boom down while ship away (${S.phase})`);
      for (const cr of cranes) if (cr.boom > 0.001 && cr.tz > K.HINGE_Z - 0.03) v.push('trolley on raised boom');
      return v;
    }

    function setTide(m) { S.tide = clamp(m, -K.TIDE_MAX, K.TIDE_MAX); }

    return {
      S, ship, tug, cranes, containers, dynamicCount, statics, update, castOff, callIn, canCastOff, canCallIn,
      button, status, collisions, setTide, containerFrame, craneSpreader, shipWorld, LAP, tugRoutes,
      get phase() { return S.phase; },
      drainEvents() { const e = S.events; S.events = []; return e; },
    };
  }

  root.HarborCore = {
    K, SHIP, TUG, BERTH, ARRIVE, TOW_END, TUG_HOME, STANDBY, LAYOUT, LIVERIES,
    create, terrainH, landH, seabedH, makePath, qmul, qaxis, qrot, qyaw, mulberry32, clamp, smooth, wrapAngle, obbSigned, bodyPoint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
