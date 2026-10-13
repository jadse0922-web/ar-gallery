import * as THREE from 'three';

// ---------- which drawing ----------
const params = new URLSearchParams(location.search);
const ID = (params.get('id') || location.hash.replace('#', '') || '01').replace(/[^0-9a-zA-Z_-]/g, '') || '01';
const BASE = `drawings/${ID}/`;

const $ = (s) => document.querySelector(s);
const screens = { start: $('#start'), ar: $('#ar'), preview: $('#preview') };
function show(name) { for (const k in screens) screens[k].hidden = k !== name; }

let META;
async function loadMeta() {
  const r = await fetch(BASE + 'meta.json');
  if (!r.ok) throw new Error('meta');
  META = await r.json();
  document.querySelectorAll('[data-title]').forEach((el) => (el.textContent = META.title));
}

// ---------- shared textures ----------
const loader = new THREE.TextureLoader();
function tex(url) {
  return new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
}
function dotTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'star') {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.25, 'rgba(255,230,90,0.9)'); grd.addColorStop(1, 'rgba(255,200,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.moveTo(32, 2); g.lineTo(36, 28); g.lineTo(62, 32); g.lineTo(36, 36); g.lineTo(32, 62); g.lineTo(28, 36); g.lineTo(2, 32); g.lineTo(28, 28); g.closePath(); g.fill();
  } else if (kind === 'dust') {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  } else {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- the creature that runs out of the drawing ----------
// Units: drawing width = 1. Drawing lies in the XY plane, +Z points toward the viewer.
async function buildScene(withBasePhoto) {
  const m = META, k = 1 / m.targetW;
  const H = m.targetH * k;
  const root = new THREE.Group();

  const [plateT, wl, bd, wr, baseT] = await Promise.all([
    tex(BASE + 'plate.jpg'), tex(BASE + 'wingL.png'), tex(BASE + 'body.png'), tex(BASE + 'wingR.png'),
    withBasePhoto ? tex(BASE + 'target.jpg') : Promise.resolve(null),
  ]);

  if (baseT) {
    const base = new THREE.Mesh(new THREE.PlaneGeometry(1, H), new THREE.MeshBasicMaterial({ map: baseT }));
    base.position.z = -0.002; root.add(base);
  }
  // "empty" drawing that appears once the character has left
  const plateMat = new THREE.MeshBasicMaterial({ map: plateT, transparent: true, opacity: 0 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, H), plateMat);
  root.add(plate);

  const shadowMat = new THREE.MeshBasicMaterial({ map: dotTexture('shadow'), transparent: true, depthWrite: false, opacity: 0 });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.25), shadowMat);
  shadow.position.z = 0.002; root.add(shadow);

  const cw = m.char.w * k, ch = m.char.h * k;
  const homeX = (m.char.x + m.char.w / 2) * k - 0.5;
  const homeY = H / 2 - (m.char.y + m.char.h / 2) * k;
  const [s1, s2] = m.split;

  const creature = new THREE.Group();
  creature.position.set(homeX, homeY, 0.004);
  root.add(creature);
  const mat = (t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  const piece = (t, x0, x1) => new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * k, ch), mat(t));
  const cx = (x) => (x - m.char.w / 2) * k; // char-local x

  const body = piece(bd, s1, s2); body.position.x = cx((s1 + s2) / 2); creature.add(body);
  const pivL = new THREE.Group(); pivL.position.x = cx(s1); creature.add(pivL);
  const wingL = piece(wl, 0, s1); wingL.position.x = -(s1 * k) / 2; wingL.position.z = -0.001; pivL.add(wingL);
  const pivR = new THREE.Group(); pivR.position.x = cx(s2); creature.add(pivR);
  const wingR = piece(wr, s2, m.char.w); wingR.position.x = ((m.char.w - s2) * k) / 2; wingR.position.z = -0.001; pivR.add(wingR);

  // particles
  const fx = [];
  const starT = dotTexture('star'), dustT = dotTexture('dust');
  function burst(pos, n, kind) {
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: kind === 'star' ? starT : dustT, transparent: true, depthWrite: false, blending: kind === 'star' ? THREE.AdditiveBlending : THREE.NormalBlending }));
      sp.position.copy(pos);
      const a = Math.random() * Math.PI * 2, sp0 = kind === 'star' ? 0.6 + Math.random() * 0.8 : 0.15 + Math.random() * 0.2;
      sp.userData = { v: new THREE.Vector3(Math.cos(a) * sp0, Math.sin(a) * sp0 * (kind === 'dust' ? 0.3 : 1), (Math.random() * 0.6) * (kind === 'star' ? 1 : 0.2)), life: 0, max: kind === 'star' ? 0.9 : 0.55, size: kind === 'star' ? 0.05 + Math.random() * 0.05 : 0.08 + Math.random() * 0.06 };
      sp.scale.setScalar(sp.userData.size);
      root.add(sp); fx.push(sp);
    }
  }

  // ---------- timeline ----------
  const home = new THREE.Vector3(homeX, homeY, 0.004);
  const groundY = -H / 2 + 0.26; // where it runs, in front of the lower part of the frame
  const OUT_Z = 0.42, SMALL = 0.6, LOOP = 11.5;
  const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const runPos = (u) => new THREE.Vector3(0.4 * Math.sin(u * Math.PI * 2 / 3), groundY, OUT_Z + 0.18 * Math.sin(u * Math.PI * 4 / 3));
  let t = 0, lastHop = 0, flags = {};

  function reset() { t = 0; lastHop = 0; flags = {}; }

  function update(dt) {
    t += dt;
    const L = t % LOOP;
    if (L < dt) flags = {};
    let p = home.clone(), s = 1, flap = Math.sin(t * 3) * 0.12, tilt = 0, face = 1, plateO = 0;

    if (L < 1.3) {                        // waking up inside the drawing
      const w = Math.max(0, (L - 0.6) / 0.7);
      tilt = Math.sin(L * 40) * 0.05 * w;
      flap = Math.sin(t * 10) * 0.3 * w;
      if (L > 1.1 && !flags.glow) { flags.glow = 1; burst(home.clone().setZ(0.05), 14, 'star'); }
    } else if (L < 2.3) {                 // jump out toward the viewer
      const u = ease((L - 1.3) / 1.0);
      const end = runPos(0);
      p.set(lerp(home.x, end.x, u), lerp(home.y, end.y, u) + Math.sin(u * Math.PI) * 0.28, lerp(home.z, end.z, u));
      s = lerp(1, SMALL, u); flap = Math.sin(t * 22) * 0.7; plateO = Math.min(1, u * 3);
      if (!flags.pop) { flags.pop = 1; burst(home.clone().setZ(0.1), 26, 'star'); }
    } else if (L < 8.5) {                 // run around in front of the frame
      const u = L - 2.3;
      const a = runPos(u), b = runPos(u + 0.02);
      const hop = Math.abs(Math.sin(u * Math.PI * 3.2));
      p.copy(a); p.y += hop * 0.09;
      s = SMALL * (1 + (1 - hop) * 0.04);
      face = b.x >= a.x ? 1 : -1;
      tilt = -(b.x - a.x) * 4 + Math.sin(u * 20) * 0.03;
      flap = Math.sin(t * 20) * 0.65; plateO = 1;
      const hopIdx = Math.floor(u * 3.2);
      if (hopIdx !== lastHop) { lastHop = hopIdx; burst(new THREE.Vector3(a.x, groundY - 0.05, a.z), 3, 'dust'); }
    } else if (L < 9.6) {                 // jump back into the drawing
      const u = ease((L - 8.5) / 1.1);
      const st = runPos(6.2);
      p.set(lerp(st.x, home.x, u), lerp(st.y, home.y, u) + Math.sin(u * Math.PI) * 0.35, lerp(st.z, home.z, u));
      s = lerp(SMALL, 1, u); flap = Math.sin(t * 22) * 0.7 * (1 - u); plateO = 1 - Math.max(0, (u - 0.7) / 0.3);
      if (u > 0.97 && !flags.land) { flags.land = 1; burst(home.clone().setZ(0.06), 18, 'star'); }
    } else {                              // rest
      flap = Math.sin(t * 2.5) * 0.08;
    }

    creature.position.copy(p);
    creature.scale.set(s * face, s, s);
    creature.rotation.z = tilt;
    pivL.rotation.y = -Math.abs(flap) - 0.02;
    pivR.rotation.y = Math.abs(flap) + 0.02;
    plateMat.opacity = plateO;

    const lifted = Math.min(1, (p.z - 0.004) / 0.3);
    shadow.position.set(p.x, Math.min(p.y, groundY) - 0.12 * s, 0.003);
    shadow.scale.set(s * 1.4, s * 1.4, 1);
    shadowMat.opacity = 0.75 * lifted;

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], d = f.userData; d.life += dt;
      f.position.addScaledVector(d.v, dt); d.v.multiplyScalar(0.94);
      f.material.opacity = Math.max(0, 1 - d.life / d.max);
      f.scale.setScalar(d.size * (1 + d.life));
      if (d.life > d.max) { root.remove(f); f.material.dispose(); fx.splice(i, 1); }
    }
  }
  return { root, update, reset, H };
}

// ---------- AR mode (phone camera, MindAR image tracking) ----------
let arState = null;
async function startAR() {
  show('ar');
  $('#ar-status').textContent = '카메라를 켜는 중이에요…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    const { MindARThree } = await import('mindar-image-three');
    const mindar = new MindARThree({
      container: $('#ar-stage'),
      imageTargetSrc: BASE + 'target.mind',
      uiLoading: 'no', uiScanning: 'no', uiError: 'no',
      filterMinCF: 0.0001, filterBeta: 0.01,
    });
    const { renderer, scene, camera } = mindar;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const anchor = mindar.addAnchor(0);
    const s = await buildScene(false);
    anchor.group.add(s.root);
    let found = false;
    anchor.onTargetFound = () => { found = true; s.reset(); $('#scan').hidden = true; $('#ar-status').textContent = ''; };
    anchor.onTargetLost = () => { found = false; $('#scan').hidden = false; $('#ar-status').textContent = '그림을 다시 비춰 주세요'; };
    await mindar.start();
    $('#ar-status').textContent = '액자 속 그림이 화면에 가득 차게 비춰 주세요';
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (found) s.update(dt);
      renderer.render(scene, camera);
    });
    arState = { mindar, s };
  } catch (e) {
    console.warn(e);
    show('start');
    $('#cam-error').hidden = false;
  }
}

// ---------- Preview mode (no camera) ----------
let pv = null;
async function startPreview() {
  show('preview');
  if (pv) { pv.s.reset(); return; }
  const host = $('#pv-stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
  const s = await buildScene(true);
  scene.add(s.root);
  const frameMat = new THREE.MeshBasicMaterial({ color: 0xd8b98a });
  const fw = 0.06, H = s.H;
  [[1 + fw * 2, fw, 0, H / 2 + fw / 2], [1 + fw * 2, fw, 0, -H / 2 - fw / 2], [fw, H, -0.5 - fw / 2, 0], [fw, H, 0.5 + fw / 2, 0]].forEach(([w, h, x, y]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat); b.position.set(x, y, 0.0); scene.add(b);
  });
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const dist = (H * 0.62) / Math.tan((camera.fov * Math.PI) / 360) * Math.max(1, 0.85 / camera.aspect);
    camera.position.set(0.25, -0.12, dist); camera.lookAt(0, -0.02, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host); resize();
  const clock = new THREE.Clock();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    s.update(reduce ? dt * 0.6 : dt);
    renderer.render(scene, camera);
  });
  pv = { s };
}

// ---------- wire up ----------
$('#btn-ar').addEventListener('click', startAR);
$('#btn-preview').addEventListener('click', startPreview);
$('#btn-preview2').addEventListener('click', startPreview);
$('#pv-back').addEventListener('click', () => show('start'));
$('#ar-replay').addEventListener('click', () => arState?.s.reset());
$('#pv-replay').addEventListener('click', () => pv?.s.reset());

loadMeta().then(() => {
  if (params.has('preview') || window.__PREVIEW_ONLY__) startPreview();
}).catch(() => {
  $('#start-msg').textContent = '이 QR에 연결된 그림을 찾지 못했어요. 선생님께 알려 주세요.';
  $('#btn-ar').disabled = true; $('#btn-preview').disabled = true;
});
