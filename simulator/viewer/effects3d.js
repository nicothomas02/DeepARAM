// Ability effects for the 3D replay (three.js): each cast drawn with the art the game uses for it
// (Ahri's E is the heart that flies out and the charm on the target) instead of its hitbox shape.
// Each champion's effects are a small file made by simulator/tools/build_vfx.py from the base
// skin's effect definitions: every effect is a few emitters, each sending out textured particles
// (camera-facing, or flat on the floor) with the game's sizes, colours, timings and flipbooks.
// Particles are worked out from the time since the cast, so scrubbing shows the same frame as
// playing. Champions without a file keep the 2D shapes (replay.js draws them).
import * as THREE from "three";

const BUST = "?v=" + (window.REPLAY_VERSION || "0");
// Files built next to the page (replay-data/vfx/) win; otherwise the website's copies in /assets/vfx/.
let base = "replay-data/vfx/", index = null;
const readIndex = (dir) => fetch(dir + "index.json" + BUST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ready = readIndex(base).then((m) => m || (base = "/assets/vfx/", readIndex(base))).then((m) => { index = (m && m.champions) || {}; });

const MAX = 1500;                  // particles per texture and blend, per frame
const loader = new THREE.TextureLoader();
const champs = new Map();          // champion id (lower case) -> {data, layers} once loaded (null while loading or missing)

function load(id) {
  const key = String(id).toLowerCase();
  if (champs.has(key)) return champs.get(key);
  champs.set(key, null);
  ready.then(() => {
    const file = index[key];
    if (!file) return;
    fetch(base + file + BUST).then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (!data) return;
      const tex = loader.load(base + data.atlas + BUST);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      champs.set(key, { data, tex, layers: {} });
    }).catch(() => {});
  });
  return null;
}

// One batch of quads drawn with one texture and one blend: additive (glows, sparks) or alpha (smoke, decals).
function makeLayer(tex, additive, scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 12), uv = new Float32Array(MAX * 8), col = new Float32Array(MAX * 16);
  const idx = new Uint32Array(MAX * 6);
  for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 3 : 2;
  scene.add(mesh);
  return { mesh, pos, uv, col, n: 0 };
}

// Same numbers every time for one particle (its spread, size and spin don't flicker when scrubbing).
function rand(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// A curve [[t, v...], ...] at t (0 to 1), into out.
function sample(curve, t, out) {
  if (!curve || !curve.length) return null;
  let i = 0;
  while (i < curve.length - 1 && curve[i + 1][0] <= t) i++;
  const a = curve[i], b = curve[Math.min(i + 1, curve.length - 1)];
  const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
  for (let j = 1; j < a.length; j++) out[j - 1] = a[j] + (b[j] - a[j]) * k;
  return out;
}
const lin = (c) => Math.pow(Math.max(0, c), 2.2);  // the game blends in screen colours; three.js in linear

const V = { o: new THREE.Vector3(), p: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(),
  right: new THREE.Vector3(), up: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() };
const C4 = [0, 0, 0, 0], S1 = [0];

const effects = {
  // Whether a champion has effects for an ability (starts loading it the first time it's asked).
  has(id, slot) {
    const c = load(id);
    return !!(c && c.data.slots[slot]);
  },
  // Which parts an ability has: cast (at the caster), missile, hit (on the target), area (where it lands), buff.
  roles(id, slot) {
    const c = champs.get(String(id).toLowerCase());
    return (c && c.data.slots[slot]) || null;
  },
  // How long an ability's part shows after it starts, at most (the longest emitter plus its particles).
  length(id, slot, role) {
    const c = champs.get(String(id).toLowerCase()), list = c && c.data.slots[slot] && c.data.slots[slot][role];
    if (!list) return 0;
    let m = 0;
    for (const s of list) for (const e of c.data.systems[s].emitters) m = Math.max(m, (e.delay || 0) + Math.max(0, e.dur || 0) + e.life);
    return m;
  },

  // Draws this frame's effects. list: [{champ, slot, role, t, at|from+to (device px), dur, dir, h}]
  //   t: seconds since this part started; dur: how long it lasts (a missile's flight, a buff's hold);
  //   dir: the screen direction it's aimed (px); h: height above the floor (game units).
  // api: the arena (toWorld, camera); g: world units per game unit.
  draw(list, scene, camera, toWorld, W, H, g) {
    for (const c of champs.values()) if (c) for (const k in c.layers) c.layers[k].n = 0;
    camera.updateMatrixWorld();
    V.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    V.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const q of list || []) {
      const c = champs.get(String(q.champ).toLowerCase());
      const roles = c && c.data.slots[q.slot];
      if (!roles || !roles[q.role]) continue;
      // Facing on the floor, from the screen direction.
      const at = q.at || q.from;
      toWorld(at.x, at.y, W, H, V.a);
      if (q.dir && (q.dir.x || q.dir.y)) { toWorld(at.x + q.dir.x, at.y + q.dir.y, W, H, V.b); V.f.subVectors(V.b, V.a); }
      else if (q.to) { toWorld(q.to.x, q.to.y, W, H, V.b); V.f.subVectors(V.b, V.a); }
      else V.f.set(1, 0, 0);
      V.f.y = 0;
      if (V.f.lengthSq() < 1e-9) V.f.set(1, 0, 0);
      V.f.normalize();
      V.r.set(-V.f.z, 0, V.f.x);
      const from = V.a.clone(), to = q.to ? toWorld(q.to.x, q.to.y, W, H, new THREE.Vector3()) : null;
      for (const si of roles[q.role]) {
        const sys = c.data.systems[si];
        sys.emitters.forEach((e, ei) => this.emit(c, e, si * 64 + ei, q, from, to, g));
      }
    }
    for (const c of champs.values()) if (c) for (const k in c.layers) {
      const L = c.layers[k], geo = L.mesh.geometry;
      geo.setDrawRange(0, L.n * 6);
      if (L.n) { geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
      L.mesh.visible = L.n > 0;
    }
  },

  emit(c, e, seed, q, from, to, g) {
    const data = c.data, t = q.t - (e.delay || 0);
    if (t < 0) return;
    // Which particles are alive at t: a single one, a burst, or a stream at its rate for the
    // emitter's lifetime (or for as long as the part lasts, for one that runs until stopped).
    const active = e.dur < 0 ? Math.max(0.05, q.dur || 1) : e.dur || 0;
    const life = Math.max(0.02, e.life);
    let first = 0, last = (e.count || 1) - 1, step = 0;
    if (e.rate > 0 && active > 0) {
      step = 1 / e.rate;
      first = Math.max(0, Math.ceil((t - life) / step));
      last = Math.floor(Math.min(t, active - 1e-6) / step);
    }
    if (t - (step ? 0 : 0) > (step ? active : 0) + life) return;
    const key = (e.b ? "a" : "add") + (e.b ? 1 : 0);
    const L = c.layers[key] || (c.layers[key] = makeLayer(c.tex, !e.b, this.scene));
    const [fx, fy, fw, fh] = data.frames[e.f];
    const AW = data.size[0], AH = data.size[1];
    const cols = (e.div && e.div[0]) || 1, rows = (e.div && e.div[1]) || 1, frames = e.n || cols * rows;
    const gu = g; // world units per game unit
    for (let k = first; k <= last && L.n < MAX; k++) {
      const birth = step ? k * step : 0, age = t - birth;
      if (age < 0 || age >= life) continue;
      const u = age / life;
      // Where it was born: on a missile, its point along the flight then; else where the part is.
      if (to && q.role === "missile") {
        const p = q.dur > 0 ? Math.min(1, (birth + (e.delay || 0)) / q.dur) : 1;
        if (!step && q.dur > 0) {
          // A single particle rides the missile head.
          V.o.lerpVectors(from, to, Math.min(1, q.t / q.dur));
          if (q.t > q.dur + 0.05 && e.dur < 0) continue;
        } else V.o.lerpVectors(from, to, p);
      } else V.o.copy(from);
      const r1 = rand(seed, k, 1), r2 = rand(seed, k, 2), r3 = rand(seed, k, 3), r4 = rand(seed, k, 4);
      const off = e.off || [0, 0, 0], vel = e.vel || [0, 0, 0], spr = (e.spr || 0) * Math.sqrt(r1);
      const ang = r2 * Math.PI * 2;
      // Local axes: x to the right, y up, z forward (the direction it's cast).
      const lx = off[0] + vel[0] * age + Math.cos(ang) * spr, ly = off[1] + vel[1] * age, lz = off[2] + vel[2] * age + Math.sin(ang) * spr;
      V.p.copy(V.o).addScaledVector(V.r, lx * gu).addScaledVector(V.f, lz * gu);
      V.p.y = e.g ? 0.02 + (ly > 0 ? 0 : 0) : ((q.h || 0) + ly) * gu;
      const sc = (sample(e.st, u, S1) || [1])[0] * (1 + (e.sv || 0) * (r3 - 0.5));
      const w = e.size[0] * sc * gu, h = e.size[1] * sc * gu;
      const colr = sample(e.col, u, C4) || [1, 1, 1, 1];
      let rot = ((e.rot || 0) + (e.rr ? r4 * 360 : 0) + (e.spin || 0) * age) * Math.PI / 180;
      // Frame of a flipbook: by its frame rate, or spread over the particle's life.
      const fr = frames > 1 ? (e.fps ? Math.floor(age * e.fps) % frames : Math.min(frames - 1, Math.floor(u * frames))) : 0;
      const cw = fw / cols, ch = fh / rows, ux = fx + (fr % cols) * cw, uy = fy + Math.floor(fr / cols) % rows * ch;
      const u0 = ux / AW, u1 = (ux + cw) / AW, v0 = 1 - (uy + ch) / AH, v1 = 1 - uy / AH;
      // Corners: camera-facing, or flat on the floor turned to the cast direction.
      let ax, ay, az, bx, by, bz;
      if (e.g) {
        const ca = Math.cos(rot), sa = Math.sin(rot);
        // Floor axes: forward and right, turned by the particle's rotation.
        ax = (V.r.x * ca + V.f.x * sa) * w / 2; ay = 0; az = (V.r.z * ca + V.f.z * sa) * w / 2;
        bx = (V.f.x * ca - V.r.x * sa) * h / 2; by = 0; bz = (V.f.z * ca - V.r.z * sa) * h / 2;
      } else {
        if (e.dir) {
          // Turned along the cast direction as it shows on screen.
          const sx = V.f.dot(V.right), sy = V.f.dot(V.up);
          rot += Math.atan2(sy, sx);
        }
        const ca = Math.cos(rot), sa = Math.sin(rot);
        ax = (V.right.x * ca + V.up.x * sa) * w / 2; ay = (V.right.y * ca + V.up.y * sa) * w / 2; az = (V.right.z * ca + V.up.z * sa) * w / 2;
        bx = (V.up.x * ca - V.right.x * sa) * h / 2; by = (V.up.y * ca - V.right.y * sa) * h / 2; bz = (V.up.z * ca - V.right.z * sa) * h / 2;
      }
      const i = L.n++, P = L.pos, o = i * 12;
      P[o] = V.p.x - ax - bx; P[o + 1] = V.p.y - ay - by; P[o + 2] = V.p.z - az - bz;
      P[o + 3] = V.p.x + ax - bx; P[o + 4] = V.p.y + ay - by; P[o + 5] = V.p.z + az - bz;
      P[o + 6] = V.p.x + ax + bx; P[o + 7] = V.p.y + ay + by; P[o + 8] = V.p.z + az + bz;
      P[o + 9] = V.p.x - ax + bx; P[o + 10] = V.p.y - ay + by; P[o + 11] = V.p.z - az + bz;
      L.uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const fade = q.alpha === undefined ? 1 : q.alpha;
      const cr = lin(colr[0]), cg = lin(colr[1]), cb = lin(colr[2]), ca4 = Math.max(0, Math.min(1, colr[3] * fade));
      for (let v = 0; v < 4; v++) L.col.set([cr, cg, cb, ca4], i * 16 + v * 4);
    }
  },
};

export default effects;
