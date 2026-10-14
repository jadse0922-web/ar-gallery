import * as THREE from 'three';

// =====================================================================
//  움직이는 미술관 — each drawing folder has meta.json describing its
//  characters ("actors") and which motion each one plays.
//  Units: drawing width = 1, drawing in the XY plane, +Z toward viewer.
// =====================================================================

const params = new URLSearchParams(location.search);
const START_ID = (params.get('id') || location.hash.replace('#', '') || '01').replace(/[^0-9a-zA-Z_-]/g, '') || '01';
const $ = (s) => document.querySelector(s);
const screens = { start: $('#start'), ar: $('#ar'), preview: $('#preview') };
function show(name) { for (const k in screens) screens[k].hidden = k !== name; }
const base = (id) => `drawings/${id}/`;

const MOTION_NAME = { run: '달려 나오기', hop: '통통 뛰기', swim: '헤엄치기', cheer: '공놀이', toss: '공놀이', grow: '커지며 튀어나오기', fly: '날아다니기', squish: '말랑말랑 점프', cruise: '헤엄치기', dash: '달려 나오기', spin: '빙글빙글 돌기', float: '둥실둥실', peek: '빼꼼 숨바꼭질' };
const MOTION_LEAD = { run: '달려 나와요', hop: '통통 뛰어나와요', swim: '헤엄쳐 나와요', cheer: '나와서 공놀이를 해요', grow: '커다랗게 튀어나와요', fly: '날아올라요', squish: '말랑말랑 뛰어나와요', cruise: '헤엄쳐 나와요', dash: '달려 나와요', spin: '빙글빙글 돌며 나와요', peek: '나와서 숨바꼭질을 해요' };
function mainMotion(meta) { const a = meta.actors.find((x) => !['toss', 'float'].includes(x.motion)) || meta.actors[0]; return a.motion; }
function withSubject(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return word + ((c - 0xac00) % 28 ? '이' : '가');
  return word + '이(가)';
}
async function fetchMeta(id) { const r = await fetch(base(id) + 'meta.json'); if (!r.ok) throw new Error('meta'); return r.json(); }

// ---------------------------------------------------------------- textures
const loader = new THREE.TextureLoader();
const tex = (url) => new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, rej));
const canvasTex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const radial = (g, stops) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, c]) => r.addColorStop(o, c)); g.fillStyle = r; g.fillRect(0, 0, 64, 64); };
const TX = {
  star: canvasTex((g) => { radial(g, [[0, 'rgba(255,255,230,1)'], [0.25, 'rgba(255,230,90,.9)'], [1, 'rgba(255,200,0,0)']]); g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.moveTo(32, 2); g.lineTo(36, 28); g.lineTo(62, 32); g.lineTo(36, 36); g.lineTo(32, 62); g.lineTo(28, 36); g.lineTo(2, 32); g.lineTo(28, 28); g.closePath(); g.fill(); }),
  dust: canvasTex((g) => radial(g, [[0, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']])),
  bubble: canvasTex((g) => { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke(); g.fillStyle = 'rgba(170,220,255,.35)'; g.fill(); g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(24, 23, 5, 0, Math.PI * 2); g.fill(); }),
  drop: canvasTex((g) => radial(g, [[0, 'rgba(235,248,255,1)'], [0.35, 'rgba(90,170,255,.85)'], [1, 'rgba(60,140,255,0)']])),
  shadow: canvasTex((g) => radial(g, [[0, 'rgba(0,0,0,.5)'], [1, 'rgba(0,0,0,0)']])),
};

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const frac = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;
const wrap = (a) => { a = a % TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
function keyframes(u, frames) { // frames: [[time, {props}], ...]
  if (u <= frames[0][0]) return { ...frames[0][1] };
  for (let i = 1; i < frames.length; i++) {
    const [t1, p1] = frames[i]; const [t0, p0] = frames[i - 1];
    if (u <= t1) { const g = ease((u - t0) / (t1 - t0)); const o = {}; for (const k in p1) o[k] = lerp(p0[k] ?? p1[k], p1[k], g); for (const k in p0) if (!(k in o)) o[k] = p0[k]; return o; }
  }
  return { ...frames[frames.length - 1][1] };
}

// Timeline (seconds within one loop)
const T_WAKE = 1.2, T_OUT = 2.2, ACT = 7.0, T_BACK = T_OUT + ACT, T_HOME = T_BACK + 1.2, LOOP = 12;
const OUT_Z = 0.4;

// ---------------------------------------------------------------- motions
// Each motion: { s: size when out, act(u, A, ctx) -> pose, tick?(u, A, ctx, pose, dt) }
// pose: {x, y, z, s, rz, ry, sx, sy, face, flap, bottom(bool: squash from feet)}
const M = {
  run: { s: 0.6, act(u, A, C) {
    const px = (v) => 0.4 * Math.sin(v * TAU / 3), pz = (v) => OUT_Z + 0.16 * Math.sin(v * TAU / 1.5);
    const hop = Math.abs(Math.sin(u * Math.PI * 3.2));
    const dx = px(u + 0.02) - px(u);
    return { x: px(u), y: C.gy + A.hh * 0.6 + hop * 0.08, z: pz(u), face: dx >= 0 ? 1 : -1, rz: -dx * 4 + Math.sin(u * 20) * 0.03, flap: Math.sin(u * 20) * 0.65 };
  }, tick(u, A, C, p) { A.every('dust', 0.31, () => C.fx(new THREE.Vector3(p.x, C.gy, p.z), 3, 'dust')); } },

  hop: { s: 0.55, act(u, A, C) {
    const T = 0.9, k = Math.floor(u / T), f = frac(u / T);
    const spots = [0, -0.27, 0, 0.27];
    const a = spots[k % 4], b = spots[(k + 1) % 4];
    const air = Math.sin(Math.PI * f);
    const land = f < 0.12 || f > 0.9;
    return { x: lerp(a, b, ease(f)), y: C.gy + A.hh * 0.55 + air * 0.22, z: OUT_Z + 0.06 * Math.sin(u),
      face: b === a ? 1 : Math.sign(b - a), sy: land ? 0.82 : 1 + 0.08 * air, sx: land ? 1.12 : 1 - 0.05 * air, bottom: true, rz: (b - a) * -0.3 * air };
  }, tick(u, A, C, p) { A.on('land', Math.floor(u / 0.9), () => C.fx(new THREE.Vector3(p.x, C.gy, p.z), 5, 'dust')); } },

  swim: { s: 0.55, act(u, A, C) {
    const w = TAU / 3.5, x = 0.32 * Math.sin(w * u), dx = Math.cos(w * u);
    return { x, y: 0.02 + 0.1 * Math.sin(2 * w * u), z: OUT_Z + 0.12 * Math.cos(w * u),
      face: (dx >= 0 ? 1 : -1) * (A.facing || 1), rz: 0.12 * Math.sin(5 * u) + 0.15 * Math.cos(2 * w * u) * (dx >= 0 ? -1 : 1) };
  }, tick(u, A, C, p) { A.every('bubble', 0.32, () => C.fx(new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.1, p.y + A.hh * p.s * 0.4, p.z), 1, 'bubble')); } },

  cheer: { s: 0.55, act(u, A, C) {
    const P = 1.6, off = A.side < 0 ? 0 : P / 2;
    const f = frac((u - off) / P);
    const hop = f < 0.35 ? Math.sin(Math.PI * f / 0.35) * 0.12 : 0;
    return { x: A.side * 0.27, y: C.gy + A.hh * 0.55 + hop + 0.012 * Math.sin(8 * u), z: OUT_Z, rz: 0.07 * Math.sin(6 * u + A.side), face: 1, sy: f > 0.33 && f < 0.42 ? 0.9 : 1, sx: f > 0.33 && f < 0.42 ? 1.06 : 1, bottom: true };
  } },

  toss: { s: 0.85, act(u, A, C) {
    const P = 1.6, f = frac(u / P), there = f < 0.5, g = ease(there ? f * 2 : (f - 0.5) * 2);
    const xa = -0.19, xb = 0.19, yb = C.gy + 0.26;
    return { x: there ? lerp(xa, xb, g) : lerp(xb, xa, g), y: yb + Math.sin(Math.PI * g) * 0.24, z: OUT_Z + 0.03, rz: -u * 9 };
  } },

  grow: { s: 1, act(u, A, C) {
    const g = ease(clamp(u / 1.2)) * (1 - ease(clamp((u - 6.2) / 0.8)));
    return { x: 0, y: 0.03 * Math.sin(1.5 * u), z: OUT_Z * 0.9, s: 1 + 0.35 * g, ry: 0.38 * Math.sin(0.9 * u) * g, rz: 0.04 * Math.sin(2 * u) };
  }, tick(u, A, C, p) { A.every('burst', 1.1, () => C.fx(new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.5, p.y + (Math.random() - 0.2) * 0.5, p.z + 0.05), 8, 'star')); } },

  fly: { s: 0.55, act(u, A, C) {
    const w = TAU / 3.5, vx = Math.cos(w * u);
    return { x: 0.33 * Math.sin(w * u), y: 0.08 + 0.12 * Math.sin(2 * w * u) + 0.03 * Math.sin(9 * u), z: OUT_Z + 0.12 * Math.cos(w * u), rz: -vx * 0.25, face: 1 };
  }, tick(u, A, C, p) { A.every('trail', 0.12, () => C.fx(new THREE.Vector3(p.x, p.y - A.hh * p.s * 0.3, p.z - 0.02), 1, 'twinkle')); } },

  squish: { s: 0.55, act(u, A, C) {
    const T = 1.5, k = Math.floor(u / T), f = frac(u / T);
    const spots = [0, -0.22, 0.22, 0, 0.2];
    const a = spots[k % 5], b = spots[(k + 1) % 5];
    let x = a, y = C.gy + A.hh * 0.55, sy = 1, sx = 1;
    if (f < 0.25) { sy = 1 - 0.35 * Math.sin((f / 0.25) * Math.PI / 2); sx = 1 + (1 - sy) * 0.7; }
    else if (f < 0.7) { const g = (f - 0.25) / 0.45; x = lerp(a, b, ease(g)); y += Math.sin(Math.PI * g) * 0.24; sy = 1.18 - 0.1 * Math.sin(Math.PI * g); sx = 0.86 + 0.06 * Math.sin(Math.PI * g); }
    else { const g = (f - 0.7) / 0.3; x = b; sy = 1 - 0.32 * Math.exp(-3 * g) * Math.cos(13 * g); sx = 1 + (1 - sy) * 0.8; }
    return { x, y, z: OUT_Z, sx, sy, bottom: true, face: 1 };
  }, tick(u, A, C, p) { A.on('land', Math.floor((u + 0.45) / 1.5), () => C.fx(new THREE.Vector3(p.x, C.gy, p.z), 6, 'dust')); } },

  cruise: { s: 0.55, act(u, A, C) {
    const w = TAU / 7, dx = Math.cos(w * u);
    return { x: 0.24 * Math.sin(w * u), y: C.H / 2 - 0.09 - A.hh * 0.55 + 0.025 * Math.sin(2 * u), z: OUT_Z * 0.85 + 0.1 * Math.cos(w * u), face: (dx >= 0 ? 1 : -1) * (A.facing || 1), rz: 0.04 * Math.sin(1.5 * u) };
  }, tick(u, A, C, p) { A.every('spout', 1.7, () => C.fx(new THREE.Vector3(p.x + p.face * A.hw * p.s * 0.35, p.y + A.hh * p.s * 0.9, p.z), 10, 'drop')); } },

  dash: { s: 0.5, act(u, A, C) {
    const px = (v) => 0.3 * Math.sin(v * TAU / 3.5 + Math.PI);
    const dx = px(u + 0.02) - px(u);
    return { x: px(u), y: C.gy + A.hh * 0.5 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.05, z: OUT_Z + 0.1 + 0.08 * Math.sin(u * TAU / 1.75), face: (dx >= 0 ? 1 : -1) * (A.facing || 1), rz: Math.sin(u * 18) * 0.04 };
  }, tick(u, A, C, p) { A.every('dust', 0.34, () => C.fx(new THREE.Vector3(p.x, C.gy, p.z), 3, 'dust')); } },

  spin: { s: 0.55, act(u, A, C) {
    return { x: 0.15 * Math.sin(u * TAU / 7), y: 0.04 + 0.12 * Math.sin(u * TAU / 3.5), z: OUT_Z, ry: TAU * 6 * ease(u / ACT), rz: 0.05 * Math.sin(3 * u) };
  }, tick(u, A, C, p) { A.every('twinkle', 0.2, () => C.fx(new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.3, p.y + A.hh * p.s * 0.6, p.z), 1, 'twinkle')); } },

  float: { s: 0.8, act(u, A, C) {
    return { x: A.hx * 0.6 + 0.06 * Math.sin(1.3 * u), y: C.H / 2 - A.hh * 0.5 + 0.04 * Math.sin(1.7 * u), z: OUT_Z * 0.55, rz: 0.12 * Math.sin(1.1 * u), face: 1 };
  } },

  peek: { s: 0.5, act(u, A, C) {
    const s = 0.5, hw = A.hw * s, hh = A.hh * s, ground = C.gy + hh;
    const hideX = -0.5 + hw * 1.08, peekX = -0.5 + hw * 0.3, topHide = C.H / 2 - hh * 1.08, topPeek = C.H / 2 - hh * 0.25;
    const f = keyframes(u, [
      [0.0, { x: 0, y: ground, z: OUT_Z, rz: 0 }],
      [0.9, { x: -0.66, y: ground, z: OUT_Z * 0.5, rz: 0.05 }],
      [1.5, { x: hideX, y: -0.02, z: -0.08, rz: 0 }],
      [2.2, { x: peekX, y: -0.02, z: -0.08, rz: 0.22 }],
      [2.7, { x: hideX, y: -0.02, z: -0.08, rz: 0 }],
      [3.4, { x: peekX, y: -0.1, z: -0.08, rz: 0.3 }],
      [3.9, { x: hideX, y: -0.1, z: -0.08, rz: 0 }],
      [4.4, { x: 0.05, y: topHide, z: -0.08, rz: 0 }],
      [5.3, { x: 0.05, y: topPeek, z: -0.08, rz: -0.08 }],
      [6.1, { x: 0.05, y: ground, z: OUT_Z, rz: 0 }],
      [7.0, { x: 0, y: ground, z: OUT_Z, rz: 0 }],
    ]);
    let y = f.y; if (u > 5.3 && u < 6.1) y += Math.sin(Math.PI * (u - 5.3) / 0.8) * 0.35; // jump over the top edge
    if (u > 6.1) f.rz = 0.12 * Math.sin((u - 6.1) * 14) * (1 - (u - 6.1) / 0.9);
    return { x: f.x, y, z: f.z, rz: f.rz, s, face: u < 1.5 ? -1 : 1 };
  }, tick(u, A, C, p) { A.on('pop', u > 5.3 ? 1 : 0, (v) => v && C.fx(new THREE.Vector3(p.x, p.y + A.hh * p.s, 0.06), 14, 'star')); } },
};

// ---------------------------------------------------------------- scene
async function buildScene(id, meta, { withBase }) {
  const Hn = meta.H / meta.W, k = 1 / meta.W;
  const root = new THREE.Group();
  const C = { H: Hn, gy: -Hn / 2 + 0.06, fx: null };
  const B = base(id);

  // depth-only occluder = the drawing itself (characters can hide behind it)
  // (in the preview the photo plane itself does this job)
  if (!withBase) {
    const occ = new THREE.Mesh(new THREE.PlaneGeometry(1, Hn), new THREE.MeshBasicMaterial({ colorWrite: false }));
    occ.renderOrder = -1; root.add(occ);
  }

  if (withBase) {
    const bt = await tex(B + 'target.jpg');
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(1, Hn), new THREE.MeshBasicMaterial({ map: bt }));
    bm.position.z = -0.002; root.add(bm);
  }

  // empty-spot patch shown while characters are out
  const P = meta.plate;
  const plateMat = new THREE.MeshBasicMaterial({ map: await tex(B + P.img), transparent: true, opacity: 0, depthWrite: false });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(P.w * k, P.h * k), plateMat);
  plate.position.set((P.x + P.w / 2) * k - 0.5, Hn / 2 - (P.y + P.h / 2) * k, 0.001);
  root.add(plate);

  // particles
  const fx = [];
  const blend = { star: THREE.AdditiveBlending, twinkle: THREE.AdditiveBlending };
  C.fx = (pos, n, kind) => {
    for (let i = 0; i < n; i++) {
      const t = kind === 'twinkle' ? 'star' : kind;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX[t], transparent: true, depthWrite: false, blending: blend[kind] || THREE.NormalBlending }));
      sp.position.copy(pos);
      const a = Math.random() * TAU; let v, life, size, grav = 0, grow = 1;
      if (kind === 'star') { const s = 0.6 + Math.random() * 0.8; v = new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, Math.random() * 0.6); life = 0.9; size = 0.05 + Math.random() * 0.05; }
      else if (kind === 'twinkle') { v = new THREE.Vector3((Math.random() - 0.5) * 0.15, -0.1 - Math.random() * 0.1, 0); life = 0.8; size = 0.025 + Math.random() * 0.03; grow = 0; }
      else if (kind === 'bubble') { v = new THREE.Vector3((Math.random() - 0.5) * 0.06, 0.22 + Math.random() * 0.1, 0); life = 1.4; size = 0.025 + Math.random() * 0.03; grow = 0.2; }
      else if (kind === 'drop') { v = new THREE.Vector3((Math.random() - 0.5) * 0.35, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.1); life = 1.0; size = 0.03 + Math.random() * 0.025; grav = 1.6; grow = 0; }
      else { const s = 0.15 + Math.random() * 0.2; v = new THREE.Vector3(Math.cos(a) * s, Math.abs(Math.sin(a)) * s * 0.3, Math.sin(a) * s * 0.3); life = 0.55; size = 0.07 + Math.random() * 0.05; }
      sp.userData = { v, life: 0, max: life, size, grav, grow, damp: kind === 'star' || kind === 'dust' };
      sp.scale.setScalar(size); root.add(sp); fx.push(sp);
    }
  };

  // actors
  const actors = [];
  for (const a of meta.actors) {
    const A = { ...a, hw: (a.w * k) / 2, hh: (a.h * k) / 2, hx: (a.x + a.w / 2) * k - 0.5, hy: Hn / 2 - (a.y + a.h / 2) * k, delay: a.delay || 0, facing: a.facing || 1 };
    A.mot = M[a.motion] || M.hop;
    const g = new THREE.Group(); const inner = new THREE.Group(); g.add(inner); root.add(g);
    const mat = (t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
    if (a.wings) {
      const [s1, s2] = a.wings.split; const [tl, tb, tr] = await Promise.all(a.wings.imgs.map((f) => tex(B + f)));
      const cx = (x) => (x - a.w / 2) * k;
      const piece = (t, x0, x1) => new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * k, a.h * k), mat(t));
      const body = piece(tb, s1, s2); body.position.x = cx((s1 + s2) / 2); inner.add(body);
      A.pivL = new THREE.Group(); A.pivL.position.x = cx(s1); inner.add(A.pivL);
      const wl = piece(tl, 0, s1); wl.position.set(-(s1 * k) / 2, 0, -0.001); A.pivL.add(wl);
      A.pivR = new THREE.Group(); A.pivR.position.x = cx(s2); inner.add(A.pivR);
      const wr = piece(tr, s2, a.w); wr.position.set(((a.w - s2) * k) / 2, 0, -0.001); A.pivR.add(wr);
    } else {
      inner.add(new THREE.Mesh(new THREE.PlaneGeometry(a.w * k, a.h * k), mat(await tex(B + a.img))));
    }
    A.g = g; A.inner = inner;
    const sm = new THREE.MeshBasicMaterial({ map: TX.shadow, transparent: true, depthWrite: false, opacity: 0 });
    A.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.35), sm); A.shadow.rotation.x = -Math.PI / 2; root.add(A.shadow);
    A.timers = {}; A.marks = {};
    A.every = (name, period, fn) => { A.timers[name] = (A.timers[name] || 0) + A._dt; if (A.timers[name] >= period) { A.timers[name] = 0; fn(); } };
    A.on = (name, value, fn) => { if (A.marks[name] !== undefined && A.marks[name] !== value) fn(value); A.marks[name] = value; };
    actors.push(A);
  }

  const home = (A) => ({ x: A.hx, y: A.hy, z: 0.003, s: 1, rz: 0, ry: 0, sx: 1, sy: 1, face: 1, flap: 0 });
  const full = (p, A) => ({ s: A.mot.s, rz: 0, ry: 0, sx: 1, sy: 1, face: 1, flap: 0, ...p });

  function poseAt(A, L) {
    const l = L - A.delay;
    const h = home(A);
    if (l < T_WAKE) { const w = clamp((l - 0.5) / 0.7); return { ...h, rz: Math.sin(l * 40) * 0.05 * w, flap: Math.sin(l * 10) * 0.3 * w, phase: 'wake', l }; }
    if (l < T_OUT) {
      const g = ease((l - T_WAKE) / (T_OUT - T_WAKE)); const e = full(A.mot.act(0, A, C), A);
      return { x: lerp(h.x, e.x, g), y: lerp(h.y, e.y, g) + Math.sin(g * Math.PI) * 0.25, z: lerp(h.z, e.z, g), s: lerp(1, e.s, g), rz: lerp(0, wrap(e.rz), g), ry: lerp(0, wrap(e.ry), g),
        sx: lerp(1, e.sx, g), sy: lerp(1, e.sy, g), face: g < 0.5 ? 1 : e.face, flap: Math.sin(l * 22) * 0.7, phase: 'out', g };
    }
    if (l < T_BACK) { const u = l - T_OUT; return { ...full(A.mot.act(u, A, C), A), phase: 'act', u }; }
    if (l < T_HOME) {
      const g = ease((l - T_BACK) / (T_HOME - T_BACK)); const e = full(A.mot.act(ACT, A, C), A);
      return { x: lerp(e.x, h.x, g), y: lerp(e.y, h.y, g) + Math.sin(g * Math.PI) * 0.3, z: lerp(e.z, h.z, g), s: lerp(e.s, 1, g), rz: lerp(wrap(e.rz), 0, g), ry: lerp(wrap(e.ry), 0, g),
        sx: lerp(e.sx, 1, g), sy: lerp(e.sy, 1, g), face: g < 0.5 ? e.face : 1, flap: Math.sin(l * 22) * 0.7 * (1 - g), phase: 'back', g };
    }
    return { ...h, flap: Math.sin(l * 2.5) * 0.08, phase: 'rest' };
  }

  let t = 0;
  function reset() { t = 0; for (const A of actors) { A.timers = {}; A.marks = {}; A.flags = {}; } }
  reset();

  function update(dt) {
    t += dt; const L = t % LOOP;
    if (L < dt) for (const A of actors) A.flags = {};
    let out = 0;
    for (const A of actors) {
      A._dt = dt;
      const p = poseAt(A, L);
      if (p.phase === 'wake' && p.l > 1.05 && !A.flags.glow) { A.flags.glow = 1; C.fx(new THREE.Vector3(A.hx, A.hy, 0.05), 10, 'star'); }
      if (p.phase === 'out' && !A.flags.pop) { A.flags.pop = 1; C.fx(new THREE.Vector3(A.hx, A.hy, 0.1), 22, 'star'); }
      if (p.phase === 'back' && p.g > 0.96 && !A.flags.land) { A.flags.land = 1; C.fx(new THREE.Vector3(A.hx, A.hy, 0.06), 14, 'star'); }
      if (p.phase === 'act' && A.mot.tick) A.mot.tick(p.u, A, C, p, dt);
      if (p.phase === 'out') out = Math.max(out, clamp(p.g * 3)); else if (p.phase === 'act') out = 1; else if (p.phase === 'back') out = Math.max(out, 1 - clamp((p.g - 0.7) / 0.3));

      const flip = A.flip === false ? 1 : p.face;
      let y = p.y;
      if (p.bottom) y -= (1 - p.sy) * A.hh * p.s; // squash from the feet
      A.g.position.set(p.x, y, p.z);
      A.g.rotation.set(0, p.ry, p.rz);
      A.inner.scale.set(p.s * p.sx * flip, p.s * p.sy, 1);
      if (A.pivL) { A.pivL.rotation.y = -Math.abs(p.flap) - 0.02; A.pivR.rotation.y = Math.abs(p.flap) + 0.02; }

      const lifted = clamp((p.z - 0.02) / 0.25);
      A.shadow.position.set(p.x, C.gy - 0.005, Math.max(p.z, 0.01));
      A.shadow.scale.set(A.hw * 2 * p.s * 0.9, A.hw * 2 * p.s * 0.9, 1);
      const air = clamp((y - A.hh * p.s - C.gy) / 0.5);
      A.shadow.material.opacity = 0.7 * lifted * (1 - air * 0.7);
    }
    plateMat.opacity = out;

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], d = f.userData; d.life += dt;
      d.v.y -= d.grav * dt; f.position.addScaledVector(d.v, dt); if (d.damp) d.v.multiplyScalar(0.94);
      f.material.opacity = Math.max(0, 1 - d.life / d.max);
      f.scale.setScalar(d.size * (1 + d.life * d.grow));
      if (d.life > d.max) { root.remove(f); f.material.dispose(); fx.splice(i, 1); }
    }
  }

  function dispose() {
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && !Object.values(TX).includes(o.material.map)) o.material.map.dispose(); o.material.dispose(); } });
  }
  return { root, update, reset, dispose, H: Hn };
}

// ---------------------------------------------------------------- UI text
function applyMeta(meta) {
  document.querySelectorAll('[data-title]').forEach((el) => (el.textContent = '움직이는 미술관 · ' + meta.title));
  $('#h-title').textContent = withSubject(meta.title);
  const mm = mainMotion(meta);
  $('#start-msg').innerHTML = '';
  $('#start-msg').append('카메라를 켜고 액자 속 그림을 비추면,', document.createElement('br'), `그림 속 친구가 ${MOTION_LEAD[mm] || '나와요'}.`);
  const th = $('#thumb'); th.style.aspectRatio = `${meta.W} / ${meta.H}`; th.style.width = meta.W > meta.H ? '210px' : '150px';
  th.style.backgroundImage = `url(${base(CURRENT)}target.jpg)`;
  const sc = $('#scan'); sc.style.aspectRatio = `${meta.W} / ${meta.H}`; sc.style.width = meta.W > meta.H ? 'min(86vw, 420px)' : 'min(64vw, 300px)';
}

// ---------------------------------------------------------------- AR mode
let CURRENT = START_ID, META = null, arState = null;
async function startAR() {
  show('ar');
  $('#ar-status').textContent = '카메라를 켜는 중이에요…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    const { MindARThree } = await import('mindar-image-three');
    const mindar = new MindARThree({ container: $('#ar-stage'), imageTargetSrc: base(CURRENT) + 'target.mind', uiLoading: 'no', uiScanning: 'no', uiError: 'no', filterMinCF: 0.0001, filterBeta: 0.01 });
    const { renderer, scene, camera } = mindar;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const anchor = mindar.addAnchor(0);
    const s = await buildScene(CURRENT, META, { withBase: false });
    anchor.group.add(s.root);
    let found = false;
    anchor.onTargetFound = () => { found = true; s.reset(); $('#scan').hidden = true; $('#ar-status').textContent = ''; };
    anchor.onTargetLost = () => { found = false; $('#scan').hidden = false; $('#ar-status').textContent = '그림을 다시 비춰 주세요'; };
    await mindar.start();
    $('#ar-status').textContent = '액자가 노란 테두리 안에 꽉 차게 비춰 주세요';
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => { const dt = Math.min(clock.getDelta(), 0.05); if (found) s.update(dt); renderer.render(scene, camera); });
    arState = { mindar, s };
  } catch (e) {
    console.warn(e); show('start'); $('#cam-error').hidden = false;
  }
}

// ---------------------------------------------------------------- Preview mode
let pv = null, LIST = null;
async function loadList() {
  if (LIST) return LIST;
  try { const r = await fetch('drawings/index.json'); LIST = r.ok ? await r.json() : null; } catch { LIST = null; }
  if (!LIST || !LIST.length) LIST = [{ id: CURRENT, title: META?.title || '' }];
  return LIST;
}
async function startPreview() {
  show('preview');
  await loadList();
  if (!pv) {
    const host = $('#pv-stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
    pv = { renderer, scene, camera, host, s: null, group: null, H: 1.4, busy: false };
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const tanv = Math.tan((camera.fov * Math.PI) / 360);
      const needH = pv.H * 1.3 + 0.18, needW = pv.H < 1 ? 1.25 : 1.42;
      const dist = Math.max(needH / 2 / tanv, needW / 2 / tanv / camera.aspect) + 0.15;
      camera.position.set(0.18, -0.12, dist); camera.lookAt(0, -0.1, 0); camera.updateProjectionMatrix();
    };
    pv.resize = resize; new ResizeObserver(resize).observe(host);
    const clock = new THREE.Clock();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setAnimationLoop(() => { const dt = Math.min(clock.getDelta(), 0.05); if (pv.s) pv.s.update(reduce ? dt * 0.6 : dt); renderer.render(scene, camera); });
  }
  await showInPreview(CURRENT);
}
async function showInPreview(id) {
  if (pv.busy) return; pv.busy = true;
  try {
    const meta = id === CURRENT && META ? META : await fetchMeta(id);
    const s = await buildScene(id, meta, { withBase: true });
    const group = new THREE.Group(); group.add(s.root);
    if (!meta.frame) { // drawing photographed without its frame: draw one
      const fm = new THREE.MeshBasicMaterial({ color: 0xd8b98a }), fw = 0.06, H = s.H;
      [[1 + fw * 2, fw, 0, H / 2 + fw / 2], [1 + fw * 2, fw, 0, -H / 2 - fw / 2], [fw, H, -0.5 - fw / 2, 0], [fw, H, 0.5 + fw / 2, 0]].forEach(([w, h, x, y]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), fm); b.position.set(x, y, 0); group.add(b); });
    }
    if (pv.group) { pv.scene.remove(pv.group); pv.s.dispose(); }
    pv.scene.add(group); pv.group = group; pv.s = s; pv.H = s.H; pv.resize();
    CURRENT = id; META = meta; applyMeta(meta);
    const i = LIST.findIndex((x) => x.id === id);
    $('#pv-count').textContent = `${i + 1} / ${LIST.length}`;
    $('#pv-motion').textContent = MOTION_NAME[mainMotion(meta)] ? `‘${MOTION_NAME[mainMotion(meta)]}’` : '';
    $('#pv-prev').disabled = i <= 0; $('#pv-next').disabled = i < 0 || i >= LIST.length - 1;
    const solo = LIST.length < 2; $('#pv-prev').hidden = solo; $('#pv-next').hidden = solo; $('#pv-count').hidden = solo;
  } catch (e) { console.warn(e); }
  pv.busy = false;
}
function step(d) { const i = LIST.findIndex((x) => x.id === CURRENT); const n = LIST[i + d]; if (n) showInPreview(n.id); }

// ---------------------------------------------------------------- wire up
$('#btn-ar').addEventListener('click', startAR);
$('#btn-preview').addEventListener('click', startPreview);
$('#btn-preview2').addEventListener('click', () => { location.reload(); });
$('#pv-back').addEventListener('click', () => show('start'));
$('#ar-replay').addEventListener('click', () => arState?.s.reset());
$('#pv-replay').addEventListener('click', () => pv?.s?.reset());
$('#pv-prev').addEventListener('click', () => step(-1));
$('#pv-next').addEventListener('click', () => step(1));

fetchMeta(CURRENT).then((m) => {
  META = m; applyMeta(m);
  if (params.has('preview') || window.__PREVIEW_ONLY__) startPreview();
}).catch(() => {
  $('#start-msg').textContent = '이 QR에 연결된 그림이 아직 준비되지 않았어요. 선생님께 알려 주세요.';
  $('#btn-ar').disabled = true;
  if (window.__PREVIEW_ONLY__) { CURRENT = '01'; fetchMeta('01').then((m) => { META = m; applyMeta(m); startPreview(); }); }
});
