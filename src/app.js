(function () {
  'use strict';
  const HC = window.HarborCore, G = window.HarborGeo, SH = window.HarborShaders, SIM = window.HarborSim, LIFE = window.HarborLife;
  const K = HC.K;
  const $ = s => document.querySelector(s);
  const hook = window.__harbor = { ready: false, fallback: null, errors: [], frames: 0, simMs: 0, frameMs: 0 };

  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMQ.matches;
  reducedMQ.addEventListener?.('change', e => { reduced = e.matches; });

  function fallback(reason) {
    hook.fallback = reason;
    document.body.classList.add('no-gpu');
    $('#fallback-reason').textContent = reason;
    $('#pill-text').textContent = 'WebGPU · Unavailable';
    $('#pill').classList.add('off');
  }

  const FLAVOURS = {
    seaglass: { absorb: [2.9, 0.8, 1.05], scatter: [0.045, 0.22, 0.19], strata: ['#c9e4b8', '#f6c9a8', '#efa9b5', '#f7ead2', '#d9a877'] },
    blueberry: { absorb: [3.2, 1.7, 0.75], scatter: [0.03, 0.08, 0.3], strata: ['#b9a6d9', '#e2cdee', '#f4ecdf', '#c99ac0', '#8a6a9c'] },
    lime: { absorb: [1.3, 0.6, 2.8], scatter: [0.22, 0.34, 0.04], strata: ['#f5e27a', '#f4b6c2', '#fbf3d8', '#bfe6c4', '#e9c27a'] },
  };
  const hexToRgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

  const M4 = {
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = f / (n - f); m[11] = -1; m[14] = n * f / (n - f); return m; },
    ortho(l, r, b, t, n, f) { const m = new Float32Array(16); m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1; return m; },
    look(e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      const m = new Float32Array(16);
      m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
      m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); m[15] = 1;
      return m;
    },
    mul(a, b) {
      const m = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        m[i * 4 + j] = s;
      }
      return m;
    },
    inv(m) {
      const a = m, o = new Float32Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
      const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
      const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
      return o;
    },
  };

  const ui = {
    flavour: 'seaglass', firmness: 0.5, damping: 0.35, tide: 0, paused: false, sound: true, fed: 0,
  };

  let audio = null;
  function ensureAudio() {
    if (audio || !ui.sound) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audio = new AC(); } catch (e) { audio = null; }
    return audio;
  }
  function playHorn() {
    if (!ui.sound || !audio) return;
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + 0.02;
    const out = audio.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.3, t + 0.18);
    out.gain.setValueAtTime(0.3, t + 1.9);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(820, t + 0.25); lp.Q.value = 3;
    const body = audio.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 240; body.gain.value = 6; body.Q.value = 1.2;
    lp.connect(body); body.connect(out); out.connect(audio.destination);
    for (const [f, det] of [[98, -7], [98, 6], [147, -5], [147, 8]]) {
      const o = audio.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.93, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.22);
      o.detune.value = det;
      const g = audio.createGain(); g.gain.value = 0.22;
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + 2.8);
    }
  }

  function setupPanelUI(actions) {
    const sheet = $('#panel');
    $('#sheet-toggle').addEventListener('click', () => sheet.classList.toggle('open'));
    $('#btn-ship').addEventListener('click', () => actions.ship());
    $('#btn-horn').addEventListener('click', () => { ensureAudio(); actions.horn(); });
    $('#btn-feed').addEventListener('click', () => actions.feed());
    for (const b of document.querySelectorAll('.swatch')) {
      b.addEventListener('click', () => {
        ui.flavour = b.dataset.flavour;
        for (const o of document.querySelectorAll('.swatch')) o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
    }
    const bindRange = (id, key, fmt) => {
      const el = $(id), out = $(id + '-v');
      const upd = () => { ui[key] = parseFloat(el.value); out.textContent = fmt(ui[key]); };
      el.addEventListener('input', upd); upd();
    };
    bindRange('#firmness', 'firmness', v => Math.round(v * 100) + '%');
    bindRange('#damping', 'damping', v => Math.round(v * 100) + '%');
    bindRange('#tide', 'tide', v => (v > 0 ? '+' : '') + v.toFixed(0) + ' cm');
    $('#btn-reset').addEventListener('click', () => actions.reset());
    $('#btn-pause').addEventListener('click', () => {
      ui.paused = !ui.paused;
      $('#btn-pause').textContent = ui.paused ? 'Resume' : 'Pause';
      $('#btn-pause').setAttribute('aria-pressed', ui.paused ? 'true' : 'false');
      $('#pill-text').textContent = ui.paused ? 'WebGPU · Paused' : 'WebGPU · Live';
    });
    $('#btn-sound').addEventListener('click', () => {
      ui.sound = !ui.sound;
      $('#btn-sound').textContent = ui.sound ? 'Sound on' : 'Sound off';
      $('#btn-sound').setAttribute('aria-pressed', ui.sound ? 'true' : 'false');
      if (ui.sound) ensureAudio();
      else if (audio) audio.suspend();
    });
    $('#btn-view').addEventListener('click', () => actions.resetView());
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); ensureAudio(); actions.horn(); }
    });
  }

  async function main() {
    const canvas = $('#gpu');
    if (!navigator.gpu) { fallback('This browser does not expose WebGPU (navigator.gpu is missing).'); return; }
    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { adapter = null; }
    if (!adapter) { fallback('WebGPU is present, but no suitable GPU adapter was found.'); return; }
    let device;
    try { device = await adapter.requestDevice(); } catch (e) { fallback('The GPU adapter refused to create a device: ' + e.message); return; }
    device.lost.then(info => { if (info.reason !== 'destroyed') fallback('The GPU device was lost: ' + (info.message || info.reason)); });
    device.addEventListener('uncapturederror', e => { hook.errors.push(e.error.message); console.warn('WebGPU:', e.error.message); });

    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    device.pushErrorScope('validation');
    const mod = code => device.createShaderModule({ code });
    const scMod = mod(SH.scene), parMod = mod(SH.particles), watMod = mod(SH.water), caMod = mod(SH.caustics), toneMod = mod(SH.tone);
    for (const [name, m] of [['scene', scMod], ['particles', parMod], ['water', watMod], ['caustics', caMod], ['tone', toneMod]]) {
      const info = await m.getCompilationInfo();
      const errs = info.messages.filter(x => x.type === 'error');
      if (errs.length) {
        const msg = `${name} shader: ` + errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('\n');
        fallback('Shader compilation failed. ' + msg.slice(0, 400));
        console.warn(msg);
        return;
      }
    }

    const N = 128;
    const sim = new SIM.WaterSim(N);
    let core = HC.create({ seed: 7 });
    const scene = G.buildScene();
    let life = LIFE.create({ sim, perches: scene.perches, reduced, seed: 99 });
    life.init(core);

    const buf = (data, usage) => {
      const b = device.createBuffer({ size: Math.max(16, (data.byteLength + 3) & ~3), usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, data.buffer ? data : new Uint8Array(data), 0);
      return b;
    };
    const sceneVB = buf(scene.data, GPUBufferUsage.VERTEX);
    const cont = G.buildContainer(), fishM = G.buildFish(), gullM = G.buildGull(), jellyM = G.buildJelly();
    const contVB = buf(cont.data, GPUBufferUsage.VERTEX), fishVB = buf(fishM.data, GPUBufferUsage.VERTEX), gullVB = buf(gullM.data, GPUBufferUsage.VERTEX), jellyVB = buf(jellyM.data, GPUBufferUsage.VERTEX);
    const MAXC = 400, MAXF = 120, MAXG = 16, MAXJ = 8, MAXP = 1000;
    const instC = new Float32Array(MAXC * 12), instF = new Float32Array(MAXF * 12), instG = new Float32Array(MAXG * 12), instJ = new Float32Array(MAXJ * 12), instP = new Float32Array(MAXP * 12);
    const mkInst = n => device.createBuffer({ size: n * 48, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const contIB = mkInst(MAXC), fishIB = mkInst(MAXF), gullIB = mkInst(MAXG), jellyIB = mkInst(MAXJ), partIB = mkInst(MAXP);

    const WG = 128;
    const wv = [], wi = [];
    for (let j = 0; j <= WG; j++) for (let i = 0; i <= WG; i++) wv.push(-K.HALF + 2 * K.HALF * i / WG, -K.HALF + 2 * K.HALF * j / WG, 0, 0);
    for (let j = 0; j < WG; j++) for (let i = 0; i < WG; i++) {
      const a = j * (WG + 1) + i, b = a + 1, c = a + WG + 1, d = c + 1;
      wi.push(a, c, b, b, c, d);
    }
    const sides = [
      { s: 0, pts: k => [K.HALF, -K.HALF + 2 * K.HALF * k / WG], n: [1, 0] },
      { s: 1, pts: k => [-K.HALF, -K.HALF + 2 * K.HALF * k / WG], n: [-1, 0] },
      { s: 2, pts: k => [-K.HALF + 2 * K.HALF * k / WG, K.HALF], n: [0, 1] },
      { s: 3, pts: k => [-K.HALF + 2 * K.HALF * k / WG, -K.HALF], n: [0, -1] },
    ];
    for (const sd of sides) {
      const base = wv.length / 4;
      for (let k = 0; k <= WG; k++) { const [x, z] = sd.pts(k); wv.push(x, z, 1, sd.s, x, z, 2, sd.s); }
      for (let k = 0; k < WG; k++) {
        const b0 = base + k * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
        const [x0, z0] = sd.pts(k), [x1, z1] = sd.pts(k + 1);
        const ex = x1 - x0, ez = z1 - z0;
        const ok = (-ez * sd.n[0] + ex * sd.n[1]) > 0;
        if (ok) wi.push(b0, b1, t1, b0, t1, t0); else wi.push(b0, t1, b1, b0, t0, t1);
      }
    }
    const waterVB = buf(new Float32Array(wv), GPUBufferUsage.VERTEX);
    const waterIB = buf(new Uint32Array(wi), GPUBufferUsage.INDEX);
    const waterIC = wi.length;

    const FRAME_FLOATS = 360;
    const frame = new Float32Array(FRAME_FLOATS);
    const frameBuf = device.createBuffer({ size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const toneBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const SHADOW = 2048;
    const shadowTex = device.createTexture({ size: [SHADOW, SHADOW], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const causTex = device.createTexture({ size: [256, 256], format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const waterTex = device.createTexture({ size: [N, N], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
    const TR = 256;
    const terrTex = device.createTexture({ size: [TR, TR], format: 'r32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
    {
      const d = new Float32Array(TR * TR);
      for (let j = 0; j < TR; j++) for (let i = 0; i < TR; i++) d[j * TR + i] = HC.terrainH(-K.HALF + (i + 0.5) * 2 * K.HALF / TR, -K.HALF + (j + 0.5) * 2 * K.HALF / TR);
      device.queue.writeTexture({ texture: terrTex }, d, { bytesPerRow: TR * 4 }, [TR, TR]);
    }
    const shadowSamp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    const linSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;
    const bgl0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } }] });
    const bgl1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | Fr, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: V | Fr, sampler: { type: 'comparison' } },
        { binding: 2, visibility: V | Fr, texture: { sampleType: 'float' } },
        { binding: 3, visibility: V | Fr, sampler: { type: 'filtering' } },
        { binding: 4, visibility: V | Fr, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: V | Fr, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    const bgl2 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: Fr, texture: { sampleType: 'float' } },
        { binding: 1, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    const bglC = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    const bglT = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: Fr, buffer: { type: 'uniform' } },
      ],
    });
    const layout = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
    const L0 = layout(bgl0), L01 = layout(bgl0, bgl1), L012 = layout(bgl0, bgl1, bgl2), L0C = layout(bgl0, bglC), LT = layout(bglT);

    const vbStatic = { arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
      { shaderLocation: 2, offset: 16, format: 'unorm8x4' }, { shaderLocation: 3, offset: 20, format: 'uint8x4' }] };
    const vbInst = { arrayStride: 48, stepMode: 'instance', attributes: [
      { shaderLocation: 4, offset: 0, format: 'float32x4' }, { shaderLocation: 5, offset: 16, format: 'float32x4' }, { shaderLocation: 6, offset: 32, format: 'float32x4' }] };
    const vbWater = { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] };
    const vbPart = { arrayStride: 48, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] };

    const HDR = 'rgba16float', DIST = 'r32float', DEPTH = 'depth24plus';
    const shadowPipe = (entry, buffers) => device.createRenderPipeline({
      layout: L0, vertex: { module: scMod, entryPoint: entry, buffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 },
    });
    const pShadowStatic = shadowPipe('vs_static_shadow', [vbStatic]);
    const pShadowCont = shadowPipe('vs_container_shadow', [vbStatic, vbInst]);
    const pShadowCreature = shadowPipe('vs_creature_shadow', [vbStatic, vbInst]);
    const scenePipe = (entry, buffers) => device.createRenderPipeline({
      layout: L01, vertex: { module: scMod, entryPoint: entry, buffers },
      fragment: { module: scMod, entryPoint: 'fs_scene', targets: [{ format: HDR }, { format: DIST }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    });
    const pStatic = scenePipe('vs_static', [vbStatic]);
    const pCont = scenePipe('vs_container', [vbStatic, vbInst]);
    const pCreature = scenePipe('vs_creature', [vbStatic, vbInst]);
    const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const pJelly = device.createRenderPipeline({
      layout: L01, vertex: { module: scMod, entryPoint: 'vs_jelly', buffers: [vbStatic, vbInst] },
      fragment: { module: scMod, entryPoint: 'fs_jelly', targets: [{ format: HDR, blend: premul }, { format: DIST, writeMask: 0 }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less' },
    });
    const pPart = device.createRenderPipeline({
      layout: L0, vertex: { module: parMod, entryPoint: 'vs_particle', buffers: [vbPart] },
      fragment: { module: parMod, entryPoint: 'fs_particle', targets: [{ format: HDR, blend: premul }, { format: DIST, writeMask: 0 }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less' },
    });
    const pWaterBack = device.createRenderPipeline({
      layout: L01, vertex: { module: watMod, entryPoint: 'vs_water', buffers: [vbWater] },
      fragment: { module: watMod, entryPoint: 'fs_water_back', targets: [{ format: DIST }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less' },
    });
    const pWater = device.createRenderPipeline({
      layout: L012, vertex: { module: watMod, entryPoint: 'vs_water', buffers: [vbWater] },
      fragment: { module: watMod, entryPoint: 'fs_water', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    });
    const pCaus = device.createRenderPipeline({
      layout: L0C, vertex: { module: caMod, entryPoint: 'vs_full' },
      fragment: { module: caMod, entryPoint: 'fs_caustics', targets: [{ format: 'r16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    const pTone = device.createRenderPipeline({
      layout: LT, vertex: { module: toneMod, entryPoint: 'vs_full' },
      fragment: { module: toneMod, entryPoint: 'fs_tone', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const scopeErr = await device.popErrorScope();
    if (scopeErr) { fallback('Pipeline setup failed: ' + scopeErr.message.slice(0, 300)); console.warn(scopeErr.message); return; }

    const bg0 = device.createBindGroup({ layout: bgl0, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
    const bg1 = device.createBindGroup({
      layout: bgl1, entries: [
        { binding: 0, resource: shadowTex.createView() }, { binding: 1, resource: shadowSamp },
        { binding: 2, resource: causTex.createView() }, { binding: 3, resource: linSamp },
        { binding: 4, resource: waterTex.createView() }, { binding: 5, resource: terrTex.createView() },
      ],
    });
    const bgC = device.createBindGroup({ layout: bglC, entries: [{ binding: 0, resource: waterTex.createView() }, { binding: 1, resource: terrTex.createView() }] });

    let tgt = null;
    let camTouched = false;
    function makeTargets(w, h) {
      if (tgt) for (const k of ['hdr', 'copy', 'dist', 'back', 'depth']) tgt[k].destroy();
      const mk = (fmt, usage) => device.createTexture({ size: [w, h], format: fmt, usage });
      const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
      tgt = {
        w, h,
        hdr: mk(HDR, RA | TB | GPUTextureUsage.COPY_SRC),
        copy: mk(HDR, TB | GPUTextureUsage.COPY_DST),
        dist: mk(DIST, RA | TB),
        back: mk(DIST, RA | TB),
        depth: mk(DEPTH, RA),
      };
      tgt.bg2 = device.createBindGroup({ layout: bgl2, entries: [{ binding: 0, resource: tgt.copy.createView() }, { binding: 1, resource: tgt.dist.createView() }, { binding: 2, resource: tgt.back.createView() }] });
      tgt.bgT = device.createBindGroup({ layout: bglT, entries: [{ binding: 0, resource: tgt.hdr.createView() }, { binding: 1, resource: { buffer: toneBuf } }] });
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      const cap = 2.6e6;
      if (w * h > cap) { const s = Math.sqrt(cap / (w * h)); w = Math.floor(w * s); h = Math.floor(h * s); }
      w = Math.min(w, device.limits.maxTextureDimension2D); h = Math.min(h, device.limits.maxTextureDimension2D);
      if (!tgt || tgt.w !== w || tgt.h !== h) { canvas.width = w; canvas.height = h; makeTargets(w, h); if (!camTouched && typeof camDefault === 'function') Object.assign(cam, camDefault()); }
    }

    const cam = { yaw: 0.62, pitch: 0.52, dist: 12.8, target: [0, -0.2, 0] };
    function freeArea() {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const r = $('#panel').getBoundingClientRect();
      if (W > 720) return { x0: 0, x1: Math.max(W * 0.4, r.left - 8), y0: 0, y1: H };
      return { x0: 0, x1: W, y0: 70, y1: Math.max(H * 0.5, r.top) };
    }
    function lensShift() {
      const W = canvas.clientWidth, H = canvas.clientHeight, f = freeArea();
      return [((f.x0 + f.x1) / 2 - W / 2) * 2 / W, -((f.y0 + f.y1) / 2 - H / 2) * 2 / H];
    }
    const camDefault = () => {
      const f = freeArea();
      const H = canvas.clientHeight;
      const fa = (f.x1 - f.x0) / Math.max(1, f.y1 - f.y0);
      const portrait = fa < 0.9;
      const fill = (f.y1 - f.y0) / Math.max(1, H);
      return { yaw: 0.62, pitch: portrait ? 0.62 : 0.52, dist: Math.min(26, 12.8 * Math.pow(Math.max(1, 1.3 / fa), portrait ? 0.92 : 1) / (portrait ? 1 : Math.max(0.55, fill))) };
    };
    Object.assign(cam, camDefault());
    let camGoal = null;
    const tilt = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, held: false, q: [0, 0, 0, 1], off: 0, ax: 0, az: 0 };
    const jelly = { sx: 0, sz: 0, vx: 0, vz: 0, squash: 0, vs: 0, quiver: 0 };
    const sun = (() => { const v = [-0.5, 0.86, 0.42]; const l = Math.hypot(...v); return v.map(c => c / l); })();

    let view, proj, viewProj, invViewProj, eye;
    function updateCamera() {
      const cp = Math.cos(cam.pitch);
      eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
      view = M4.look(eye, cam.target, [0, 1, 0]);
      proj = M4.persp(0.56, tgt.w / tgt.h, 0.1, 80);
      const ls = lensShift();
      proj[8] = -ls[0]; proj[9] = -ls[1];
      viewProj = M4.mul(proj, view);
      invViewProj = M4.inv(viewProj);
    }
    const lightView = M4.look([sun[0] * 12, sun[1] * 12, sun[2] * 12], [0, -0.4, 0], [0, 1, 0]);
    const lightVP = M4.mul(M4.ortho(-4.6, 4.6, -4.6, 4.6, 1, 26), lightView);

    function tiltQuat() {
      const ang = Math.hypot(tilt.x, tilt.z);
      if (ang < 1e-7) return [0, 0, 0, 1];
      return HC.qaxis(tilt.x / ang, 0, tilt.z / ang, ang);
    }
    function blockToWorld(p) {
      const q = tilt.q;
      const r = HC.qrot(q, [p[0], p[1] - K.BOTTOM_Y, p[2]]);
      return [r[0], r[1] + K.BOTTOM_Y + tilt.off, r[2]];
    }
    function worldToBlock(p) {
      const qc = [-tilt.q[0], -tilt.q[1], -tilt.q[2], tilt.q[3]];
      const r = HC.qrot(qc, [p[0], p[1] - K.BOTTOM_Y - tilt.off, p[2]]);
      return [r[0], r[1] + K.BOTTOM_Y, r[2]];
    }
    function dirToBlock(d) { return HC.qrot([-tilt.q[0], -tilt.q[1], -tilt.q[2], tilt.q[3]], d); }

    const OBJ = G.OBJ;
    function setObj(id, p, q, s) {
      const o = 104 + id * 8;
      frame[o] = p[0]; frame[o + 1] = p[1]; frame[o + 2] = p[2]; frame[o + 3] = s == null ? 1 : s;
      frame[o + 4] = q[0]; frame[o + 5] = q[1]; frame[o + 6] = q[2]; frame[o + 7] = q[3];
    }
    const ID = [0, 0, 0, 1];
    for (let i = 0; i < 32; i++) setObj(i, [0, 0, 0], ID);
    let lampAngle = 0;

    function writeObjects() {
      const s = core.ship, t = core.tug;
      setObj(OBJ.SHIP, [s.x, s.y, s.z], s.q);
      setObj(OBJ.RADAR, core.shipWorld([-0.55, 0.445, 0]), HC.qmul(s.q, HC.qaxis(0, 1, 0, s.radar)));
      setObj(OBJ.SHIP_PROP, core.shipWorld([-0.715, -0.068, 0]), HC.qmul(s.q, HC.qaxis(1, 0, 0, s.prop)));
      setObj(OBJ.TUG, [t.x, t.y, t.z], t.q);
      const tw = (lp) => { const r = HC.qrot(t.q, lp); return [t.x + r[0], t.y + r[1], t.z + r[2]]; };
      setObj(OBJ.TUG_PROP, tw([-0.155, -0.045, 0]), HC.qmul(t.q, HC.qaxis(1, 0, 0, t.prop)));
      for (let k = 0; k < 2; k++) {
        const c = core.cranes[k];
        setObj(OBJ.GANTRY[k], [c.x, 0, 0], ID);
        setObj(OBJ.BOOM[k], [c.x, K.BOOM_Y + 0.02, K.HINGE_Z], HC.qaxis(1, 0, 0, -c.boom * K.BOOM_UP));
        setObj(OBJ.TROLLEY[k], [c.x, K.BOOM_Y + 0.0, c.tz], ID);
        setObj(OBJ.SPREADER[k], [c.x, c.sy, c.tz], ID);
      }
      setObj(OBJ.LAMP, [HC.LAYOUT.lighthouse[0], 0.663, HC.LAYOUT.lighthouse[1]], HC.qaxis(0, 1, 0, lampAngle));
      life.yachts.forEach((y, i) => setObj(OBJ.YACHT[i], [y.x, y.y, y.z], y.q));
      life.mbuoys.forEach((b, i) => setObj(OBJ.MBUOY[i], [b.x, b.y, b.z], b.q));
      setObj(OBJ.GBUOY, [life.gbuoy.x, life.gbuoy.y, life.gbuoy.z], life.gbuoy.q);
      life.fboats.forEach((b, i) => setObj(OBJ.FBOAT[i], [b.x, b.y, b.z], b.q));
      life.buoys.forEach((b, i) => setObj(OBJ.LIFEBUOY[i], [b.x, b.y, b.z], b.q));
      if (core.S.towing) setObj(OBJ.TOWHOOK, core.shipWorld([HC.SHIP.bollard, HC.SHIP.deckY + 0.045, 0]), s.q);
      else setObj(OBJ.TOWHOOK, tw([HC.TUG.hook, 0.05, 0]), t.q);
    }

    const cframe = {};
    const objMap = { world: 0, ship: OBJ.SHIP, spreader0: OBJ.SPREADER[0], spreader1: OBJ.SPREADER[1] };
    function writeContainers() {
      let n = 0;
      for (const c of core.containers) {
        const f = core.containerFrame(c, cframe);
        if (f.obj === 'hidden' || n >= MAXC) continue;
        const o = n * 12;
        instC[o] = f.p[0]; instC[o + 1] = f.p[1]; instC[o + 2] = f.p[2]; instC[o + 3] = 0;
        instC[o + 4] = 0; instC[o + 5] = 0; instC[o + 6] = 1; instC[o + 7] = 0;
        instC[o + 8] = c.livery; instC[o + 9] = objMap[f.obj]; instC[o + 10] = c.len === 40 ? K.BOX_L40 : K.BOX_L; instC[o + 11] = 0;
        n++;
      }
      return n;
    }

    function writeFrame(time) {
      frame.set(viewProj, 0);
      frame.set(lightVP, 16);
      const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]];
      frame.set([...right, 0], 32); frame.set([...up, 0], 36);
      const bg = hexToRgb('#efe8db').map(c => Math.pow(c, 2.2));
      frame.set([...bg, 1], 40);
      frame.set([eye[0], eye[1], eye[2], time], 48);
      frame.set([sun[0], sun[1], sun[2], sim.level], 52);
      const ms = reduced ? 0.35 : 1;
      frame.set([jelly.sx * ms, jelly.sz * ms, jelly.squash * ms, jelly.quiver * ms], 56);
      frame.set(tilt.q, 60);
      frame.set([0, tilt.off, 0, 0], 64);
      const fl = FLAVOURS[ui.flavour];
      frame.set([...fl.absorb, 0], 68);
      frame.set([...fl.scatter, 1.0], 72);
      fl.strata.forEach((h, i) => frame.set([...hexToRgb(h), 1], 76 + i * 4));
      frame.set([tgt.w, tgt.h, 1 / tgt.w, 1 / tgt.h], 96);
      frame.set([N, lampAngle, 0, reduced ? 0.5 : 1], 100);
    }

    function sampleWater(x, z) { return sim.height(x, z); }

    const pointers = new Map();
    let drag = null;
    let pinch = null;
    function rayFrom(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
      const a = transform(invViewProj, [nx, ny, 0, 1]), b = transform(invViewProj, [nx, ny, 1, 1]);
      const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
      const l = Math.hypot(...d);
      return { o, d: d.map(c => c / l) };
    }
    function transform(m, v) {
      return [0, 1, 2, 3].map(i => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]);
    }
    function pick(clientX, clientY) {
      const ray = rayFrom(clientX, clientY);
      const o = worldToBlock(ray.o), d = dirToBlock(ray.d);
      let best = { kind: 'orbit', t: 1e9 };
      life.buoys.forEach((b, i) => {
        const oc = [o[0] - b.x, o[1] - b.y, o[2] - b.z];
        const tb = -(oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2]);
        if (tb < 0) return;
        const cl = [oc[0] + d[0] * tb, oc[1] + d[1] * tb, oc[2] + d[2] * tb];
        if (Math.hypot(...cl) < 0.07 && tb < best.t) best = { kind: 'buoy', i, t: tb };
      });
      if (best.kind === 'buoy') return best;
      if (Math.abs(d[1]) > 1e-5) {
        const tw = (sim.level - o[1]) / d[1];
        if (tw > 0) {
          const x = o[0] + d[0] * tw, z = o[2] + d[2] * tw;
          if (Math.abs(x) < K.HALF && Math.abs(z) < K.HALF) {
            let blocked = false;
            for (let k = 1; k < 24; k++) {
              const tt = tw * k / 24;
              const px = o[0] + d[0] * tt, py = o[1] + d[1] * tt, pz = o[2] + d[2] * tt;
              if (Math.abs(px) < K.HALF && Math.abs(pz) < K.HALF && py < HC.terrainH(px, pz)) { blocked = true; break; }
            }
            if (!blocked && sim.isWet(x, z)) best = { kind: 'water', t: tw, p: [x, sim.level, z] };
            else if (!blocked || HC.terrainH(x, z) > sim.level) best = { kind: 'land', t: tw };
          }
        }
      }
      const sidesT = [];
      for (const [ax, sg] of [[0, 1], [0, -1], [2, 1], [2, -1]]) {
        if (Math.abs(d[ax]) < 1e-6) continue;
        const ts = (sg * K.HALF - o[ax]) / d[ax];
        if (ts <= 0) continue;
        const p = [o[0] + d[0] * ts, o[1] + d[1] * ts, o[2] + d[2] * ts];
        const other = ax === 0 ? 2 : 0;
        if (Math.abs(p[other]) <= K.HALF && p[1] >= K.BOTTOM_Y && p[1] <= Math.max(HC.terrainH(p[0], p[2]), sim.level) + 0.02) sidesT.push({ t: ts, p });
      }
      sidesT.sort((a, b) => a.t - b.t);
      if (sidesT.length && sidesT[0].t < best.t) best = { kind: 'side', t: sidesT[0].t, p: sidesT[0].p };
      return best;
    }

    function planePoint(clientX, clientY, y) {
      const ray = rayFrom(clientX, clientY);
      const o = worldToBlock(ray.o), d = dirToBlock(ray.d);
      if (Math.abs(d[1]) < 1e-5) return null;
      const t = (y - o[1]) / d[1];
      if (t < 0) return null;
      return [o[0] + d[0] * t, y, o[2] + d[2] * t];
    }

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      ensureAudio();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist };
        if (drag && drag.kind === 'buoy') releaseBuoy();
        drag = null;
        return;
      }
      camGoal = null;
      const hit = e.button === 2 ? { kind: 'orbit' } : pick(e.clientX, e.clientY);
      drag = { kind: hit.kind, x: e.clientX, y: e.clientY, last: performance.now(), id: e.pointerId };
      if (hit.kind === 'buoy') {
        const b = life.buoys[hit.i];
        b.state = 'held'; drag.i = hit.i; drag.hist = [];
        canvas.style.cursor = 'grabbing';
      } else if (hit.kind === 'water') {
        drag.p = hit.p;
        sim.splash(hit.p[0], hit.p[2], 0.01, 0.05, 0.25);
        life.finger(hit.p[0], hit.p[1], hit.p[2]);
      } else if (hit.kind === 'side') {
        tilt.held = true; drag.hp = hit.p; drag.tx0 = tilt.tx; drag.tz0 = tilt.tz;
      }
    });
    function releaseBuoy() {
      const b = life.buoys[drag.i];
      const h = drag.hist;
      let vx = 0, vy = 0, vz = 0;
      if (h.length >= 2) {
        const a = h[0], c = h[h.length - 1];
        const dt = Math.max(0.016, (c.t - a.t) / 1000);
        vx = (c.p[0] - a.p[0]) / dt; vz = (c.p[2] - a.p[2]) / dt;
      }
      const sp = Math.hypot(vx, vz), mx = 3.2;
      if (sp > mx) { vx *= mx / sp; vz *= mx / sp; }
      vy = 0.5 + Math.min(1.2, sp * 0.3);
      b.vx = vx; b.vy = vy; b.vz = vz; b.state = 'air';
    }
    canvas.addEventListener('pointermove', e => {
      const pt = pointers.get(e.pointerId);
      if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        cam.dist = Math.min(28, Math.max(4, pinch.dist * pinch.d / Math.max(10, d)));
        return;
      }
      if (!drag) {
        if (e.pointerType === 'mouse') {
          const hit = pick(e.clientX, e.clientY);
          canvas.style.cursor = hit.kind === 'water' ? 'crosshair' : hit.kind === 'buoy' ? 'grab' : hit.kind === 'side' ? 'move' : 'default';
        }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.kind === 'orbit' || drag.kind === 'land') {
        cam.yaw -= dx * 0.006; camTouched = true;
        cam.pitch = Math.min(1.4, Math.max(0.1, cam.pitch + dy * 0.005));
        canvas.style.cursor = 'grabbing';
      } else if (drag.kind === 'water') {
        const p = planePoint(e.clientX, e.clientY, sim.level);
        if (p && Math.abs(p[0]) < K.HALF && Math.abs(p[2]) < K.HALF) {
          const mv = drag.p ? Math.hypot(p[0] - drag.p[0], p[2] - drag.p[2]) : 0;
          const steps = Math.max(1, Math.ceil(mv / 0.03));
          for (let s = 1; s <= steps; s++) {
            const x = drag.p[0] + (p[0] - drag.p[0]) * s / steps, z = drag.p[2] + (p[2] - drag.p[2]) * s / steps;
            if (sim.isWet(x, z)) sim.splash(x, z, Math.min(0.012, 0.004 + mv * 0.02 / steps), 0.045, 0.12);
          }
          life.finger(p[0], p[1], p[2]);
          drag.p = p;
        }
      } else if (drag.kind === 'buoy') {
        const p = planePoint(e.clientX, e.clientY, 0.32);
        if (p) {
          const b = life.buoys[drag.i];
          b.x = Math.max(-K.HALF + 0.05, Math.min(K.HALF - 0.05, p[0])); b.z = Math.max(-K.HALF + 0.05, Math.min(K.HALF - 0.05, p[2])); b.y = 0.32;
          b.q = HC.qaxis(1, 0, 0, 0.25);
          drag.hist.push({ t: performance.now(), p: [b.x, b.y, b.z] });
          while (drag.hist.length > 6) drag.hist.shift();
        }
      } else if (drag.kind === 'side') {
        const r = [drag.hp[0], drag.hp[1] - K.BOTTOM_Y, drag.hp[2]];
        const scale = cam.dist * 0.0011;
        const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]];
        const D = [(right[0] * dx - up[0] * dy) * scale, (right[1] * dx - up[1] * dy) * scale, (right[2] * dx - up[2] * dy) * scale];
        const rl = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
        const w = [(r[1] * D[2] - r[2] * D[1]) / rl, (r[2] * D[0] - r[0] * D[2]) / rl, (r[0] * D[1] - r[1] * D[0]) / rl];
        tilt.tx += w[0]; tilt.tz += w[2];
        const m = Math.hypot(tilt.tx, tilt.tz), lim = 0.16;
        if (m > lim) { tilt.tx *= lim / m; tilt.tz *= lim / m; }
      }
    });
    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.kind === 'buoy') releaseBuoy();
      if (drag.kind === 'side') { tilt.held = false; jelly.quiver = Math.min(1, jelly.quiver + 0.6); }
      drag = null;
      canvas.style.cursor = 'default';
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      camGoal = null;
      cam.dist = Math.min(28, Math.max(4, cam.dist * Math.exp(e.deltaY * 0.0011))); camTouched = true;
    }, { passive: false });

    let hornCooldown = 0;
    function horn(fromShip) {
      if (hornCooldown > 0 && !fromShip) return;
      hornCooldown = 1.2;
      playHorn();
      life.horn();
      jelly.quiver = Math.min(1, jelly.quiver + 0.35);
      hook.horns = (hook.horns || 0) + 1;
    }
    const actions = {
      ship() {
        const b = core.button();
        if (!b.enabled) return;
        if (b.action === 'castOff') core.castOff(); else core.callIn();
      },
      horn: () => horn(false),
      feed() { life.feed(); ui.fed++; },
      reset() {
        core = HC.create({ seed: 7 + Math.floor(Math.random() * 1000) });
        core.setTide(ui.tide / 100);
        sim.reset();
        life = LIFE.create({ sim, perches: scene.perches, reduced, seed: 99 });
        life.init(core);
        ui.fed = 0;
        tilt.x = tilt.z = tilt.vx = tilt.vz = tilt.tx = tilt.tz = 0;
        jelly.sx = jelly.sz = jelly.vx = jelly.vz = jelly.squash = jelly.vs = 0;
      },
      resetView() { camGoal = camDefault(); cam.target = [0, -0.2, 0]; camTouched = false; },
    };
    setupPanelUI(actions);

    let lastTide = 0;
    function physics(dt) {
      const t0 = performance.now();
      if (ui.tide / 100 !== lastTide) {
        lastTide = ui.tide / 100;
        core.setTide(lastTide);
        sim.setLevel(core.S.tide);
      }
      const firm = ui.firmness;
      const g = 2.4 + 2.0 * firm;
      const sigma = 0.3e-4 + 0.9e-4 * firm;
      const damp = 0.08 + ui.damping * 2.2;
      const gl = HC.qrot([-tilt.q[0], -tilt.q[1], -tilt.q[2], tilt.q[3]], [0, -g, 0]);
      const p = { g, sigma, damp, ax: gl[0], az: gl[2], smooth: 0.003 };
      const sub = 2;
      for (let i = 0; i < sub; i++) sim.step(dt / sub, p);
      const S = core.ship, T = core.tug;
      sim.displace([
        { x: S.x, z: S.z, psi: S.psi, half: HC.SHIP.half, beam: HC.SHIP.B, draft: HC.SHIP.draft, disp: 0.22, speed: S.speed, wash: Math.min(1, S.wash || 0) * (S.speed > 0.02 ? 1 : 0) },
        { x: T.x, z: T.z, psi: T.psi, half: HC.TUG.half, beam: HC.TUG.B, draft: HC.TUG.draft, disp: 0.25, speed: T.speed, wash: T.wash, reverse: false },
      ], dt);
      sim.advectFoam(dt);
      sim.whitecaps(dt);
      hook.simMs = hook.simMs * 0.9 + (performance.now() - t0) * 0.1;
    }

    function updateTilt(dt) {
      const k = 40 + 50 * ui.firmness, c = 2.2 + 3 * ui.damping;
      const tx = tilt.held ? tilt.tx : 0, tz = tilt.held ? tilt.tz : 0;
      if (!tilt.held) { tilt.tx = 0; tilt.tz = 0; }
      const ax = k * (tx - tilt.x) - c * tilt.vx, az = k * (tz - tilt.z) - c * tilt.vz;
      tilt.vx += ax * dt; tilt.vz += az * dt;
      tilt.x += tilt.vx * dt; tilt.z += tilt.vz * dt;
      tilt.q = tiltQuat();
      let off = 0;
      for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const r = HC.qrot(tilt.q, [cx * K.HALF, 0, cz * K.HALF]);
        off = Math.max(off, -r[1]);
      }
      tilt.off = off;
      const ks = 70 + 80 * ui.firmness, cs = 3.5 + 6 * ui.damping;
      let mx = 0, mz = 0;
      const u = sim.u, v = sim.v;
      for (let i = 0; i < u.length; i += 37) mx += u[i];
      for (let i = 0; i < v.length; i += 37) mz += v[i];
      mx /= u.length / 37; mz /= v.length / 37;
      const driveX = -ax * 0.09 + mx * 0.25, driveZ = -az * 0.09 + mz * 0.25;
      jelly.vx += (-ks * jelly.sx - cs * jelly.vx + driveZ * 0.6) * dt;
      jelly.vz += (-ks * jelly.sz - cs * jelly.vz - driveX * 0.6) * dt;
      jelly.sx += jelly.vx * dt; jelly.sz += jelly.vz * dt;
      jelly.sx = Math.max(-0.08, Math.min(0.08, jelly.sx)); jelly.sz = Math.max(-0.08, Math.min(0.08, jelly.sz));
      const sq = Math.hypot(tilt.vx, tilt.vz) * 0.02;
      jelly.vs += (-ks * 1.4 * jelly.squash - cs * jelly.vs + sq * 20) * dt;
      jelly.squash += jelly.vs * dt;
      jelly.squash = Math.max(-0.04, Math.min(0.04, jelly.squash));
      jelly.quiver *= Math.exp(-dt * (1.2 + 2 * ui.damping));
      jelly.ax = ax; jelly.az = az;
    }

    let activity = 0;
    function updateUI(dt) {
      const b = core.button();
      const btn = $('#btn-ship');
      if (btn.textContent !== b.label) btn.textContent = b.label;
      btn.disabled = !b.enabled;
      const st = core.status();
      const stEl = $('#ship-status');
      if (stEl.textContent !== st) stEl.textContent = st;
      $('#t-boxes').textContent = core.S.tally.boxes;
      $('#t-voy').textContent = core.S.tally.voyages;
      $('#t-fed').textContent = ui.fed;
      const motion = core.ship.speed * 2 + core.tug.speed + core.cranes.reduce((a, c) => a + Math.abs(c.vx) + Math.abs(c.vz) * 0.3 + Math.abs(c.vy) * 0.3, 0);
      const target = Math.min(1, Math.sqrt(sim.energy) * 1.6 + motion * 0.5 + jelly.quiver * 0.4);
      activity += (target - activity) * Math.min(1, dt * 3);
      $('#meter-fill').style.transform = `scaleX(${activity.toFixed(3)})`;
      hook.status = st;
      hook.button = b;
    }

    resize();
    new ResizeObserver(resize).observe(canvas);

    let last = performance.now(), simT = 0;
    let fpsAcc = 0, fpsN = 0;
    function frameLoop(now) {
      requestAnimationFrame(frameLoop);
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 1) { hook.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
      const tStart = performance.now();
      resize();
      if (camGoal) {
        const k = Math.min(1, dt * 4);
        cam.yaw += (camGoal.yaw - cam.yaw) * k; cam.pitch += (camGoal.pitch - cam.pitch) * k; cam.dist += (camGoal.dist - cam.dist) * k;
        if (Math.abs(camGoal.dist - cam.dist) < 0.01 && Math.abs(camGoal.yaw - cam.yaw) < 0.001) camGoal = null;
      }
      hornCooldown -= dt;
      if (!ui.paused) {
        simT += dt;
        const reps = Math.max(1, Math.round(hook.speed || 1));
        for (let r = 0; r < reps; r++) core.update(dt, sampleWater);
        for (const e of core.drainEvents()) {
          if (e.type === 'horn') horn(true);
          if (e.type === 'berthed') jelly.quiver = Math.min(1, jelly.quiver + 0.3);
        }
        physics(dt);
        life.update(dt, core);
        updateTilt(dt);
        lampAngle += dt * 0.9;
      }
      updateCamera();
      writeObjects();
      writeFrame(simT);
      device.queue.writeBuffer(frameBuf, 0, frame);
      device.queue.writeTexture({ texture: waterTex }, sim.pack(), { bytesPerRow: N * 16 }, [N, N]);
      const nC = writeContainers();
      const nF = life.writeFish(instF), nG = life.writeGulls(instG), nJ = life.writeJellies(instJ), nP = life.writeParticles(instP, MAXP);
      device.queue.writeBuffer(contIB, 0, instC, 0, nC * 12);
      device.queue.writeBuffer(fishIB, 0, instF, 0, nF * 12);
      device.queue.writeBuffer(gullIB, 0, instG, 0, nG * 12);
      device.queue.writeBuffer(jellyIB, 0, instJ, 0, nJ * 12);
      if (nP) device.queue.writeBuffer(partIB, 0, instP, 0, nP * 12);
      device.queue.writeBuffer(toneBuf, 0, new Float32Array([tgt.w, tgt.h, (now % 997), 0]));

      const enc = device.createCommandEncoder();
      {
        const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        p.setBindGroup(0, bg0);
        p.setPipeline(pShadowStatic); p.setVertexBuffer(0, sceneVB); p.draw(scene.count);
        p.setPipeline(pShadowCont); p.setVertexBuffer(0, contVB); p.setVertexBuffer(1, contIB); p.draw(cont.count, nC);
        p.setPipeline(pShadowCreature); p.setVertexBuffer(0, gullVB); p.setVertexBuffer(1, gullIB); p.draw(gullM.count, nG);
        p.end();
      }
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: causTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 1] }] });
        p.setPipeline(pCaus); p.setBindGroup(0, bg0); p.setBindGroup(1, bgC); p.draw(3); p.end();
      }
      const bgc = [0.86, 0.81, 0.73];
      {
        const p = enc.beginRenderPass({
          colorAttachments: [
            { view: tgt.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [bgc[0], bgc[1], bgc[2], 1] },
            { view: tgt.dist.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1e9, 0, 0, 0] },
          ],
          depthStencilAttachment: { view: tgt.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        p.setBindGroup(0, bg0); p.setBindGroup(1, bg1);
        p.setPipeline(pStatic); p.setVertexBuffer(0, sceneVB); p.draw(scene.count);
        p.setPipeline(pCont); p.setVertexBuffer(0, contVB); p.setVertexBuffer(1, contIB); p.draw(cont.count, nC);
        p.setPipeline(pCreature);
        p.setVertexBuffer(0, fishVB); p.setVertexBuffer(1, fishIB); p.draw(fishM.count, nF);
        p.setVertexBuffer(0, gullVB); p.setVertexBuffer(1, gullIB); p.draw(gullM.count, nG);
        p.setPipeline(pJelly); p.setVertexBuffer(0, jellyVB); p.setVertexBuffer(1, jellyIB); p.draw(jellyM.count, nJ);
        if (nP) { p.setPipeline(pPart); p.setVertexBuffer(0, partIB); p.draw(6, nP); }
        p.end();
      }
      enc.copyTextureToTexture({ texture: tgt.hdr }, { texture: tgt.copy }, [tgt.w, tgt.h]);
      {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: tgt.back.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1e9, 0, 0, 0] }],
          depthStencilAttachment: { view: tgt.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        });
        p.setBindGroup(0, bg0); p.setBindGroup(1, bg1);
        p.setPipeline(pWaterBack); p.setVertexBuffer(0, waterVB); p.setIndexBuffer(waterIB, 'uint32'); p.drawIndexed(waterIC);
        p.end();
      }
      {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: tgt.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
          depthStencilAttachment: { view: tgt.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        });
        p.setBindGroup(0, bg0); p.setBindGroup(1, bg1); p.setBindGroup(2, tgt.bg2);
        p.setPipeline(pWater); p.setVertexBuffer(0, waterVB); p.setIndexBuffer(waterIB, 'uint32'); p.drawIndexed(waterIC);
        p.end();
      }
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.94, 0.91, 0.86, 1] }] });
        p.setPipeline(pTone); p.setBindGroup(0, tgt.bgT); p.draw(3); p.end();
      }
      device.queue.submit([enc.finish()]);
      updateUI(dt);
      hook.frames++;
      hook.frameMs = hook.frameMs * 0.9 + (performance.now() - tStart) * 0.1;
      if (hook.frames === 3) { hook.ready = true; document.body.classList.add('ready'); if (!ui.paused) $('#pill-text').textContent = 'WebGPU · Live'; }
    }
    hook.core = () => core;
    hook.life = () => life;
    hook.sim = sim;
    hook.ui = ui;
    hook.actions = actions;
    hook.project = (x, y, z) => {
      const w = blockToWorld([x, y, z]);
      const c = transform(viewProj, [w[0], w[1], w[2], 1]);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (c[0] / c[3] * 0.5 + 0.5) * r.width, y: r.top + (0.5 - c[1] / c[3] * 0.5) * r.height };
    };
    hook.cam = cam;
    hook.camTouch = () => { camTouched = true; };
    hook.tilt = () => ({ x: tilt.x, z: tilt.z, held: tilt.held });
    hook.jelly = () => ({ ...jelly });
    requestAnimationFrame(frameLoop);
  }

  main().catch(e => { console.warn(e); fallback('Something went wrong while starting the renderer: ' + (e && e.message ? e.message : e)); });
})();
