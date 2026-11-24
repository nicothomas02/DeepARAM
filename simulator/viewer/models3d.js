// 3D champion models for the fight replay (three.js). Each fighter in the arena is an
// animated model posed from the simulated timeline (cast, attack, stunned, death, idle), with
// each ability's clips in order and idle variations (replay-data/anims.json). Models come from
// replay-data/models/ when built there, else the website's /assets/models/. If WebGL or a model is missing,
// replay.js keeps drawing the 2D portraits. The Howling Abyss itself is drawn under the fight (drawGround).
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

// Summons ("summon:tibbers"): models next to the map (summons.json from tools/build_props3d.py), drawn
// like a champion; a tint makes one glow (Viego's souls).
const SUMMONS = "/assets/map3d/";
let summonList = null;
function loadSummon(key) {
  summonList = summonList || fetch(SUMMONS + "summons.json" + BUST).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return summonList.then((list) => {
    const entry = list[key.slice("summon:".length)];
    if (!entry) return null;
    return loader.loadAsync(SUMMONS + entry.file + BUST).then((g) => {
      // Unlit, as the props on the map.
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = entry.tint
          ? new THREE.MeshBasicMaterial({ map: o.material.map, color: new THREE.Color(entry.tint), transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false })
          : new THREE.MeshBasicMaterial({ map: o.material.map });
      });
      return { gltf: g, entry, anim: null };
    }).catch(() => null);
  });
}

function loadChampion(id) {
  const key = String(id).toLowerCase();
  if (key.startsWith("summon:")) {
    if (!gltfs.has(key)) gltfs.set(key, loadSummon(key));
    return gltfs.get(key);
  }
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
      if (o.isMesh) {
        o.frustumCulled = false;
        const ud = o.material.userData || {};
        this.meshes.push({ mesh: o, hash: ud.hash, shown: ud.visible !== false });
      }
      if (o.userData && o.userData.submeshVisibilityEvents) this.events = o.userData.submeshVisibilityEvents;
    });
    // The skeleton's root: the top bone named Root, else the top bone with the most bones under it. (The first bone
    // in the file is often a weapon or an effect anchor: Ziggs' bomb, Nautilus' anchor, Zilean's channel point.)
    const tops = [];
    this.root.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone)) tops.push(o); });
    const size = (b) => { let n = 0; b.traverse((o) => { if (o.isBone) n++; }); return n; };
    this.rootBone = tops.find((b) => /^root$/i.test(b.name)) || tops.reduce((a, b) => (size(b) > size(a) ? b : a), tops[0]) || null;
    // In game units at the champion's in-game size, feet on the ground, measured on the
    // visible parts in the idle pose.
    this.pose("idle", 0, true);
    // Some clips carry root motion (Teemo's Q runs forward, Garen's Q starts in the air);
    // the arena places each fighter itself, so the root bone stays where idle has it.
    this.rootRest = this.rootBone ? this.rootBone.position.clone() : null;
    // Bones beside the root rather than under it (Garen's sword, some champions' weapons and props) carry the
    // same root motion in their own tracks, so they are held back by as much as the root, or they float off.
    this.loose = [];
    if (this.rootBone) {
      for (const b of tops) if (b !== this.rootBone) this.loose.push(b);
    }
    this.movedBy = new Map();     // clip -> names of the loose bones its tracks move
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
    if (this.rootRest) {
      const d = TMP.drift.copy(this.rootBone.position).sub(this.rootRest);
      this.rootBone.position.copy(this.rootRest);
      if (this.loose.length && d.lengthSq() > 0) {
        const moved = this.moved(c), was = this.prev && this.moved(this.prev.c);
        for (const b of this.loose) if (moved.has(b.name) || (was && was.has(b.name))) b.position.sub(d);
      }
    }
    this.showParts(c.name, c.action.time * 30);
    return c.duration;
  }
  // Names of the loose bones (beside the root) whose position a clip animates.
  moved(c) {
    let set = this.movedBy.get(c);
    if (!set) {
      set = new Set();
      const names = new Set(this.loose.map((b) => b.name));
      for (const tr of c.action.getClip().tracks) {
        const dot = tr.name.lastIndexOf(".");
        if (tr.name.slice(dot + 1) === "position" && names.has(tr.name.slice(0, dot))) set.add(tr.name.slice(0, dot));
      }
      this.movedBy.set(c, set);
    }
    return set;
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

// The Howling Abyss under the fight (/assets/map3d/, from tools/build_map3d.py). It is drawn on its own
// canvas below the page's 2D layer, so the shapes and markers the page draws stay on top of it. The file
// is in lane units: x along the lane from where the fight starts, z across it, y up, one game unit each.
const MAP_FILE = "/assets/map3d/howling-abyss.glb";
const MAP_LIGHT = 1.7;           // the light maps are stored at half strength; a little under keeps the floor quiet
const ground = { renderer: null, scene: null, root: null, loading: false };
function loadGround() {
  if (ground.loading) return;
  ground.loading = true;
  loader.loadAsync(MAP_FILE + BUST).then((g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      // Lit by its baked light (the second set of texture coordinates), not by scene lights.
      const m = o.material, light = m.aoMap;
      const basic = new THREE.MeshBasicMaterial({ map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide });
      if (light) { light.channel = 1; basic.lightMap = light; basic.lightMapIntensity = MAP_LIGHT; }
      o.material = basic;
      m.dispose();
    });
    ground.root = g.scene;
    ground.scene.add(g.scene);
    loadProps();
  }).catch(() => {});
}
// Props on the map (props.json from tools/build_props3d.py): Poros along the bridge's edges, idling.
// Each stands at a lane position and plays its clips in turn, on the page's clock, not the fight's.
ground.props = [];
function loadProps() {
  const dir = MAP_FILE.slice(0, MAP_FILE.lastIndexOf("/") + 1);
  fetch(dir + "props.json" + BUST).then((r) => (r.ok ? r.json() : null)).then((list) => {
    if (!list) return;
    const models = {};
    for (const [name, file] of Object.entries(list.models)) models[name] = loader.loadAsync(dir + file + BUST).catch(() => null);
    list.places.forEach((p, i) => models[p.model] && models[p.model].then((g) => {
      if (!g) return;
      const obj = cloneSkinned(g.scene);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        // Unlit like the map, a touch darker so it sits in the map's light.
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map, color: 0xc8d0dc });
        o.frustumCulled = false;
      });
      obj.rotation.y = (p.yaw || 0) * Math.PI / 180;
      ground.scene.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const clips = (p.clips || []).map((n) => THREE.AnimationClip.findByName(g.animations, n)).filter(Boolean);
      const prop = { obj, at: p, size: (list.scale && list.scale[p.model]) || 1, mixer, clips, n: i % Math.max(1, clips.length), action: null };
      const next = () => {
        if (!prop.clips.length) return;
        const clip = prop.clips[prop.n++ % prop.clips.length], a = mixer.clipAction(clip);
        a.reset().setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
        if (prop.action) a.crossFadeFrom(prop.action, 0.3, false);
        a.play();
        prop.action = a;
      };
      mixer.addEventListener("finished", next);
      next();
      mixer.update((i * 1.7) % 3);  // not all in step
      ground.props.push(prop);
    }));
  }).catch(() => {});
}

// Scratch objects reused every frame instead of made anew.
const TMP = { drift: new THREE.Vector3(), ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  head: new THREE.Vector3(), seen: new Set(), o: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), dir: new THREE.Vector3() };

const api = {
  ok: false,
  arena: null,
  actors: new Map(),             // key -> {actor, champ}
  pendingKeys: new Set(),
  preview: null,

  // low: no antialiasing (a WebGL canvas keeps the choice it was made with), and no 3D map.
  // mapCanvas: where the map is drawn, under the page's 2D layer.
  attach(arenaCanvas, low, mapCanvas) {
    try {
      this.arena = { renderer: makeRenderer(arenaCanvas, !low), scene: new THREE.Scene(),
        camera: new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100) };
      this.arena.camera.position.set(0, 11, 11);
      this.arena.camera.lookAt(0, 0, 0);
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
    if (this.ok && mapCanvas && !low) {
      try {
        ground.renderer = makeRenderer(mapCanvas, false);
        ground.scene = new THREE.Scene();
        loadGround();
      } catch (e) {
        ground.renderer = null;
      }
    }
    return this.ok;
  },
  // Keeps the floor 16 units wide whatever the canvas shape.
  fit(W, H) {
    const camera = this.arena.camera, aspect = H / W;
    if (camera.top === 8 * aspect) return;
    camera.left = -8; camera.right = 8; camera.top = 8 * aspect; camera.bottom = -8 * aspect;
    camera.updateProjectionMatrix();
  },
  // Draws the map under the fight: (ox, oy) is where the lane's x = 0, y = 0 is on the canvas (device px)
  // and k is px per game unit along the lane, as the page draws it. Returns false until the map is loaded
  // (or when there is none), so the page draws its own plain lane instead.
  drawGround(ox, oy, k, W, H, scale = 1) {
    if (!this.ok || !ground.root || !(W > 0 && H > 0)) return false;
    const r = ground.renderer, rw = Math.round(W * scale), rh = Math.round(H * scale);
    if (r.domElement.width !== rw || r.domElement.height !== rh) r.setSize(rw, rh, false);
    this.fit(W, H);
    // The page's lane is a top-down drawing; the floor under it is seen at 45 degrees, so a game unit
    // across the lane is longer on the floor than one along it, as for the fighters.
    const o = this.toWorld(ox, oy, W, H, TMP.o), a = this.toWorld(ox + 1000 * k, oy, W, H, TMP.a), b = this.toWorld(ox, oy + 1000 * k, W, H, TMP.b);
    const along = (a.x - o.x) / 1000;
    const across = (b.z - o.z) / 1000;
    ground.root.position.copy(o);
    ground.root.scale.set(along, along, across);
    // Props keep their own shape (the map is stretched across, as the page's lane is).
    const now = performance.now() / 1000, dt = ground.clock ? Math.min(0.1, now - ground.clock) : 0;
    ground.clock = now;
    for (const p of ground.props) {
      p.obj.position.set(o.x + p.at.x * along, o.y, o.z + p.at.z * across);
      p.obj.scale.setScalar(along * p.size);
      p.mixer.update(dt);
    }
    r.render(ground.scene, this.arena.camera);
    ground.shown = true;
    return true;
  },
  // Takes the map away (the page went back to its plain lane).
  clearGround() {
    if (!ground.shown) return;
    ground.renderer.clear();
    ground.shown = false;
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
    this.fit(W, H);
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
      // The screen direction is taken onto the floor, so a direction across the lane is as long as on the map.
      if (f.dir && (f.dir.x || f.dir.y)) {
        const b = this.toWorld(f.x + f.dir.x, f.y + f.dir.y, W, H, TMP.dir);
        a.group.rotation.y = Math.atan2(b.x - a.group.position.x, b.z - a.group.position.z);
      } else a.group.rotation.y = f.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      // World units per game unit: the camera spans 16 world units across W px.
      const g = (f.unit ? (f.unit * 16) / W : HEIGHT / 200) * (f.scale || 1);
      a.group.scale.setScalar(g);
      if (f.up) a.group.position.y += f.up * g;  // game units off the floor (knock-ups)
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
