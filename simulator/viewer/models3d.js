// 3D champion models for the fight replay (three.js). Each fighter in the arena is an
// animated model posed from the simulated timeline (cast, attack, stunned, death, idle), with
// each ability's clips in order and idle variations (replay-data/anims.json). Models come from
// replay-data/models/ when built there, else the website's /assets/models/. If WebGL or a model is missing,
// replay.js keeps drawing the 2D portraits.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const DATA = "replay-data/models/";
const BUST = "?v=" + (window.REPLAY_VERSION || "0");
// Models are in hundredths of game units; the game draws each champion at its skin's scale
// (models.json "scale"). The page passes how many px a game unit takes on screen (f.unit);
// without it, a champion 200 game units tall (about average) stands this many world units.
const GAME_UNITS = 100;
const HEIGHT = 2.6;
const FALLBACK = { Q: ["attack"], W: ["attack"], E: ["attack"], R: ["attack"], crit: ["attack"],
  stunned: ["idle"], death: ["idle"], attack: ["idle"], run: ["idle"], dance: ["idle"],
  respawn: ["idle"], laugh: ["taunt", "joke", "idle"], taunt: ["laugh", "joke", "idle"], joke: ["laugh", "taunt", "idle"],
  knockup: ["stunned", "idle"], haste: ["run", "idle"] };

// Models built next to the page (replay-data/models/) win; otherwise the website's copies in /assets/models/.
const SITE = "/assets/models/";
let manifest = null, modelBase = DATA;
const readManifest = (dir) => fetch(dir + "models.json" + BUST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// On the website (/embed/...) nothing is built next to the page, so go straight to /assets/models/.
const ON_SITE = location.pathname.startsWith("/embed/");
const manifestReady = (ON_SITE ? Promise.resolve(null) : readManifest(DATA)).then((m) => m || (modelBase = SITE, readManifest(SITE))).then((m) => {
  manifest = {};
  for (const [k, v] of Object.entries(m || {})) manifest[k.toLowerCase()] = v;
});
// How each champion animates:
// idle variations, death, and each ability's clips in order, one list per successive cast.
let anims = {};
const animsReady = fetch("replay-data/anims.json" + BUST).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  .then((a) => { for (const [k, v] of Object.entries(a)) anims[k.toLowerCase()] = v; });
const FADE = 0.15;               // seconds to blend from one clip into the next
const LOOPS = /loop|channel|_idle$|hold/i;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// Ability effects (effects3d.js), loaded with this page's version so a new release isn't cached.
let effects = null;
import("./effects3d.js" + BUST).then((m) => { effects = m.default; api.effects = effects; }).catch(() => {});

const gltfs = new Map();         // champion id (lower case) -> Promise<gltf | null>

function loadChampion(id) {
  const key = String(id).toLowerCase();
  if (!gltfs.has(key)) {
    gltfs.set(key, Promise.all([manifestReady, animsReady]).then(() => {
      const entry = manifest[key];
      if (!entry) return null;
      // A ".txt" file is the same .glb in base64, for hosts that only serve text.
      const load = entry.file.endsWith(".txt")
        ? fetch(modelBase + entry.file + BUST).then((r) => r.text()).then((b64) => {
          const bin = atob(b64.trim()), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return loader.parseAsync(bytes.buffer, modelBase);
        })
        : loader.loadAsync(modelBase + entry.file + BUST);
      return load.then((g) => ({ gltf: g, entry, anim: anims[key] })).catch(() => null);
    }));
  }
  return gltfs.get(key);
}

// One posed copy of a champion model.
class Actor {
  constructor({ gltf, entry, anim }) {
    this.group = new THREE.Group();
    this.root = cloneSkinned(gltf.scene);
    this.group.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    const make = (name) => {
      const clip = name && gltf.animations.find((a) => a.name === name);
      return clip ? { action: this.mixer.clipAction(clip), duration: clip.duration, name } : null;
    };
    this.clips = {};
    for (const [role, name] of Object.entries(entry.clips)) { const c = make(name); if (c) this.clips[role] = c; }
    // Where the game's graph doesn't cover a move: other versions of it picked by name
    // (viewer/clips.js), played in turn, and the clip that eases an ability back to idle.
    this.variants = {};
    for (const [role, names] of Object.entries(entry.extra || {}))
      if (this.clips[role]) this.variants[role] = [this.clips[role], ...names.map(make).filter(Boolean)];
    this.after = {};
    for (const [slot, name] of Object.entries(entry.after || {})) { const c = make(name); if (c) this.after[slot] = c; }
    // The game's own clip lists, where the model has those clips. A clip is named either after
    // the graph ("Spell1A") or the .anm file ("riven_spell1a", "Zed_spell1.anm").
    const byName = new Map();
    for (const a of gltf.animations) byName.set(a.name.toLowerCase().replace(/\.anm$/, ""), a);
    const one = (alts) => {
      for (const n of alts.split("|")) {
        const a = byName.get(n.toLowerCase());
        if (a) return { action: this.mixer.clipAction(a), duration: a.duration, name: a.name };
      }
      return null;
    };
    const seq = (list) => { const out = (list || []).map(one).filter(Boolean); return out.length ? out : null; };
    this.seq = {};
    if (anim) {
      const idles = (anim.idle || []).map(seq).filter(Boolean).map((x) => x[x.length - 1]);
      if (idles.length) this.seq.idle = idles;
      if (seq(anim.death)) this.seq.death = [seq(anim.death)];
      for (const k of ["Q", "W", "E", "R"]) {
        const casts = ((anim[k] || {}).casts || []).map(seq).filter(Boolean);
        if (casts.length) this.seq[k] = casts;
      }
    }
    this.current = null;
    this.prev = null;
    this.phase = { role: null, t: 0, v: 0 };
    this.alpha = 1;
    // Parts the game hides (Teemo's mushroom, Ornn's poro) start hidden; some clips show or
    // hide parts partway through (submeshVisibilityEvents on the skeleton, frames at 30 fps).
    this.meshes = [];
    this.events = {};
    this.rootBone = null;
    this.root.traverse((o) => {
      if (o.isBone && !this.rootBone) this.rootBone = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        const ud = o.material.userData || {};
        this.meshes.push({ mesh: o, hash: ud.hash, shown: ud.visible !== false });
      }
      if (o.userData && o.userData.submeshVisibilityEvents) this.events = o.userData.submeshVisibilityEvents;
    });
    // In game units at the champion's in-game size, feet on the ground, measured on the
    // visible parts in the idle pose.
    this.pose("idle", 0, true);
    // Some clips carry root motion (Teemo's Q runs forward, Garen's Q starts in the air);
    // the arena places each fighter itself, so the root bone stays where idle has it.
    this.rootRest = this.rootBone ? this.rootBone.position.clone() : null;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of this.meshes) if (m.shown) box.union(new THREE.Box3().setFromObject(m.mesh, true));
    if (box.isEmpty()) box.setFromObject(this.root, true);
    const h = Math.max(1e-6, box.max.y - box.min.y);
    const s = GAME_UNITS * (entry.scale || 1);
    this.root.scale.multiplyScalar(s);
    this.root.position.y = -box.min.y * s;
    this.root.position.x = -((box.max.x + box.min.x) / 2) * s;
    this.root.position.z = -((box.max.z + box.min.z) / 2) * s;
    this.height = h * s;
  }
  clip(role) {
    if (this.clips[role]) return this.clips[role];
    for (const r of FALLBACK[role] || []) if (this.clips[r]) return this.clips[r];
    return this.clips.idle || Object.values(this.clips)[0] || null;
  }
  // Which clip plays for a role at time t, and where in it: an ability's clips in order (the
  // last one looping if it is a channel), idle variations now and then, else the single clip.
  // base: the plain idle loop only (no variations).
  choose(role, t, loop, n, base) {
    const casts = this.seq[role];
    if (casts && role !== "idle") {
      const list = casts[(n || 0) % casts.length];
      let at = Math.max(0, t);
      for (let i = 0; i < list.length; i++) {
        const c = list[i], d = Math.max(1e-3, c.duration);
        if (i === list.length - 1) {
          const loops = LOOPS.test(c.name) || loop;
          return { c, time: loops ? at % d : Math.min(at, d - 1e-3) };
        }
        if (at < d) return { c, time: at };
        at -= d;
      }
    }
    if (role === "idle" && this.seq.idle) {
      // The main idle three times, then the next variation once, round and round; worked out
      // from t so scrubbing shows the same pose.
      const [main, ...more] = this.seq.idle, vars = base ? [] : more;
      const bd = Math.max(1e-3, main.duration);
      if (!vars.length) return { c: main, time: ((t % bd) + bd) % bd };
      const period = vars.map((v) => 3 * bd + v.duration);
      const total = period.reduce((a, b) => a + b, 0);
      let at = ((t % total) + total) % total;
      for (let i = 0; i < vars.length; i++) {
        if (at < 3 * bd) return { c: main, time: at % bd };
        at -= 3 * bd;
        if (at < vars[i].duration) return { c: vars[i], time: at };
        at -= vars[i].duration;
      }
      return { c: main, time: 0 };
    }
    const main = this.clip(role);
    if (!main) return null;
    const vars = this.variants[role] || [main];
    if (loop) {
      // Idle: the main loop three times, then a variation; other loops take turns between versions.
      const seq = role === "idle" && (base || vars.length < 2) ? [main] : role === "idle" ? vars.slice(1).flatMap((v) => [main, main, main, v]) : vars;
      const total = seq.reduce((sum, c) => sum + Math.max(1e-3, c.duration), 0);
      let at = ((t % total) + total) % total;
      for (const c of seq) { const d = Math.max(1e-3, c.duration); if (at < d) return { c, time: at }; at -= d; }
      return { c: main, time: 0 };
    }
    const c = vars[(n || 0) % vars.length];
    const after = this.after[role];
    if (after && t >= c.duration) return { c: after, time: Math.min(t - c.duration, after.duration - 1e-3) };
    return { c, time: Math.min(Math.max(0, t), c.duration - 1e-3) };
  }
  // Total length of an ability's clips for its n-th cast (0 if the model has none).
  castLength(role, n) {
    const casts = this.seq[role];
    if (!casts) {
      const vars = this.variants[role], c = vars ? vars[(n || 0) % vars.length] : this.clip(role);
      return (c ? c.duration : 0) + (this.after[role] ? this.after[role].duration : 0);
    }
    return casts[(n || 0) % casts.length].reduce((a, c) => a + c.duration, 0);
  }
  // Shows the role's clip at time t, blending briefly from the previous clip.
  // rate (loops only): the loop starts from its first frame when the role begins and then runs
  // at rate times the timeline (a run sped up to the walking pace); pausing holds it.
  pose(role, t, loop, n, rate, base) {
    if (loop && rate) {
      const ph = this.phase;
      if (ph.role !== role || t < ph.t || t - ph.t > 0.5) ph.v = 0;
      else ph.v += (t - ph.t) * rate;
      ph.role = role; ph.t = t; t = ph.v;
    } else this.phase.role = null;
    const pick = this.choose(role, t, loop, n, base);
    if (!pick) return 0;
    const { c, time } = pick;
    const now = performance.now() / 1000;
    if (this.current !== c) {
      if (this.prev && this.prev.c !== c) this.prev.c.action.stop();
      if (this.current) this.prev = { c: this.current, time: this.current.action.time, at: now };
      c.action.reset().play();
      this.current = c;
    }
    let w = 1;
    if (this.prev) {
      w = Math.min(1, (now - this.prev.at) / FADE);
      if (w >= 1 || this.prev.c === c) { if (this.prev.c !== c) this.prev.c.action.stop(); this.prev = null; w = 1; }
      else { this.prev.c.action.enabled = true; this.prev.c.action.setEffectiveWeight(1 - w); this.prev.c.action.time = this.prev.time; }
    }
    c.action.setEffectiveWeight(w);
    c.action.time = time;
    this.mixer.update(0);
    if (this.rootRest) this.rootBone.position.copy(this.rootRest);
    this.showParts(c.name, c.action.time * 30);
    return c.duration;
  }
  showParts(clipName, frame) {
    const list = this.events[clipName];
    if (!list) { for (const m of this.meshes) m.mesh.visible = m.shown; return; }
    const vis = this.vis || (this.vis = new Map());
    vis.clear();
    for (const m of this.meshes) vis.set(m.hash, m.shown);
    for (const e of list) {
      const on = e.endFrame != null ? frame >= (e.startFrame || 0) && frame <= e.endFrame : frame >= (e.startFrame || 0);
      if (!on) continue;
      for (const h of e.hideSubmeshList || []) vis.set(h, false);
      for (const h of e.showSubmeshList || []) vis.set(h, true);
    }
    for (const m of this.meshes) m.mesh.visible = vis.get(m.hash) !== false;
  }
  duration(role) { const c = this.clip(role); return c ? c.duration : 0; }
  // Fades the model out (a fallen champion). Materials are shared between copies of a champion,
  // so the first fade gives this copy its own.
  setAlpha(a) {
    if (a === this.alpha) return;
    if (!this.ownMaterials) {
      this.ownMaterials = true;
      for (const m of this.meshes) { m.mesh.material = m.mesh.material.clone(); m.mesh.material.transparent = true; }
    }
    this.alpha = a;
    for (const m of this.meshes) { m.mesh.material.opacity = a; m.mesh.material.depthWrite = a > 0.99; }
  }
}

function makeRenderer(canvas, antialias) {
  const r = new THREE.WebGLRenderer({ canvas, antialias, alpha: true });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

// Scratch objects reused every frame instead of made anew.
const TMP = { ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  head: new THREE.Vector3(), seen: new Set() };

const api = {
  ok: false,
  arena: null,
  actors: new Map(),             // key -> {actor, champ}
  pendingKeys: new Set(),
  preview: null,

  // low: no antialiasing (a WebGL canvas keeps the choice it was made with).
  attach(arenaCanvas, low) {
    try {
      this.arena = { renderer: makeRenderer(arenaCanvas, !low), scene: new THREE.Scene(),
        camera: new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100) };
      this.arena.camera.position.set(0, 11, 11);
      this.arena.camera.lookAt(0, 0, 0);
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
    return this.ok;
  },

  // Starts loading a fight's models. Resolves to whether your champion has a model.
  setFight(champId, enemyIds) {
    for (const [, a] of this.actors) this.arena.scene.remove(a.actor.group);
    this.actors.clear();
    this.pendingKeys.clear();
    this.preview = null;
    for (const id of new Set(enemyIds)) loadChampion(id);
    return loadChampion(champId).then((g) => !!g);
  },
  hasModel(champId) { return !!(manifest && manifest[String(champId).toLowerCase()]); },

  // Click on an ability: your champion plays it once in the arena.
  // Clicking the same ability again plays its next cast (Riven's Q: A, B, C).
  previewRole(role) {
    const last = this.lastPreview;
    const n = last && last.role === role ? last.n + 1 : 0;
    this.preview = this.lastPreview = { role, start: performance.now(), n };
  },
  // Length of a fighter's n-th cast of an ability, once its model is loaded (0 before).
  castLength(key, role, n) {
    const e = this.actors.get(key);
    return e ? e.actor.castLength(role, n) : 0;
  },

  // Converts canvas pixels (device px) to a point on the arena floor (into out, when given).
  toWorld(px, py, W, H, out) {
    TMP.ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    TMP.ray.setFromCamera(TMP.ndc, this.arena.camera);
    const p = out || new THREE.Vector3();
    TMP.ray.ray.intersectPlane(TMP.floor, p);
    return p;
  },
  toScreen(v, W, H) {
    const p = v.clone().project(this.arena.camera);
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  },

  // Ability effects (effects3d.js), once loaded: the page asks which casts have them and passes this frame's to frame().
  effects: null,

  // fighters: [{key, champ, x, y, face: 1 | -1, dir?: {x, y}, role, t, loop, visible}] in device px.
  // Returns {key: {x, y}}, the point above each loaded model's head, so the 2D overlay can place HP bars.
  // scale < 1 renders the models smaller and lets the page stretch them (cheaper on slow devices).
  // fx: this frame's ability effects (effects3d.js draw), unit: px per game unit.
  frame(fighters, W, H, scale = 1, fx = null, unit = null) {
    const out = {};
    // A hidden page (another Simulator tab is open) has no size: every position would divide by 0.
    if (!this.ok || !(W > 0 && H > 0)) return out;
    const { renderer, scene, camera } = this.arena;
    const cw = renderer.domElement.width, ch = renderer.domElement.height;
    const rw = Math.round(W * scale), rh = Math.round(H * scale);
    if (cw !== rw || ch !== rh) renderer.setSize(rw, rh, false);
    // Keep the floor 16 units wide whatever the canvas shape.
    const aspect = H / W;
    camera.left = -8; camera.right = 8; camera.top = 8 * aspect; camera.bottom = -8 * aspect;
    camera.updateProjectionMatrix();
    const seen = TMP.seen;
    seen.clear();
    for (const f of fighters) {
      seen.add(f.key);
      let entry = this.actors.get(f.key);
      if (!entry || entry.champ !== f.champ) {
        if (entry) scene.remove(entry.actor.group);
        this.actors.delete(f.key);
        if (!this.pendingKeys.has(f.key + "|" + f.champ)) {
          this.pendingKeys.add(f.key + "|" + f.champ);
          loadChampion(f.champ).then((g) => {
            this.pendingKeys.delete(f.key + "|" + f.champ);
            if (!g || this.actors.has(f.key)) return;
            const actor = new Actor(g);
            this.actors.set(f.key, { actor, champ: f.champ });
            scene.add(actor.group);
          });
        }
        continue;
      }
      const a = entry.actor;
      this.toWorld(f.x, f.y, W, H, a.group.position);
      // Facing: toward a screen direction when given (screen down is toward the camera), else left or right.
      a.group.rotation.y = f.dir && (f.dir.x || f.dir.y) ? Math.atan2(f.dir.x, f.dir.y) : f.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      // World units per game unit: the camera spans 16 world units across W px.
      const g = (f.unit ? (f.unit * 16) / W : HEIGHT / 200) * (f.scale || 1);
      a.group.scale.setScalar(g);
      let { role, t, loop, n } = f;
      if (f.key === "me" && this.preview) {
        const pt = (performance.now() - this.preview.start) / 1000;
        const pn = this.preview.n || 0;
        if (pt < a.castLength(this.preview.role, pn) + 0.2) { role = this.preview.role; t = pt; loop = false; n = pn; }
        else this.preview = null;
      }
      a.pose(role, t, loop, n, role === f.role ? f.rate : undefined, f.base);
      a.setAlpha(f.alpha === undefined ? 1 : f.alpha);
      a.group.visible = f.visible !== false && a.alpha > 0;
      TMP.head.copy(a.group.position).y += a.height * g * 1.12;
      const head = this.toScreen(TMP.head, W, H);
      out[f.key] = head;
    }
    for (const [key, entry] of this.actors) if (!seen.has(key)) { scene.remove(entry.actor.group); this.actors.delete(key); }
    if (effects) {
      effects.scene = scene;
      effects.draw(fx, scene, camera, (x, y, w, h, out) => this.toWorld(x, y, w, h, out), W, H, unit ? (unit * 16) / W : HEIGHT / 200);
    }
    renderer.render(scene, camera);

    return out;
  },
};

window.Models3D = api;
window.dispatchEvent(new Event("models3d-ready"));
