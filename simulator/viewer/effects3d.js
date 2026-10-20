// Ability effects for the 3D replay (three.js): each cast drawn with the art the game uses for it
// (Ahri's E is the heart that flies out and the charm on the target) instead of its hitbox shape.
// Each champion's effects are a small file made by simulator/tools/build_vfx.py from the base
// skin's effect definitions: every effect is a few emitters, each sending out textured particles
// (camera-facing sprites, quads, small meshes, streaks) with the game's sizes, colours, timings and
// flipbooks. Particles are worked out from the time since the cast, so scrubbing shows the same frame
// as playing. Champions without a file keep the 2D shapes (replay.js draws them).
import * as THREE from "three";

const BUST = "?v=" + (window.REPLAY_VERSION || "0");
// Files built next to the page (replay-data/vfx/) win; otherwise the website's copies in /assets/vfx/.
let base = "replay-data/vfx/", index = null;
const readIndex = (dir) => fetch(dir + "index.json" + BUST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ready = readIndex(base).then((m) => m || (base = "/assets/vfx/", readIndex(base))).then((m) => { index = (m && m.champions) || {}; });

const MAX_V = 24000, MAX_I = 36000;  // vertices and indices per texture and blend, per frame
const loader = new THREE.TextureLoader();
const champs = new Map();            // champion id (lower case) -> {data, tex, layers} once loaded (null while loading or missing)

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
      champs.set(key, { data, tex, layers: {} });
    }).catch(() => {});
  });
  return null;
}

// One batch of triangles drawn with one texture and one blend: additive (glows, sparks) or alpha (smoke, dirt).
function makeLayer(tex, additive, scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_V * 3), uv = new Float32Array(MAX_V * 2), col = new Float32Array(MAX_V * 4), idx = new Uint32Array(MAX_I);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.CustomBlending : THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false });
  // Additive light leaves the canvas's alpha alone: the arena is a see-through layer over the 2D floor,
  // so a glow's black background must not turn into an opaque square.
  if (additive) Object.assign(mat, { blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 3 : 2;
  scene.add(mesh);
  return { mesh, pos, uv, col, idx, nv: 0, ni: 0 };
}

// Same numbers every time for one particle (its spread, size and spin don't flicker when scrubbing).
function rand(a, b, c) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
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
const DEG = Math.PI / 180;

const V = { o: new THREE.Vector3(), p: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
  cr: new THREE.Vector3(), cu: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(),
  m: new THREE.Matrix4(), basis: new THREE.Matrix4(), e: new THREE.Euler(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), zero: new THREE.Vector3() };
const C4 = [0, 0, 0, 0], S1 = [0];

const effects = {
  scene: null,
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

  // Draws this frame's effects. list: [{champ, slot, role, t, at | from + to (device px), dur, dir, h}]
  //   t: seconds since this part started; dur: how long it lasts (a missile's flight, a buff's hold);
  //   dir: the screen direction it's aimed (px); h: height above the floor (game units).
  // toWorld: px -> floor point; g: world units per game unit.
  draw(list, scene, camera, toWorld, W, H, g) {
    this.scene = scene;
    for (const c of champs.values()) if (c) for (const k in c.layers) { c.layers[k].nv = 0; c.layers[k].ni = 0; }
    camera.updateMatrixWorld();
    V.cr.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    V.cu.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const q of list || []) {
      const c = champs.get(String(q.champ).toLowerCase());
      const roles = c && c.data.slots[q.slot];
      if (!roles || !roles[q.role]) continue;
      // Facing on the floor, from the screen direction.
      const at = q.at || q.from;
      const from = toWorld(at.x, at.y, W, H, new THREE.Vector3());
      const to = q.to ? toWorld(q.to.x, q.to.y, W, H, new THREE.Vector3()) : null;
      if (q.dir && (q.dir.x || q.dir.y)) { toWorld(at.x + q.dir.x, at.y + q.dir.y, W, H, V.b); V.f.subVectors(V.b, from); }
      else if (to) V.f.subVectors(to, from);
      else V.f.set(1, 0, 0);
      V.f.y = 0;
      if (V.f.lengthSq() < 1e-12) V.f.set(1, 0, 0);
      V.f.normalize();
      V.r.crossVectors(V.up, V.f).negate();  // the caster's right, seen from above
      // Local game axes (x right, y up, z forward) to the world.
      V.basis.makeBasis(V.r, V.up, V.f);
      for (const si of roles[q.role]) {
        const sys = c.data.systems[si];
        for (let ei = 0; ei < sys.emitters.length; ei++) this.emit(c, sys.emitters[ei], si * 64 + ei, q, from, to, g);
      }
    }
    for (const c of champs.values()) if (c) for (const k in c.layers) {
      const L = c.layers[k], geo = L.mesh.geometry;
      geo.setDrawRange(0, L.ni);
      if (L.ni) for (const a of ["position", "uv", "color"]) geo.attributes[a].needsUpdate = true;
      if (L.ni) geo.index.needsUpdate = true;
      L.mesh.visible = L.ni > 0;
    }
  },

  emit(c, e, seed, q, from, to, g) {
    const data = c.data, t = q.t - (e.delay || 0);
    if (t < 0) return;
    // Which particles are alive at t: a burst, or a stream at its rate for the emitter's lifetime
    // (or for as long as the part lasts, for one that runs until stopped).
    const active = e.dur < 0 ? Math.max(0.05, q.dur || 1) : e.dur || 0;
    const life = e.life < 0 ? Math.max(0.05, (q.dur || 1) - (e.delay || 0)) : Math.max(0.02, e.life);
    let first = 0, last = (e.count || 1) - 1, step = 0;
    if (e.rate > 0) {
      step = 1 / e.rate;
      first = Math.max(0, Math.ceil((t - life) / step));
      last = Math.floor(Math.min(t, active - 1e-6) / step);
    }
    const key = e.b ? "a" : "add";
    const L = c.layers[key] || (c.layers[key] = makeLayer(c.tex, !e.b, this.scene));
    const [fx, fy, fw, fh] = data.frames[e.f];
    const AW = data.size[0], AH = data.size[1];
    const cols = (e.div && e.div[0]) || 1, rows = (e.div && e.div[1]) || 1, frames = e.n || cols * rows;
    const mesh = e.k === "m" ? data.meshes[e.mesh] : null;
    for (let k = first; k <= last; k++) {
      const birth = step ? k * step : 0, age = t - birth;
      if (age < 0 || age >= life) continue;
      if (L.nv + (mesh ? mesh.p.length / 3 : 4) > MAX_V || L.ni + (mesh ? mesh.i.length : 6) > MAX_I) return;
      const u = age / life;
      // Where it was born: on a missile, its point along the flight then (a burst rides the head).
      if (to && q.role === "missile") {
        const p = q.dur > 0 ? Math.min(1, (step ? birth + (e.delay || 0) : q.t) / q.dur) : 1;
        if (!step && q.t > q.dur + 0.05) continue;  // the missile has landed
        V.o.lerpVectors(from, to, p);
      } else V.o.copy(from);
      const R = (n) => rand(seed, k, n);
      // Local offset (game units): emitter offset, a random box or disc, velocity and acceleration.
      const off = e.off, vel = e.vel, acc = e.acc, box = e.box, vb = e.vb;
      let lx = off ? off[0] : 0, ly = off ? off[1] : 0, lz = off ? off[2] : 0;
      if (box) { lx += (R(1) * 2 - 1) * box[0]; ly += (R(2) * 2 - 1) * box[1]; lz += (R(3) * 2 - 1) * box[2]; }
      if (e.spr) { const d = e.spr * Math.sqrt(R(4)), a = R(5) * Math.PI * 2; lx += Math.cos(a) * d; lz += Math.sin(a) * d; }
      let vx = vel ? vel[0] : 0, vy = vel ? vel[1] : 0, vz = vel ? vel[2] : 0;
      if (vb) { vx += (R(6) * 2 - 1) * vb[0]; vy += (R(7) * 2 - 1) * vb[1]; vz += (R(8) * 2 - 1) * vb[2]; }
      lx += vx * age; ly += vy * age; lz += vz * age;
      if (acc) { const h = 0.5 * age * age; lx += acc[0] * h; ly += acc[1] * h; lz += acc[2] * h; }
      V.v.set(lx, Math.max(0, ly + (q.h || 0)), lz).applyMatrix4(V.basis);
      V.p.copy(V.o).addScaledVector(V.v, g);
      if (e.g) V.p.y = 0.01;
      // Size, colour and frame over the particle's life.
      const grow = (sample(e.st, u, S1) || [1])[0];
      const sx = e.sv ? e.sv[0] + (e.sv[1] - e.sv[0]) * R(9) : 1, sy = e.svy ? e.svy[0] + (e.svy[1] - e.svy[0]) * R(10) : e.svy === undefined && e.sv ? sx : 1;
      const colr = sample(e.col, u, C4) || [1, 1, 1, 1];
      const fade = q.alpha === undefined ? 1 : q.alpha;
      const cr = lin(colr[0]), cg = lin(colr[1]), cb = lin(colr[2]), ca = Math.max(0, Math.min(1, colr[3] * fade));
      if (ca <= 0.002) continue;
      const start = e.rf ? Math.floor(R(11) * frames) : 0;
      const fr = frames > 1 ? (start + (e.fps ? Math.floor(age * e.fps) : Math.floor(u * frames))) % frames : 0;
      const cw = fw / cols, ch = fh / rows, ux = fx + (fr % cols) * cw, uy = fy + (Math.floor(fr / cols) % rows) * ch;
      const u0 = ux / AW, u1 = (ux + cw) / AW, v0 = 1 - (uy + ch) / AH, v1 = 1 - uy / AH;
      const nv = L.nv;
      if (mesh) {
        // A small mesh, scaled, turned and placed like the game's (x right, y up, z forward).
        const rot = e.rot || [0, 0, 0], rr = e.rr, spin = e.spin;
        V.e.set((rot[0] + (rr ? rr[0] * R(12) : 0) + (spin ? spin[0] * age : 0)) * DEG,
          (rot[1] + (rr ? rr[1] * R(13) : 0) + (spin ? spin[1] * age : 0)) * DEG,
          (rot[2] + (rr ? rr[2] * R(14) : 0) + (spin ? spin[2] * age : 0)) * DEG, "YXZ");
        V.q.setFromEuler(V.e);
        V.s.set(e.size[0] * grow * sx, e.size[1] * grow * sx, e.size[2] * grow * sx).multiplyScalar(g);
        V.m.compose(V.zero, V.q, V.s).premultiply(V.basis).setPosition(V.p);
        const P = mesh.p, UV = mesh.uv;
        for (let i = 0; i < P.length / 3; i++) {
          V.v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(V.m);
          L.pos[(nv + i) * 3] = V.v.x; L.pos[(nv + i) * 3 + 1] = V.v.y; L.pos[(nv + i) * 3 + 2] = V.v.z;
          L.uv[(nv + i) * 2] = u0 + UV[i * 2] * (u1 - u0); L.uv[(nv + i) * 2 + 1] = v1 - UV[i * 2 + 1] * (v1 - v0);
          L.col[(nv + i) * 4] = cr; L.col[(nv + i) * 4 + 1] = cg; L.col[(nv + i) * 4 + 2] = cb; L.col[(nv + i) * 4 + 3] = ca;
        }
        for (const i of mesh.i) L.idx[L.ni++] = nv + i;
        L.nv += P.length / 3;
        continue;
      }
      const w = e.size[0] * grow * sx * g / 2, h = e.size[1] * grow * sy * g / 2;
      let ax, ay, az, bx, by, bz;
      if (e.k === "q" || e.g) {
        // A quad: in the local x-y plane turned by its rotation (most lie flat on the floor).
        const rot = Array.isArray(e.rot) ? e.rot : [90, 0, e.rot || 0], rr = Array.isArray(e.rr) ? e.rr : null, spin = Array.isArray(e.spin) ? e.spin : null;
        V.e.set((rot[0] + (rr ? rr[0] * R(12) : 0) + (spin ? spin[0] * age : 0)) * DEG,
          (rot[1] + (rr ? rr[1] * R(13) : 0) + (spin ? spin[1] * age : 0)) * DEG,
          (rot[2] + (rr ? rr[2] * R(14) : 0) + (spin ? spin[2] * age : 0)) * DEG, "YXZ");
        V.q.setFromEuler(V.e);
        V.a.set(w, 0, 0).applyQuaternion(V.q).applyMatrix4(V.basis);
        V.b.set(0, h, 0).applyQuaternion(V.q).applyMatrix4(V.basis);
        if (e.g && !Array.isArray(e.rot)) { V.a.set(w, 0, 0).applyMatrix4(V.basis); V.b.set(0, 0, h).applyMatrix4(V.basis); }
        ax = V.a.x; ay = V.a.y; az = V.a.z; bx = V.b.x; by = V.b.y; bz = V.b.z;
      } else {
        // Camera-facing: rolled by its rotation; a streak or ray lies along its direction on screen.
        let roll = ((typeof e.rot === "number" ? e.rot : 0) + (typeof e.rr === "number" ? e.rr * R(12) : 0) + (typeof e.spin === "number" ? e.spin * age : 0)) * DEG;
        if (e.dir) {
          const dx = vx || vz ? V.v.set(vx, vy, vz).applyMatrix4(V.basis) : V.v.copy(V.f);
          roll += Math.atan2(dx.dot(V.cu), dx.dot(V.cr)) - Math.PI / 2;
        }
        const c = Math.cos(roll), s = Math.sin(roll);
        ax = (V.cr.x * c + V.cu.x * s) * w; ay = (V.cr.y * c + V.cu.y * s) * w; az = (V.cr.z * c + V.cu.z * s) * w;
        bx = (V.cu.x * c - V.cr.x * s) * h; by = (V.cu.y * c - V.cr.y * s) * h; bz = (V.cu.z * c - V.cr.z * s) * h;
      }
      const P = L.pos, o = nv * 3;
      P[o] = V.p.x - ax - bx; P[o + 1] = V.p.y - ay - by; P[o + 2] = V.p.z - az - bz;
      P[o + 3] = V.p.x + ax - bx; P[o + 4] = V.p.y + ay - by; P[o + 5] = V.p.z + az - bz;
      P[o + 6] = V.p.x + ax + bx; P[o + 7] = V.p.y + ay + by; P[o + 8] = V.p.z + az + bz;
      P[o + 9] = V.p.x - ax + bx; P[o + 10] = V.p.y - ay + by; P[o + 11] = V.p.z - az + bz;
      const U = L.uv, ou = nv * 2;
      U[ou] = u0; U[ou + 1] = v0; U[ou + 2] = u1; U[ou + 3] = v0; U[ou + 4] = u1; U[ou + 5] = v1; U[ou + 6] = u0; U[ou + 7] = v1;
      for (let v = 0; v < 4; v++) { const oc = (nv + v) * 4; L.col[oc] = cr; L.col[oc + 1] = cg; L.col[oc + 2] = cb; L.col[oc + 3] = ca; }
      L.idx[L.ni++] = nv; L.idx[L.ni++] = nv + 1; L.idx[L.ni++] = nv + 2; L.idx[L.ni++] = nv; L.idx[L.ni++] = nv + 2; L.idx[L.ni++] = nv + 3;
      L.nv += 4;
    }
  },
};

export default effects;
