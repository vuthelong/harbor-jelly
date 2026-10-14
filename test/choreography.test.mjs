import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'harbor-jelly.html');

function loadCore() {
  let code;
  if (existsSync(htmlPath) && !process.env.CORE_FROM_SRC) {
    const html = readFileSync(htmlPath, 'utf8');
    const m = html.match(/<script id="harbor-core">([\s\S]*?)<\/script>/);
    assert.ok(m, 'harbor-core script block not found in harbor-jelly.html');
    code = m[1];
  } else {
    code = readFileSync(join(here, '..', 'src', 'core.js'), 'utf8');
  }
  const root = {};
  new Function('window', code)(root);
  return root.HarborCore;
}

const HC = loadCore();
const DT = 1 / 60;

function wave(tide) {
  return (x, z, t) => tide + 0.012 * Math.sin(x * 3.1 + t * 1.7) + 0.008 * Math.sin(z * 4.3 - t * 2.3);
}

function run(core, seconds, opts = {}) {
  const w = wave(core.S.tide);
  const log = { violations: [], statuses: new Set(), phases: [], horns: 0, minSep: Infinity, maxCraneHeldAtBoomsUp: 0, movedPerCycle: [] };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = core.S.t;
    if (opts.onStep) opts.onStep(core, t);
    core.update(DT, (x, z) => w(x, z, t));
    for (const e of core.drainEvents()) if (e.type === 'horn') log.horns++;
    const ph = core.phase;
    if (log.phases[log.phases.length - 1] !== ph) {
      log.phases.push(ph);
      if (ph === 'boomsUp') log.movedPerCycle.push(core.S.unload.done + core.S.load.done);
      if (ph === 'boomsUp') log.maxCraneHeldAtBoomsUp = Math.max(log.maxCraneHeldAtBoomsUp, core.cranes.filter(c => c.held >= 0).length);
    }
    log.statuses.add(core.status().replace(/\d+/g, 'N'));
    log.minSep = Math.min(log.minSep, Math.abs(core.cranes[0].x - core.cranes[1].x));
    if (i % 3) continue;
    const v = core.collisions();
    if (v.length && log.violations.length < 20) log.violations.push(`t=${core.S.t.toFixed(2)} ${v.join('; ')}`);
  }
  return log;
}

const ORDER = ['unload', 'load', 'boomsUp', 'tugComing', 'tow', 'release', 'atSea', 'berthing', 'boomsDown'];

test('three automatic cycles: collision-free, ordered, ~100 s each', () => {
  const core = HC.create({ seed: 7 });
  const log = run(core, 360);
  assert.deepEqual(log.violations, []);
  assert.ok(core.S.tally.voyages >= 3, `voyages ${core.S.tally.voyages}`);
  for (const d of core.S.cycleDurations) assert.ok(d > 80 && d < 125, `cycle took ${d.toFixed(1)} s`);
  assert.deepEqual(log.movedPerCycle.slice(0, 3), [16, 16, 16]);
  for (let i = 0; i < 18; i++) assert.equal(log.phases[i], ORDER[i % ORDER.length]);
  for (const s of ['Unloading N / N', 'Loading N / N', 'Booms up', 'Tug coming', 'Casting off', 'At sea N%', 'Coming in', 'Berthing']) {
    assert.ok(log.statuses.has(s), `status "${s}" never shown`);
  }
  assert.ok(log.minSep >= HC.K.MIN_SEP - 1e-9);
  assert.equal(log.horns, core.S.tally.voyages);
  console.log('cycle durations', core.S.cycleDurations.map(d => d.toFixed(1)).join(', '));
});

for (const tide of [-0.1, 0.1]) {
  test(`tide ${tide > 0 ? '+' : ''}${tide * 100} cm stays collision-free`, () => {
    const core = HC.create({ seed: 3 });
    core.setTide(tide);
    const log = run(core, 120);
    assert.deepEqual(log.violations, []);
    assert.ok(core.S.tally.voyages >= 1);
  });
}

test('cast off early: crane finishes box in hand, then ship leaves', () => {
  const core = HC.create({ seed: 11 });
  let requested = false;
  const log = run(core, 75, {
    onStep(c, t) {
      if (!requested && t > 9) { requested = c.castOff(); assert.ok(requested); }
    },
  });
  assert.deepEqual(log.violations, []);
  assert.equal(log.maxCraneHeldAtBoomsUp, 0);
  assert.ok(log.phases.includes('atSea'));
  assert.ok(!log.phases.includes('load'), 'should skip loading after cast off');
  assert.ok(core.containers.every(c => c.where !== 'crane' || core.phase === 'unload' || core.phase === 'load'));
});

test('call her in hurries the ship home', () => {
  const plain = HC.create({ seed: 5 });
  const hurried = HC.create({ seed: 5 });
  let tPlain = 0, tHurry = 0, called = false;
  run(plain, 200, { onStep(c, t) { if (!tPlain && c.phase === 'berthing') tPlain = t; } });
  const log = run(hurried, 200, {
    onStep(c, t) {
      if (!called && c.phase === 'atSea' && c.ship.s / c.LAP.len > 0.15) {
        assert.equal(c.button().label, 'Call her in');
        called = c.callIn();
        assert.ok(called);
        assert.equal(c.button().enabled, false);
      }
      if (!tHurry && c.phase === 'berthing') tHurry = t;
    },
  });
  assert.deepEqual(log.violations, []);
  assert.ok(tHurry > 0 && tHurry < tPlain - 3, `hurried ${tHurry.toFixed(1)} vs ${tPlain.toFixed(1)}`);
});

test('fuzz: random cast-off / call-in presses over many seeds', () => {
  for (let seed = 20; seed < 32; seed++) {
    const core = HC.create({ seed });
    const rnd = HC.mulberry32(seed * 77);
    core.setTide((rnd() - 0.5) * 0.2);
    const log = run(core, 150, {
      onStep(c) {
        if (rnd() < 0.002) c.castOff();
        if (rnd() < 0.004) c.callIn();
      },
    });
    assert.deepEqual(log.violations, [], `seed ${seed}`);
    assert.ok(core.S.tally.voyages >= 1, `seed ${seed} voyages ${core.S.tally.voyages}`);
  }
});

test('container bookkeeping stays consistent', () => {
  const core = HC.create({ seed: 9 });
  run(core, 230);
  const frame = {};
  let ship = 0, crane = 0, hidden = 0;
  for (let i = 0; i < core.dynamicCount; i++) {
    const f = core.containerFrame(core.containers[i], frame);
    if (f.obj === 'ship') ship++;
    if (f.obj.startsWith('spreader')) crane++;
    if (f.obj === 'hidden') hidden++;
  }
  assert.equal(hidden, 0);
  assert.ok(ship <= 48);
  assert.ok(core.containers.length > 220, `only ${core.containers.length} containers`);
});
