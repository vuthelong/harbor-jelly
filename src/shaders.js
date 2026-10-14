(function (root) {
  'use strict';

  const common = /* wgsl */`
struct Obj { p: vec4f, q: vec4f };
struct Frame {
  viewProj: mat4x4f,
  lightVP: mat4x4f,
  camRight: vec4f,
  camUp: vec4f,
  bg: vec4f,
  pad0: vec4f,
  cam: vec4f,
  sun: vec4f,
  jelly: vec4f,
  tilt: vec4f,
  tiltOff: vec4f,
  absorb: vec4f,
  scatter: vec4f,
  strata: array<vec4f, 5>,
  screen: vec4f,
  misc: vec4f,
  objs: array<Obj, 32>,
};
@group(0) @binding(0) var<uniform> F: Frame;

const BOTTOM: f32 = -1.0;
const HALF: f32 = 2.6;
const PI: f32 = 3.14159265;

const M_MATTE: u32 = 0u; const M_GLASS: u32 = 1u; const M_STEEL: u32 = 2u; const M_TILE: u32 = 3u;
const M_TIMBER: u32 = 4u; const M_CORRUG: u32 = 5u; const M_MASONRY: u32 = 6u; const M_RUBBER: u32 = 7u;
const M_ROCK: u32 = 8u; const M_LAMP: u32 = 9u; const M_WEED: u32 = 10u; const M_HULL: u32 = 11u;
const M_TERRAIN: u32 = 12u; const M_STRATA: u32 = 13u; const M_PAPER: u32 = 14u; const M_ASPHALT: u32 = 15u;
const M_COBBLE: u32 = 16u; const M_CONTAINER: u32 = 17u; const M_CONCRETE: u32 = 18u; const M_PILE: u32 = 19u;
const M_FOLIAGE: u32 = 20u; const M_SLATE: u32 = 21u; const M_SAIL: u32 = 22u; const M_JELLY: u32 = 23u;
const M_RING: u32 = 24u; const M_FISH: u32 = 25u; const M_GULL: u32 = 26u; const M_PAINT: u32 = 27u;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }

fn jellyPos(p: vec3f) -> vec3f {
  let h = clamp((p.y - BOTTOM) / 1.2, 0.0, 1.8);
  var q = p;
  q.x = q.x + F.jelly.x * h;
  q.z = q.z + F.jelly.y * h;
  q.y = BOTTOM + (p.y - BOTTOM) * (1.0 + F.jelly.z);
  q.x = q.x * (1.0 - F.jelly.z * 0.5);
  q.z = q.z * (1.0 - F.jelly.z * 0.5);
  let w = F.jelly.w * h;
  let t = F.cam.w;
  q = q + w * 0.012 * vec3f(sin(p.z * 4.0 + t * 13.0), 0.4 * sin(p.x * 3.0 + p.z * 2.0 + t * 11.0), sin(p.x * 4.0 + t * 12.0));
  return qrot(F.tilt, q - vec3f(0.0, BOTTOM, 0.0)) + vec3f(0.0, BOTTOM, 0.0) + F.tiltOff.xyz;
}
fn jellyN(n: vec3f) -> vec3f { return normalize(qrot(F.tilt, n)); }
fn objPos(id: u32, p: vec3f) -> vec3f { let o = F.objs[id]; return qrot(o.q, p * o.p.w) + o.p.xyz; }
fn objN(id: u32, n: vec3f) -> vec3f { return qrot(F.objs[id].q, n); }

fn srgb2lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn hash2(p: vec2f) -> f32 { return hash3(vec3f(p, 7.13)); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let b = mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let c = mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let d = mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
fn noise2(p: vec2f) -> f32 { return noise3(vec3f(p, 0.5)); }
fn fbm(p: vec3f) -> f32 { return noise3(p) * 0.55 + noise3(p * 2.03) * 0.3 + noise3(p * 4.1) * 0.15; }
`;

  const texBindings = /* wgsl */`
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;
@group(1) @binding(2) var causTex: texture_2d<f32>;
@group(1) @binding(3) var linSamp: sampler;
@group(1) @binding(4) var waterTex: texture_2d<f32>;
@group(1) @binding(5) var terrTex: texture_2d<f32>;

fn gridLoad(t: texture_2d<f32>, xz: vec2f) -> vec4f {
  let dims = vec2f(textureDimensions(t));
  let g = (xz + vec2f(HALF)) / (2.0 * HALF) * dims - 0.5;
  let i0 = floor(g);
  let f = clamp(g - i0, vec2f(0.0), vec2f(1.0));
  let mx = dims - 1.0;
  let a = vec2i(clamp(i0, vec2f(0.0), mx));
  let b = vec2i(clamp(i0 + 1.0, vec2f(0.0), mx));
  let v00 = textureLoad(t, vec2i(a.x, a.y), 0);
  let v10 = textureLoad(t, vec2i(b.x, a.y), 0);
  let v01 = textureLoad(t, vec2i(a.x, b.y), 0);
  let v11 = textureLoad(t, vec2i(b.x, b.y), 0);
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}
fn waterAt(xz: vec2f) -> vec4f { return gridLoad(waterTex, xz); }
fn terrH(xz: vec2f) -> f32 { return gridLoad(terrTex, xz).r; }
fn causticAt(xz: vec2f) -> f32 {
  let uv = (xz + vec2f(HALF)) / (2.0 * HALF);
  return textureSampleLevel(causTex, linSamp, uv, 0.0).r;
}

fn shadowAt(wpos: vec3f, n: vec3f) -> f32 {
  let L = F.sun.xyz;
  let p = F.lightVP * vec4f(wpos + n * 0.006 + L * 0.004, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || p.z > 1.0) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowMap));
  var s = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      s = s + textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2f(f32(i), f32(j)) * texel * 1.2, p.z - 0.0012);
    }
  }
  return s / 9.0;
}

fn envColor(r: vec3f) -> vec3f {
  let up = smoothstep(-0.15, 0.7, r.y);
  var c = mix(F.bg.rgb * 0.85, vec3f(1.05, 1.02, 0.96), up);
  let box1 = smoothstep(0.82, 0.9, dot(r, normalize(vec3f(-0.4, 0.75, 0.5))));
  let box2 = smoothstep(0.9, 0.95, dot(r, normalize(vec3f(0.6, 0.6, -0.3))));
  c = c + vec3f(2.2, 2.1, 1.9) * box1 + vec3f(1.2, 1.2, 1.25) * box2;
  return c;
}

fn insideBlock(p: vec3f) -> bool { return abs(p.x) <= HALF + 0.001 && abs(p.z) <= HALF + 0.001 && p.y > BOTTOM - 0.01; }

fn lightAt(base: vec3f, n: vec3f, wpos: vec3f, lpos: vec3f, spec: f32, gloss: f32, sh: f32) -> vec3f {
  let L = F.sun.xyz;
  let V = normalize(F.cam.xyz - wpos);
  var sunC = vec3f(1.0, 0.94, 0.84) * 2.6;
  var amb = mix(vec3f(0.36, 0.33, 0.3), vec3f(0.6, 0.62, 0.68), n.y * 0.5 + 0.5);
  let level = F.sun.w;
  if (insideBlock(lpos) && lpos.y < level + 0.03 && lpos.y > terrH(lpos.xz) - 0.03) {
    let wa = waterAt(lpos.xz);
    let under = level + wa.x - lpos.y;
    if (under > 0.0) {
      let c = causticAt(lpos.xz + L.xz / L.y * under);
      let att = exp(-F.absorb.rgb * under / L.y);
      sunC = sunC * att * (0.25 + 1.1 * c);
      amb = amb * exp(-F.absorb.rgb * under * 0.7) + F.scatter.rgb * 0.15 * (1.0 - exp(-under * 3.0));
    }
  }
  let diff = max(dot(n, L), 0.0) * sh;
  let H = normalize(L + V);
  let sp = pow(max(dot(n, H), 0.0), gloss) * spec * sh * (gloss + 8.0) / 40.0;
  return base * (diff * sunC + amb) + sp * sunC;
}
`;

  const sceneVS = /* wgsl */`
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) col: vec4f, @location(3) mo: vec4u };
struct IIn { @location(4) a: vec4f, @location(5) b: vec4f, @location(6) c: vec4f };
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) lpos: vec3f,
  @location(2) n: vec3f,
  @location(3) col: vec3f,
  @location(4) opos: vec3f,
  @location(5) @interpolate(flat) info: vec4u,
  @location(6) extra: f32,
  @location(7) aux: vec4f,
};

fn swayWeed(p: vec3f, w: f32) -> vec3f {
  let t = F.cam.w;
  let s = w * w * (0.012 + 0.01 * sin(p.x * 13.0));
  return p + vec3f(sin(t * 1.3 + p.x * 9.0 + p.z * 5.0) * s, 0.0, cos(t * 1.1 + p.z * 8.0) * s);
}

fn staticWorld(v: VIn) -> VOut {
  var o: VOut;
  let id = v.mo.y;
  var p = v.pos;
  let ex = f32(v.mo.z) / 255.0;
  if (v.mo.x == M_WEED) { p = swayWeed(p, ex); }
  let lp = objPos(id, p);
  var wp = lp;
  var n = objN(id, v.nrm.xyz);
  if (id != 31u) { wp = jellyPos(lp); n = jellyN(n); }
  o.wpos = wp; o.lpos = lp; o.n = n; o.col = srgb2lin(v.col.rgb); o.opos = p; o.info = v.mo; o.extra = ex;
  o.aux = vec4f(0.0);
  return o;
}

@vertex fn vs_static(v: VIn) -> VOut {
  var o = staticWorld(v);
  o.clip = F.viewProj * vec4f(o.wpos, 1.0);
  return o;
}
@vertex fn vs_static_shadow(v: VIn) -> @builtin(position) vec4f {
  let o = staticWorld(v);
  return F.lightVP * vec4f(o.wpos, 1.0);
}

const LIVERY = array<vec3f, 10>(
  vec3f(0.36, 0.62, 0.78), vec3f(0.74, 0.2, 0.17), vec3f(0.22, 0.48, 0.32), vec3f(0.9, 0.5, 0.18), vec3f(0.6, 0.62, 0.64),
  vec3f(0.17, 0.24, 0.42), vec3f(0.92, 0.76, 0.2), vec3f(0.18, 0.55, 0.56), vec3f(0.5, 0.32, 0.22), vec3f(0.9, 0.89, 0.86)
);

fn containerWorld(v: VIn, i: IIn) -> VOut {
  var o: VOut;
  let len = i.c.z;
  var p = v.pos;
  p.x = sign(p.x) * (len * 0.5 - (0.5 - abs(p.x)) * 0.148);
  let cy = cos(i.a.w); let sy = sin(i.a.w);
  let r = vec3f(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  let nr = vec3f(v.nrm.x * cy + v.nrm.z * sy, v.nrm.y, -v.nrm.x * sy + v.nrm.z * cy);
  let id = u32(i.c.y);
  let lp = objPos(id, r + i.a.xyz);
  o.lpos = lp; o.wpos = jellyPos(lp); o.n = jellyN(objN(id, nr));
  let liv = LIVERY[u32(i.c.x) % 10u];
  o.col = srgb2lin(liv) * srgb2lin(v.col.rgb);
  o.opos = p; o.info = vec4u(M_CONTAINER, 0u, 0u, 0u); o.extra = len; o.aux = vec4f(v.nrm.xyz, 0.0);
  return o;
}
@vertex fn vs_container(v: VIn, i: IIn) -> VOut {
  var o = containerWorld(v, i);
  o.clip = F.viewProj * vec4f(o.wpos, 1.0);
  return o;
}
@vertex fn vs_container_shadow(v: VIn, i: IIn) -> @builtin(position) vec4f {
  let o = containerWorld(v, i);
  return F.lightVP * vec4f(o.wpos, 1.0);
}

fn orient(p: vec3f, yaw: f32, pitch: f32, roll: f32) -> vec3f {
  let cr = cos(roll); let sr = sin(roll);
  var q = vec3f(p.x, p.y * cr - p.z * sr, p.y * sr + p.z * cr);
  let cp = cos(pitch); let sp = sin(pitch);
  q = vec3f(q.x * cp - q.y * sp, q.x * sp + q.y * cp, q.z);
  let a = -yaw;
  let ca = cos(a); let sa = sin(a);
  return vec3f(q.x * ca + q.z * sa, q.y, -q.x * sa + q.z * ca);
}

fn creatureWorld(v: VIn, i: IIn) -> VOut {
  var o: VOut;
  var p = v.pos;
  var n = v.nrm.xyz;
  let ex = f32(v.mo.z) / 255.0;
  if (i.c.z < 0.5) {
    p.z = p.z + sin(i.b.w - p.x * 7.0) * 0.16 * ex * ex;
  } else if (ex > 0.0) {
    let th = sin(i.b.w) * i.c.y * (0.5 + 0.5 * ex) + i.c.w;
    let s = abs(p.z);
    p.y = p.y + s * sin(th);
    p.z = p.z * cos(th);
    if (ex > 0.75) { p.y = p.y + (ex - 0.75) * sin(i.b.w - 0.6) * i.c.y * 0.6; }
  }
  let sc = i.b.z;
  let lp = orient(p * sc, i.a.w, i.b.x, i.b.y) + i.a.xyz;
  let ln = orient(n, i.a.w, i.b.x, i.b.y);
  o.lpos = lp; o.wpos = jellyPos(lp); o.n = jellyN(ln);
  o.col = srgb2lin(v.col.rgb); o.opos = v.pos; o.info = vec4u(v.mo.x, 0u, v.mo.z, u32(i.c.x)); o.extra = ex;
  o.aux = vec4f(0.0);
  return o;
}
@vertex fn vs_creature(v: VIn, i: IIn) -> VOut {
  var o = creatureWorld(v, i);
  o.clip = F.viewProj * vec4f(o.wpos, 1.0);
  return o;
}
@vertex fn vs_creature_shadow(v: VIn, i: IIn) -> @builtin(position) vec4f {
  let o = creatureWorld(v, i);
  return F.lightVP * vec4f(o.wpos, 1.0);
}

@vertex fn vs_jelly(v: VIn, i: IIn) -> VOut {
  var o: VOut;
  var p = v.pos;
  let ex = f32(v.mo.z) / 255.0;
  let ph = i.b.w;
  let t = F.cam.w;
  if (v.mo.w == 0u && v.mo.x != M_RING) {
    let k = 1.0 + 0.16 * sin(ph - ex * 1.6) * (0.4 + ex);
    p = vec3f(p.x * k, p.y * (1.0 - 0.12 * sin(ph - 0.3)), p.z * k);
  } else if (v.mo.x == M_RING) {
    let k = 1.0 + 0.08 * sin(ph);
    p = vec3f(p.x * k, p.y, p.z * k);
  } else {
    let d = (ex - 0.5) * 2.0;
    let lag = sin(ph - 1.2 - d * 2.0) * 0.12 * d;
    p = vec3f(p.x * (1.0 + lag) + sin(t * 0.9 + p.y * 3.0 + i.c.x) * 0.09 * d, p.y, p.z * (1.0 + lag) + cos(t * 0.8 + p.y * 2.6 + i.c.x) * 0.09 * d);
  }
  let lp = orient(p * i.b.z, i.a.w, i.b.x, i.b.y) + i.a.xyz;
  o.lpos = lp; o.wpos = jellyPos(lp); o.n = jellyN(orient(v.nrm.xyz, i.a.w, i.b.x, i.b.y));
  o.col = srgb2lin(v.col.rgb); o.opos = v.pos; o.info = v.mo; o.extra = ex; o.aux = vec4f(0.0);
  o.clip = F.viewProj * vec4f(o.wpos, 1.0);
  return o;
}
`;

  const sceneFS = /* wgsl */`
struct FOut { @location(0) color: vec4f, @location(1) dist: vec4f };

fn perturb(n: vec3f, d: vec3f, k: f32) -> vec3f { return normalize(n + d * k); }

fn tangentOf(n: vec3f) -> vec3f {
  if (abs(n.y) > 0.9) { return vec3f(1.0, 0.0, 0.0); }
  return normalize(cross(vec3f(0.0, 1.0, 0.0), n));
}

fn fouling(base: vec3f, lpos: vec3f, n: vec3f) -> vec3f {
  let level = F.sun.w;
  let d = level - 0.012 - lpos.y;
  if (d <= 0.0 || !insideBlock(lpos)) { return base; }
  let q = lpos * 90.0;
  let sp = noise3(q) * 0.7 + noise3(q * 2.7) * 0.3;
  let mussel = vec3f(0.05, 0.06, 0.09) + vec3f(0.08, 0.09, 0.13) * hash3(floor(q * 1.3));
  var c = mix(base, mussel, smoothstep(0.35, 0.6, sp) * smoothstep(0.0, 0.03, d));
  let weed = vec3f(0.17, 0.32, 0.12);
  c = mix(c, weed, smoothstep(0.55, 0.75, noise3(lpos * 30.0 + vec3f(0.0, 4.0, 0.0))) * 0.7);
  c = mix(c, base * 0.7 + vec3f(0.05, 0.08, 0.03), smoothstep(0.02, 0.0, d) * 0.6);
  return c;
}

fn strataColor(lpos: vec3f) -> vec3f {
  let w = lpos.y + 0.03 * sin(lpos.x * 3.1 + lpos.z * 2.3) + 0.018 * sin(lpos.x * 7.7 - lpos.z * 5.3) + 0.006 * noise3(lpos * 40.0);
  let bands = array<f32, 5>(-0.84, -0.66, -0.47, -0.24, 0.5);
  var idx = 4u;
  for (var k = 0u; k < 5u; k = k + 1u) { if (w < bands[k]) { idx = k; break; } }
  var c = srgb2lin(F.strata[idx].rgb);
  var edge = 1.0;
  for (var k = 0u; k < 4u; k = k + 1u) { edge = min(edge, abs(w - bands[k])); }
  c = mix(c * 1.18 + vec3f(0.05), c, smoothstep(0.0, 0.008, edge));
  let grain = noise3(lpos * 120.0);
  c = c * (0.93 + 0.1 * grain);
  if (hash3(floor(lpos * 160.0)) > 0.985) { c = c * 1.2 + vec3f(0.08); }
  return c;
}

fn shadeSurface(i: VOut) -> vec4f {
  let mat = i.info.x;
  var n = normalize(i.n);
  if (dot(n, F.cam.xyz - i.wpos) < 0.0) { n = -n; }
  var base = i.col;
  var spec = 0.08;
  var gloss = 24.0;
  var emis = vec3f(0.0);
  let lp = i.lpos;
  let t = F.cam.w;
  var sh = 1.0;
  var alpha = 1.0;
  switch mat {
    case 0u, 22u: { spec = 0.05; }
    case 27u: { spec = 0.35; gloss = 60.0; }
    case 1u: {
      let V = normalize(F.cam.xyz - i.wpos);
      let r = reflect(-V, n);
      let fr = 0.25 + 0.75 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
      emis = envColor(r) * fr * 0.35;
      spec = 0.9; gloss = 120.0;
    }
    case 2u: { spec = 0.6; gloss = 80.0; base = base * 0.9; }
    case 3u, 21u: {
      let sc = select(0.014, 0.01, mat == 21u);
      let row = floor(lp.y / sc);
      let along = (lp.x + lp.z) / (sc * 1.2) + row * 0.5;
      let line = smoothstep(0.0, 0.14, fract(lp.y / sc)) * smoothstep(0.0, 0.08, fract(along)) ;
      base = base * (0.72 + 0.28 * line) * (0.9 + 0.2 * hash2(vec2f(row, floor(along))));
      spec = select(0.08, 0.25, mat == 21u);
      n = perturb(n, vec3f(0.0, 1.0, 0.0), (fract(lp.y / sc) - 0.5) * 0.3);
    }
    case 4u, 19u: {
      let q = lp.x * 3.0 + lp.z * 3.0 + lp.y * 1.0;
      let g = noise3(vec3f(q * 20.0, lp.y * 300.0, lp.x * 40.0));
      base = base * (0.8 + 0.35 * g);
      if (mat == 19u) { base = fouling(base, lp, n); }
    }
    case 5u: {
      let tg = tangentOf(n);
      let ph = dot(i.opos, tg) * 2.0 * PI / 0.012;
      n = perturb(n, tg, cos(ph) * 0.45);
      base = base * (0.92 + 0.08 * sin(ph));
      spec = 0.3; gloss = 40.0;
    }
    case 6u: {
      let tg = tangentOf(n);
      let u = dot(lp, tg);
      let rowH = 0.022;
      let row = floor(lp.y / rowH);
      let cu = u / 0.045 + row * 0.5;
      let fy = fract(lp.y / rowH); let fu = fract(cu);
      let mortar = 1.0 - smoothstep(0.0, 0.06, min(fy, 1.0 - fy)) * smoothstep(0.0, 0.04, min(fu, 1.0 - fu));
      let stone = 0.82 + 0.3 * hash2(vec2f(row, floor(cu)));
      base = mix(base * stone * (0.9 + 0.15 * noise3(lp * 80.0)), base * 1.25, mortar);
      n = perturb(n, vec3f(0.0, 1.0, 0.0), (fy - 0.5) * 0.25 * (1.0 - mortar));
      base = fouling(base, lp, n);
    }
    case 7u: { spec = 0.12; gloss = 16.0; }
    case 8u: {
      let g = fbm(lp * 60.0);
      base = base * (0.75 + 0.5 * g);
      n = perturb(n, vec3f(noise3(lp * 90.0) - 0.5, 0.0, noise3(lp * 90.0 + 3.0) - 0.5), 0.7);
      if (lp.y < F.sun.w - 0.01 && n.y > 0.3) { base = mix(base, vec3f(0.12, 0.24, 0.08), smoothstep(0.45, 0.7, noise3(lp * 50.0)) * 0.8); }
    }
    case 9u: { emis = base * (1.0 + 4.0 * i.extra); }
    case 10u: { base = base * (0.7 + 0.5 * i.extra); spec = 0.15; }
    case 11u: {
      let boot = f32(i.info.z) / 1000.0 - 0.128;
      let y = i.opos.y;
      if (y < boot - 0.007) { base = srgb2lin(vec3f(0.66, 0.2, 0.17)); spec = 0.15; }
      else if (y < boot + 0.004) { base = vec3f(0.02); }
      else { spec = 0.4; gloss = 70.0; }
    }
    case 12u: {
      let g = fbm(lp * 35.0);
      base = base * (0.84 + 0.3 * g);
      if (lp.z > -0.7 && lp.y < -0.3) {
        let rip = sin(lp.x * 140.0 + noise3(lp * 12.0) * 6.0) * 0.5 + 0.5;
        base = base * (0.95 + 0.07 * rip);
        n = perturb(n, vec3f(1.0, 0.0, 0.0), (rip - 0.5) * 0.15);
      }
      if (lp.z < -1.78) { base = base * (0.85 + 0.3 * noise3(lp * 140.0)); }
    }
    case 13u: { base = strataColor(lp); spec = 0.25; gloss = 40.0; }
    case 14u: {
      let d = length(i.wpos.xz);
      base = F.bg.rgb * (0.985 + 0.03 * noise3(i.wpos * vec3f(14.0, 1.0, 14.0)));
      spec = 0.0;
      let fog = smoothstep(7.0, 30.0, d);
      sh = shadowAt(i.wpos, n);
      let lit = base * (0.68 + 0.32 * sh);
      return vec4f(mix(lit, F.bg.rgb, fog), 1.0);
    }
    case 15u: {
      let g = noise3(lp * 220.0);
      base = base * (0.8 + 0.35 * g) * (0.9 + 0.15 * noise3(lp * 15.0));
      spec = 0.06;
    }
    case 16u: {
      let q = lp.xz / 0.016;
      let rowi = floor(q.y);
      let qq = vec2f(q.x + rowi * 0.5, q.y);
      let f = fract(qq) - 0.5;
      let dd = length(f * vec2f(1.0, 1.2));
      base = base * (0.75 + 0.35 * hash2(floor(qq))) * (1.0 - smoothstep(0.38, 0.5, dd) * 0.55);
      n = perturb(n, vec3f(f.x, 0.0, f.y), 0.8 * smoothstep(0.2, 0.5, dd));
    }
    case 17u: {
      let on = i.aux.xyz;
      let len = i.extra;
      let x = i.opos.x;
      if (abs(on.z) > 0.5) {
        let ph = x * 2.0 * PI / 0.01;
        base = base * (0.88 + 0.12 * cos(ph));
        let tg = normalize(cross(vec3f(0.0, 1.0, 0.0), n));
        n = perturb(n, tg, sin(ph) * 0.35);
      } else if (abs(on.x) > 0.5) {
        let zz = i.opos.z / 0.03;
        let bar = smoothstep(0.03, 0.0, abs(fract(zz * 2.0) - 0.5) - 0.42);
        base = base * (0.9 - 0.25 * bar) * (1.0 - 0.3 * smoothstep(0.02, 0.0, abs(i.opos.z)));
      } else {
        base = base * (0.9 + 0.1 * cos(x * 2.0 * PI / 0.02));
      }
      base = base * (0.9 + 0.12 * noise3(i.lpos * 30.0 + vec3f(f32(i.info.w))));
      spec = 0.22; gloss = 30.0;
    }
    case 18u: {
      base = base * (0.86 + 0.24 * fbm(lp * 70.0));
      base = fouling(base, lp, n);
    }
    case 20u: {
      let g = fbm(lp * 90.0);
      base = base * (0.6 + 0.7 * g);
      n = perturb(n, vec3f(noise3(lp * 70.0) - 0.5, noise3(lp * 70.0 + 5.0) - 0.5, noise3(lp * 70.0 + 9.0) - 0.5), 1.4);
    }
    case 25u: {
      let v = i.info.w;
      let top = smoothstep(-0.05, 0.12, i.opos.y);
      var back = vec3f(0.12, 0.32, 0.36);
      var belly = vec3f(0.85, 0.88, 0.9);
      if (v == 0u) {
        let stripe = step(0.5, fract(i.opos.x * 9.0 + sin(i.opos.y * 40.0) * 0.3));
        back = mix(vec3f(0.06, 0.2, 0.22), vec3f(0.2, 0.42, 0.42), stripe);
      } else if (v == 1u) {
        back = vec3f(0.22, 0.32, 0.45); belly = vec3f(0.88, 0.9, 0.95);
      } else {
        back = vec3f(0.85, 0.36, 0.12); belly = vec3f(0.95, 0.7, 0.4);
      }
      base = mix(belly, back, top);
      if (i.opos.x > 0.36 && abs(i.opos.y - 0.04) < 0.035 && abs(abs(i.opos.z) - 0.08) < 0.04) { base = vec3f(0.02); }
      spec = 0.7; gloss = 50.0;
    }
    case 26u: { spec = 0.05; }
    default: {}
  }
  sh = shadowAt(i.wpos, normalize(i.n));
  var c = lightAt(base, n, i.wpos, lp, spec, gloss, sh) + emis;
  return vec4f(c, alpha);
}

@fragment fn fs_scene(i: VOut) -> FOut {
  var o: FOut;
  o.color = shadeSurface(i);
  o.dist = vec4f(length(i.wpos - F.cam.xyz), 0.0, 0.0, 0.0);
  return o;
}

@fragment fn fs_jelly(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let V = normalize(F.cam.xyz - i.wpos);
  let fr = pow(1.0 - abs(dot(n, V)), 2.0);
  var c = vec3f(0.0);
  var a = 0.0;
  if (i.info.x == M_RING) {
    c = i.col * 1.1; a = 0.75;
  } else if (i.info.w == 0u) {
    c = mix(vec3f(0.75, 0.85, 0.9), vec3f(1.0), fr); a = 0.1 + 0.5 * fr;
    let sp = pow(max(dot(reflect(-V, n), F.sun.xyz), 0.0), 40.0);
    c = c + vec3f(sp) * 2.0; a = min(1.0, a + sp * 0.5);
  } else if (i.info.w == 1u) {
    c = i.col; a = 0.35 + 0.2 * fr;
  } else {
    c = i.col; a = 0.4;
  }
  return vec4f(c * a, a);
}
`;

  const particles = /* wgsl */`
struct PIn { @location(0) a: vec4f, @location(1) col: vec4f, @location(2) k: vec4f };
struct POut { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f, @location(2) @interpolate(flat) kind: u32 };
@vertex fn vs_particle(@builtin(vertex_index) vi: u32, p: PIn) -> POut {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  let ang = p.k.y;
  let rc = vec2f(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  let wp = jellyPos(p.a.xyz) + (F.camRight.xyz * rc.x + F.camUp.xyz * rc.y) * p.a.w;
  var o: POut;
  o.clip = F.viewProj * vec4f(wp, 1.0);
  o.uv = c; o.col = p.col; o.kind = u32(p.k.x);
  return o;
}
@fragment fn fs_particle(i: POut) -> @location(0) vec4f {
  let r = length(i.uv);
  if (r > 1.0) { discard; }
  var a = 0.0;
  if (i.kind == 0u) { a = (1.0 - r * r) * (1.0 - r * r); }
  else if (i.kind == 1u) { a = 1.0 - smoothstep(0.7, 1.0, r); }
  else { a = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r)) + 0.6 * smoothstep(0.5, 0.0, length(i.uv - vec2f(-0.35, 0.35))); }
  a = a * i.col.a;
  return vec4f(i.col.rgb * a, a);
}
`;

  const water = /* wgsl */`
@group(2) @binding(0) var sceneTex: texture_2d<f32>;
@group(2) @binding(1) var distTex: texture_2d<f32>;
@group(2) @binding(2) var backTex: texture_2d<f32>;

struct WIn { @location(0) d: vec4f };
struct WOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) lpos: vec3f,
  @location(2) n: vec3f,
  @location(3) @interpolate(flat) kind: u32,
};
fn sideNormal(s: f32) -> vec3f {
  if (s < 0.5) { return vec3f(1.0, 0.0, 0.0); }
  if (s < 1.5) { return vec3f(-1.0, 0.0, 0.0); }
  if (s < 2.5) { return vec3f(0.0, 0.0, 1.0); }
  return vec3f(0.0, 0.0, -1.0);
}
@vertex fn vs_water(v: WIn) -> WOut {
  var o: WOut;
  let xz = v.d.xy;
  let w = waterAt(xz);
  let surf = F.sun.w + w.x;
  let g = terrH(xz);
  var y = surf;
  var n = vec3f(0.0, 1.0, 0.0);
  let kind = u32(v.d.z + 0.5);
  if (kind == 1u) { y = g; n = sideNormal(v.d.w); }
  if (kind == 2u) { y = max(surf, g); n = sideNormal(v.d.w); }
  let lp = vec3f(xz.x, y, xz.y);
  o.lpos = lp; o.wpos = jellyPos(lp); o.n = jellyN(n);
  o.kind = select(0u, 1u, kind > 0u);
  o.clip = F.viewProj * vec4f(o.wpos, 1.0);
  return o;
}
@fragment fn fs_water_back(i: WOut) -> @location(0) vec4f {
  return vec4f(length(i.wpos - F.cam.xyz), 0.0, 0.0, 0.0);
}

fn surfNormal(xz: vec2f) -> vec3f {
  let e = 2.0 * HALF / F.misc.x;
  let l = waterAt(xz - vec2f(e, 0.0)).x; let r = waterAt(xz + vec2f(e, 0.0)).x;
  let d = waterAt(xz - vec2f(0.0, e)).x; let u = waterAt(xz + vec2f(0.0, e)).x;
  let t = F.cam.w;
  let rip = vec2f(noise2(xz * 38.0 + vec2f(t * 0.6, t * 0.4)) - 0.5, noise2(xz * 38.0 + vec2f(-t * 0.5, t * 0.7) + 11.0) - 0.5) * 0.06 * F.misc.w;
  return normalize(vec3f(-(r - l) / (2.0 * e) * 1.3 + rip.x, 1.0, -(u - d) / (2.0 * e) * 1.3 + rip.y));
}

fn toScreen(p: vec3f) -> vec2f {
  let c = F.viewProj * vec4f(p, 1.0);
  let ndc = c.xy / c.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@fragment fn fs_water(i: WOut) -> @location(0) vec4f {
  let pix = vec2i(i.clip.xy);
  let sceneD = textureLoad(distTex, pix, 0).r;
  let backD = textureLoad(backTex, pix, 0).r;
  let toCam = F.cam.xyz - i.wpos;
  let d = length(toCam);
  let V = toCam / d;
  let thick = max(min(sceneD, backD) - d, 0.0);
  let lp = i.lpos;
  let L = F.sun.xyz;
  let wv = waterAt(lp.xz);
  var n = normalize(i.n);
  var surfY = F.sun.w + wv.x;
  if (i.kind == 0u) { n = jellyN(surfNormal(lp.xz)); }

  let rd = refract(-V, n, 1.0 / 1.33);
  let travel = min(thick, 0.35) * select(0.6, 0.25, i.kind == 1u);
  var uv = toScreen(i.wpos + rd * travel);
  let uv0 = i.clip.xy * F.screen.zw;
  let pix2 = vec2i(clamp(uv * F.screen.xy, vec2f(0.0), F.screen.xy - 1.0));
  if (textureLoad(distTex, pix2, 0).r < d + 0.01) { uv = uv0; }
  let refr = textureSampleLevel(sceneTex, linSamp, uv, 0.0).rgb;

  let T = exp(-F.absorb.rgb * thick);
  let lightAmt = 0.55 + 0.6 * max(L.y, 0.0);
  var col = refr * T + F.scatter.rgb * (1.0 - T) * lightAmt;

  let dirL = qrot(qconj(F.tilt), -V);
  let steps = 8;
  let span = min(thick, 1.4);
  var shaft = 0.0;
  for (var s = 0; s < steps; s = s + 1) {
    let tt = (f32(s) + 0.5) / f32(steps) * span;
    let p = lp + dirL * tt;
    let under = max(F.sun.w - p.y, 0.0);
    if (under <= 0.0 || abs(p.x) > HALF || abs(p.z) > HALF) { continue; }
    let c = causticAt(p.xz + L.xz / L.y * under);
    shaft = shaft + max(c - 0.7, 0.0) * exp(-(under / L.y + tt) * 1.6);
  }
  col = col + F.scatter.rgb * shaft * span / f32(steps) * 1.6 * vec3f(1.2, 1.15, 1.0);

  let ndv = max(dot(n, V), 0.0);
  var fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  if (i.kind == 1u) { fres = fres * 0.6 + 0.03; }
  let r = reflect(-V, n);
  col = mix(col, envColor(r), fres);
  let H = normalize(L + V);
  col = col + vec3f(1.0, 0.95, 0.85) * pow(max(dot(n, H), 0.0), 700.0) * 5.0 * shadowAt(i.wpos, n);

  if (i.kind == 0u) {
    let t = F.cam.w;
    let fm = wv.y * F.scatter.w;
    let br = noise2(lp.xz * 70.0 + vec2f(t * 0.3, 0.0)) * 0.6 + noise2(lp.xz * 150.0 - vec2f(0.0, t * 0.2)) * 0.4;
    var foam = smoothstep(0.25, 0.75, fm * (0.5 + br));
    let depth = surfY - terrH(lp.xz);
    let lace = smoothstep(0.022, 0.0, depth) * smoothstep(0.45, 0.65, noise2(lp.xz * 55.0 + vec2f(t * 0.25, -t * 0.15)) + 0.15 * sin(t * 1.4 + depth * 120.0));
    foam = max(foam, lace * 0.9);
    let edge = HALF - max(abs(lp.x), abs(lp.z));
    let sh = shadowAt(i.wpos, n);
    let foamCol = vec3f(1.0, 0.99, 0.96) * (0.7 + 0.6 * sh * max(L.y, 0.2));
    col = mix(col, foamCol, clamp(foam, 0.0, 0.95));
    col = col + vec3f(0.9, 0.97, 1.0) * exp(-edge / 0.01) * 0.55;
  } else {
    let m = surfY - lp.y;
    col = col + vec3f(0.9, 0.98, 1.0) * (exp(-m / 0.005) * 1.1 + exp(-m / 0.03) * 0.12);
    let g = lp.y - terrH(lp.xz);
    col = col * (1.0 - 0.15 * exp(-g / 0.01));
  }
  return vec4f(col, 1.0);
}
`;

  const caustics = /* wgsl */`
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn causDisp(xz: vec2f, L: vec3f) -> vec2f {
  let e = 2.0 * HALF / F.misc.x;
  let l = waterAt(xz - vec2f(e, 0.0)).x; let r = waterAt(xz + vec2f(e, 0.0)).x;
  let d = waterAt(xz - vec2f(0.0, e)).x; let u = waterAt(xz + vec2f(0.0, e)).x;
  let n = normalize(vec3f(-(r - l) / (2.0 * e) * 3.0, 1.0, -(u - d) / (2.0 * e) * 3.0));
  let t = refract(-L, n, 0.75);
  let depth = clamp(F.sun.w - terrH(xz), 0.0, 0.8);
  return t.xz * depth / max(-t.y, 0.2);
}
@fragment fn fs_caustics(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let size = vec2f(256.0);
  let uv = fc.xy / size;
  let xz = uv * 2.0 * HALF - vec2f(HALF);
  let L = F.sun.xyz;
  let e = 2.0 * HALF / size.x * 1.5;
  let d0 = causDisp(xz, L);
  let dx = causDisp(xz + vec2f(e, 0.0), L) - d0;
  let dz = causDisp(xz + vec2f(0.0, e), L) - d0;
  let det = (1.0 + dx.x / e) * (1.0 + dz.y / e) - (dx.y / e) * (dz.x / e);
  let I = clamp(1.0 / max(abs(det), 0.12), 0.0, 3.5);
  return vec4f(I, 0.0, 0.0, 1.0);
}
`;

  const tone = /* wgsl */`
@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> TP: vec4f;
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn h12(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q = q + dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn soft(x: f32) -> f32 { if (x < 0.8) { return x; } return 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)); }
@fragment fn fs_tone(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  var c = textureLoad(hdrTex, vec2i(fc.xy), 0).rgb;
  c = vec3f(soft(c.r), soft(c.g), soft(c.b));
  let uv = fc.xy / TP.xy;
  let vig = 1.0 - 0.12 * pow(length(uv - vec2f(0.5, 0.45)) * 1.25, 2.5);
  c = c * vig;
  c = pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
  c = c + (h12(fc.xy + TP.z) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
`;

  root.HarborShaders = {
    scene: common + texBindings + sceneVS + sceneFS,
    particles: common + particles,
    water: common + texBindings + water,
    caustics: common + `
@group(1) @binding(0) var waterTex: texture_2d<f32>;
@group(1) @binding(1) var terrTex: texture_2d<f32>;
fn gridLoad(t: texture_2d<f32>, xz: vec2f) -> vec4f {
  let dims = vec2f(textureDimensions(t));
  let g = (xz + vec2f(HALF)) / (2.0 * HALF) * dims - 0.5;
  let i0 = floor(g);
  let f = clamp(g - i0, vec2f(0.0), vec2f(1.0));
  let mx = dims - 1.0;
  let a = vec2i(clamp(i0, vec2f(0.0), mx));
  let b = vec2i(clamp(i0 + 1.0, vec2f(0.0), mx));
  return mix(mix(textureLoad(t, a, 0), textureLoad(t, vec2i(b.x, a.y), 0), f.x), mix(textureLoad(t, vec2i(a.x, b.y), 0), textureLoad(t, b, 0), f.x), f.y);
}
fn waterAt(xz: vec2f) -> vec4f { return gridLoad(waterTex, xz); }
fn terrH(xz: vec2f) -> f32 { return gridLoad(terrTex, xz).r; }
` + caustics,
    tone,
  };

})(typeof window !== 'undefined' ? window : globalThis);
