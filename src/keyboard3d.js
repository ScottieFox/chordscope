/* ───────────────────────── CHORD//SCOPE · 3D keyboard (three.js) ─────────────────────────
   A lit, slightly tilted piano keyboard. Keys pivot at the back and dip when held,
   take cyan / gold / mint colours for held / target / matched notes, and expose
   keyAt(x, y) so the app can play them with the mouse. Renders only when something
   changes. Note names are crisp HTML labels positioned over the 3D keys.          */
import {
  WebGLRenderer, Scene, OrthographicCamera, InstancedMesh, BoxGeometry, MeshStandardMaterial,
  HemisphereLight, DirectionalLight, Color, Object3D, Vector2, Vector3, Raycaster, PCFShadowMap,
  Mesh, SRGBColorSpace, Box3, PMREMGenerator,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const WHITE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isWhite = (m) => WHITE[((m % 12) + 12) % 12] === 1;
// one white-key pitch = 1 unit
const WW = 0.93, WL = 6.0, WH = 0.6; // white key width / length / height
const BWD = 0.56, BL = 3.9, BH = 0.72, BY = 0.3; // black key width / length / height / base
const BOFF = { 1: -0.11, 3: 0.11, 6: -0.13, 8: 0, 10: 0.13 };
const PRESS = 0.07; // key dip (radians)
const PITCH = (50 * Math.PI) / 180; // camera elevation

const COLORS = {
  white: '#e7e9eb', black: '#191c1f',
  held: ['#5fe3ff', '#2fc3e4'], sus: ['#a6d9e6', '#2b8597'], tgt: ['#e5b95a', '#c99a3c'], match: ['#8dffc4', '#4fd690'],
};

function create(container, opts) {
  opts = opts || {};
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // shadows only change when keys move
  const canvas = renderer.domElement;
  canvas.className = 'kb3d';
  container.appendChild(canvas);
  const labelLayer = document.createElement('div');
  labelLayer.className = 'kb3d-labels';
  container.appendChild(labelLayer);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  // one key light behind the keyboard casts the shadows; a studio environment gives the black keys their gloss
  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.add(new HemisphereLight(0xffffff, 0x1b2024, 1.3));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 512);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.01;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0xbfe9ff, 0.45);
  scene.add(fill);

  const whiteGeo = new RoundedBoxGeometry(WW, WH, WL, 2, 0.035);
  whiteGeo.translate(0, WH / 2, WL / 2); // pivot at the back-bottom edge
  const blackGeo = new RoundedBoxGeometry(BWD, BH, BL, 2, 0.05);
  blackGeo.translate(0, BH / 2, BL / 2);
  const whiteMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  const blackMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, envMap: envTex, envMapIntensity: 0.25 }); // glossy
  const bedMat = new MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.9 });
  const feltMat = new MeshStandardMaterial({ color: 0x4a1418, roughness: 1 });

  let whiteMesh = null, blackMesh = null, bed = null, felt = null;
  let keys = [], byMidi = new Map(), range = [21, 108], width = 52;
  const dummy = new Object3D();
  const tmpColor = new Color();
  const colorCache = {};
  const col = (hex) => colorCache[hex] || (colorCache[hex] = new Color(hex));
  const NONE = new Set();
  let painted = { held: NONE, sus: NONE, tgt: NONE, labels: new Map(), showLabels: true, auto: NONE };
  let raf = 0, lastT = 0, cssW = 0, cssH = 0;

  function build(r) {
    range = r;
    for (const m of [whiteMesh, blackMesh, bed, felt]) if (m) { scene.remove(m); }
    keys = []; byMidi = new Map();
    const [lo, hi] = r;
    let wx = 0;
    const xOfWhite = {};
    for (let m = lo; m <= hi; m++) if (isWhite(m)) xOfWhite[m] = wx++;
    width = wx;
    const x0 = -width / 2 + 0.5;
    const whites = [], blacks = [];
    for (let m = lo; m <= hi; m++) {
      if (isWhite(m)) whites.push({ m, white: true, x: x0 + xOfWhite[m] });
      else if (xOfWhite[m + 1] !== undefined) blacks.push({ m, white: false, x: x0 + xOfWhite[m + 1] - 0.5 + BOFF[((m % 12) + 12) % 12] });
    }
    whiteMesh = new InstancedMesh(whiteGeo, whiteMat, whites.length);
    blackMesh = new InstancedMesh(blackGeo, blackMat, blacks.length);
    whiteMesh.castShadow = false; whiteMesh.receiveShadow = true;
    blackMesh.castShadow = true; blackMesh.receiveShadow = true;
    whites.forEach((k, i) => { k.mesh = whiteMesh; k.i = i; });
    blacks.forEach((k, i) => { k.mesh = blackMesh; k.i = i; });
    keys = whites.concat(blacks);
    for (const k of keys) { k.press = 0; k.goal = 0; byMidi.set(k.m, k); place(k); k.mesh.setColorAt(k.i, col(k.white ? COLORS.white : COLORS.black)); }
    whiteMesh.instanceMatrix.needsUpdate = blackMesh.instanceMatrix.needsUpdate = true;
    whiteMesh.instanceColor.needsUpdate = blackMesh.instanceColor.needsUpdate = true;
    // dark key bed and the red felt strip behind the keys
    bed = new Mesh(new BoxGeometry(width + 1.2, 0.2, WL + 1.6), bedMat);
    bed.position.set(0, -0.12, 0.2);
    bed.receiveShadow = true;
    felt = new Mesh(new BoxGeometry(width + 0.2, 0.5, 0.35), feltMat);
    felt.position.set(0, 0.25, -WL / 2 - 0.2);
    scene.add(bed, felt, whiteMesh, blackMesh);
    // shadow camera hugs the keyboard: the light sits straight behind and above it, so the
    // light-space axes line up with the keys (an x offset would skew them out of the frustum)
    sun.position.set(-0.08 * width, 10, -12); // behind, above and a little to the left
    sun.target.position.set(0, 0, 0.8);
    // fit the shadow frustum to the keyboard as the light sees it, with the shadow map's long
    // side along the keys (its "up" is kept perpendicular to the keyboard's x axis)
    const sc = sun.shadow.camera;
    const f = sun.target.position.clone().sub(sun.position).normalize();
    sc.up.set(1, 0, 0).cross(f).normalize();
    sc.position.copy(sun.position);
    sc.lookAt(sun.target.position);
    sc.updateMatrixWorld();
    const bmin = new Vector3(Infinity, Infinity, Infinity), bmax = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? width / 2 + 0.7 : -width / 2 - 0.7, i & 2 ? 1.2 : -0.25, i & 4 ? WL / 2 + 0.9 : -WL / 2 - 0.6).applyMatrix4(sc.matrixWorldInverse);
      bmin.min(p); bmax.max(p);
    }
    sc.left = bmin.x; sc.right = bmax.x; sc.bottom = bmin.y; sc.top = bmax.y; sc.near = Math.max(0.1, -bmax.z - 1); sc.far = -bmin.z + 1;
    sc.updateProjectionMatrix();
    fill.position.set(-width * 0.35, 7, 12);
    renderer.shadowMap.needsUpdate = true;
    fit();
    paint(painted.held, painted.sus, painted.tgt, painted.labels, painted.showLabels, painted.auto);
  }
  function place(k) {
    dummy.position.set(k.x, k.white ? 0 : BY, -WL / 2);
    dummy.rotation.set(k.press, 0, 0);
    dummy.updateMatrix();
    k.mesh.setMatrixAt(k.i, dummy.matrix);
  }

  // camera: tilted orthographic view fitted to the keyboard and the canvas aspect
  function fit() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 2) return; // hidden (keyboard collapsed)
    cssW = Math.round(rect.width);
    const dist = 40;
    camera.position.set(0, Math.sin(PITCH) * dist, Math.cos(PITCH) * dist + 0.4);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0.3, 0.4);
    camera.updateMatrixWorld();
    // project the keyboard's bounds into view space
    const box = new Box3(new Vector3(-width / 2 - 0.15, -0.05, -WL / 2 - 0.45), new Vector3(width / 2 + 0.15, BY + BH + 0.05, WL / 2 + 0.05));
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const cw = maxX - minX, ch = maxY - minY;
    const maxH = opts.maxHeight ? opts.maxHeight() : 180;
    cssH = Math.round(Math.max(64, Math.min(maxH, (cssW * ch) / cw)));
    const aspect = cssW / cssH;
    let hw = cw / 2, hh = ch / 2;
    if (cw / ch > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    camera.left = cx - hw; camera.right = cx + hw; camera.top = cy + hh; camera.bottom = cy - hh;
    camera.updateProjectionMatrix();
    renderer.setSize(cssW, cssH, false);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    container.style.height = cssH + 'px';
    request();
  }

  // held: you (cyan, pressed) · auto: the player piano (gold, pressed) · tgt: SHOW target (gold)
  // · both you and a target/player note: mint · sus: sustained by the pedal
  function paint(held, sus, tgt, labels, showLabels, auto) {
    auto = auto || NONE;
    painted = { held, sus, tgt, labels, showLabels: showLabels !== false, auto };
    if (!whiteMesh) return;
    for (const k of keys) {
      const h = held.has(k.m), a = auto.has(k.m), s = !h && !a && sus.has(k.m), t = tgt.has(k.m) || a;
      const pal = (h || s) && t ? COLORS.match : h ? COLORS.held : s ? COLORS.sus : t ? COLORS.tgt : null;
      k.mesh.setColorAt(k.i, col(pal ? pal[k.white ? 0 : 1] : k.white ? COLORS.white : COLORS.black));
      k.goal = h || a ? PRESS : 0;
    }
    whiteMesh.instanceColor.needsUpdate = blackMesh.instanceColor.needsUpdate = true;
    request();
  }

  // ── labels (HTML, positioned over the 3D keys) ──
  const v = new Vector3();
  function project(x, y, z) {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * cssW, ((1 - v.y) / 2) * cssH];
  }
  function drawLabels() {
    let html = '';
    if (!keys.length) { labelLayer.innerHTML = ''; return; }
    for (const k of keys) {
      if (!k.white || k.m % 12 !== 0) continue;
      const [x, y] = project(k.x, WH, WL / 2 - 0.42);
      html += `<span class="kl-c${k.m === 60 ? ' mid' : ''}${painted.held.has(k.m) || painted.sus.has(k.m) || painted.tgt.has(k.m) || painted.auto.has(k.m) ? ' lit' : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">C${k.m / 12 - 1}</span>`;
    }
    if (painted.showLabels) {
      for (const [m, name] of painted.labels) {
        const k = byMidi.get(m);
        if (!k) continue;
        const [x, y] = k.white ? project(k.x, WH, WL / 2 - 1.35) : project(k.x, BY + BH, -WL / 2 + BL - 0.75);
        html += `<span class="kl-n${k.white ? '' : ' blk'}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${esc(name)}</span>`;
      }
    }
    if (labelLayer.__h !== html) { labelLayer.innerHTML = html; labelLayer.__h = html; }
  }

  // ── render on demand (and while keys are moving) ──
  function request() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    let moving = false;
    for (const k of keys) {
      if (k.press === k.goal) continue;
      const step = (k.goal - k.press) * Math.min(1, dt * (k.goal > k.press ? 38 : 22));
      k.press = Math.abs(k.goal - k.press - step) < 0.0005 ? k.goal : k.press + step;
      place(k);
      k.mesh.instanceMatrix.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
      if (k.press !== k.goal) moving = true;
    }
    renderer.render(scene, camera);
    drawLabels();
    if (moving) request(); else lastT = 0;
  }

  // ── picking ──
  const ray = new Raycaster();
  const ndc = new Vector2();
  function keyAt(clientX, clientY) {
    if (!whiteMesh) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([blackMesh, whiteMesh], false)[0];
    if (!hit || hit.instanceId == null) return null;
    const k = keys.find((q) => q.mesh === hit.object && q.i === hit.instanceId);
    if (!k) return null;
    const len = k.white ? WL : BL;
    const along = (hit.point.z + WL / 2) / len; // 0 = back, 1 = front edge
    return { m: k.m, vel: Math.max(0.2, Math.min(1, 0.32 + 0.66 * along)) };
  }
  function keyCenter(m) { // client coordinates of a key's playing area (tests, tooling)
    const k = byMidi.get(m);
    if (!k) return null;
    const [x, y] = k.white ? project(k.x, WH, WL / 2 - 0.9) : project(k.x, BY + BH, -WL / 2 + BL - 0.5);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }
  function state() { // what each key shows (tests, tooling)
    const out = [];
    for (const k of keys) {
      k.mesh.getColorAt(k.i, tmpColor);
      const h = painted.held.has(k.m);
      out.push({ m: k.m, held: h, sus: !h && painted.sus.has(k.m), tgt: painted.tgt.has(k.m), auto: painted.auto.has(k.m), color: '#' + tmpColor.getHexString(), press: k.press });
    }
    return out;
  }
  // every key's left/right edge in client pixels (the camera never yaws, so x is the same front to back)
  function keyLayout() {
    if (!keys.length || !cssW) return null;
    const r = canvas.getBoundingClientRect();
    return keys.map((k) => {
      const w = k.white ? WW : BWD;
      return { m: k.m, white: k.white, x0: r.left + project(k.x - w / 2, WH, 0)[0], x1: r.left + project(k.x + w / 2, WH, 0)[0] };
    }).sort((a, b) => a.m - b.m);
  }

  // refit after layout changes, outside the ResizeObserver callback (no observer loops)
  let fitQueued = false;
  const queueFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); } };
  new ResizeObserver(queueFit).observe(container.parentElement || container);
  window.addEventListener('resize', queueFit);
  return { el: canvas, build, paint, keyAt, keyCenter, keyLayout, state, fit, is3D: true };
}

window.CSKeyboard3D = {
  create,
  // Is there WebGL, and is it a real GPU? (Software rasterisers such as SwiftShader or llvmpipe
  // can draw this, but slowly enough to lag the whole page, so the app uses its flat keyboard.)
  probe() {
    const out = { webgl: false, software: false, renderer: '' };
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return out;
      out.webgl = true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      out.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(out.renderer);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) { /* no WebGL */ }
    return out;
  },
};
