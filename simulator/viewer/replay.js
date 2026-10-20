// Fight replay for the ARAM Mayhem simulator. Plays a traced fight (mayhem_sim --trace)
// on a canvas. Fighters are animated 3D models (models3d.js) posed from the timeline, and
// enemies cast their own abilities; ability preview clips are the fallback when your
// champion has no model. Data comes from replay-data/.
(() => {
  "use strict";
  const DATA = "replay-data/";
  // full.html draws the fight with 3D models; index.html ("Show fewer animations") draws it in 2D with
  // champion icons. Everything else (fights, panel, sounds, controls) is the same in both.
  const FULL = document.documentElement.dataset.edition === "full";
  const BUST = "?v=" + (window.REPLAY_VERSION || "0");
  const SLOT_COLORS = { P: "#ffd36b", Q: "#4fc3f7", W: "#7bd88f", E: "#f4b860", R: "#e66ad2" };
  // Damage number colours as the game shows them: physical orange, magic violet, true white.
  const TYPE_COLORS = { physical: "#ff8a2b", magic: "#9b7dff", true: "#ffffff" }, CRIT_COLOR = "#ff4b1f";
  // What the simulator measures (the Mode picker in sim-panel.js): damage per second, or per fight the damage
  // you take, the damage you mitigate, the Health you restore and the seconds of crowd control you deal.
  const MODES = {
    damage: { get label() { return T("Damage"); }, key: "mean_dps", fight: "total_damage", now: (s) => s.damage },
    taken: { get label() { return T("Damage taken"); }, key: "damage_taken", fight: "damage_taken", now: (s) => s.taken },
    mitigated: { get label() { return T("Damage mitigated"); }, key: "damage_mitigated", fight: "damage_mitigated", now: (s) => s.mitigated },
    healing: { get label() { return T("Healing done"); }, key: "healing", fight: "healing", now: (s) => s.healing },
    cc: { get label() { return T("Crowd control"); }, key: "cc_seconds", fight: "cc_seconds", now: (s) => s.ccDealt, seconds: true },
  };
  const modeValue = (m, v) => (MODES[m].seconds ? T("{n} s", { n: (v || 0).toFixed(1) }) : Math.round(v || 0).toLocaleString());
  let mode = "damage";
  const SOURCE_COLORS = ["#c9d6e2", SLOT_COLORS.Q, SLOT_COLORS.W, SLOT_COLORS.E, SLOT_COLORS.R, "#b9a3ff", SLOT_COLORS.P];
  const SLOT_COL = { P: 1, Q: 2, W: 3, E: 4, R: 5 };
  // The site's settings menu (gear) saves {motion, sound, graphics, ...} as JSON under "deeparam-settings"
  // and fires a "deeparam-settings" event on its page. This viewer is embedded on the same origin, so it
  // reads the key and listens on the parent page (and for storage events, which cover other tabs).
  const SETTINGS_KEY = "deeparam-settings";
  const siteSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } };
  const onSettings = (fn) => {
    window.addEventListener("storage", (e) => { if (e.key === SETTINGS_KEY || e.key === null) fn(); });
    window.addEventListener("deeparam-settings", fn);
    try { if (window.parent !== window) window.parent.addEventListener("deeparam-settings", fn); } catch (e) { /* not same-origin */ }
  };
  const systemReduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const readMotion = () => { const m = siteSettings().motion; return m === "reduce" || (m !== "full" && systemReduce); };
  let reduceMotion = readMotion();
  onSettings(() => { reduceMotion = readMotion(); });
  const $ = (id) => document.getElementById(id);

  let index = null, traces = null, byId = new Map();
  // Game art loaded at run time (not in the repo); a page that can't reach it falls back to
  // copies in replay-data/art/ when they're there.
  const CDRAGON = "/assets/cd/latest/";
  function loadImage(urls, done) {
    if (!urls.length) return;
    const im = new Image();
    im.onload = () => done(im);
    im.onerror = () => loadImage(urls.slice(1), done);
    im.src = urls[0];
  }
  // A Poro for Poro Charge.
  let poroImg = null;
  loadImage([CDRAGON + "game/assets/spells/icons2d/porocharge_quest2.png", DATA + "art/poro.png"], (im) => { poroImg = im; });
  const PORO_SPEED = 900, PORO_WIDTH = 420; // match poro_speed and poro_width in data/augments.json
  const ATTACK_MISSILE = 2000;  // basic attack missile speed (u/s); the simulator applies the hit at once
  // Which abilities move their caster (dash or blink), from each spell's tags.
  let anims = {};
  fetch(DATA + "anims.json" + BUST).then((r) => (r.ok ? r.json() : {})).then((a) => {
    for (const [k, v] of Object.entries(a)) anims[k.toLowerCase()] = v;
  }).catch(() => {});
  // Champions the game data doesn't cover fall back to index.json's "dash" (from the ability descriptions).
  const moveOf = (id, slot) => {
    const a = anims[String(id).toLowerCase()];
    if (a) return (a[slot] || {}).move || null;
    const c = byId.get(String(id).toLowerCase());
    return c && c.dash && c.dash.includes(slot) ? "dash" : null;
  };
  let champ = null, trace = null, fight = null;
  let t = 0, playing = true, speed = 1, lastFrame = 0;
  const shown = new Map(); // enemy uid -> displayed {x, y, hp}
  const custom = {};       // champion id -> trace the user simulated with their own settings

  // ---------- loading ----------
  Promise.all([
    fetch(DATA + "index.json" + BUST).then((r) => r.json()),
    fetch(DATA + "traces.json" + BUST).then((r) => r.json()),
    window.I18N.ready,
  ]).then(([idx, tr]) => {
    index = idx; traces = tr;
    for (const c of index.champions) { c.name = NAME("champions", c.id, c.name); byId.set(c.id.toLowerCase(), c); }
    const sel = $("champ");
    const list = index.champions.filter((c) => traces[c.id]).sort((a, b) => a.name.localeCompare(b.name));
    for (const c of list) sel.add(new Option(c.name, c.id));
    // #Jinx, or #Jinx&items=a,b&augs=c,d for a build from the leaderboard (simulated by sim-panel.js).
    const hashParts = decodeURIComponent(location.hash.slice(1)).split("&");
    const fromHash = hashParts[0].toLowerCase();
    const linked = new URLSearchParams(hashParts.slice(1).join("&"));
    if (linked.get("items")) window.linkedBuild = { champion: fromHash, items: linked.get("items").split(",").filter(Boolean), augs: (linked.get("augs") || "").split(",").filter(Boolean) };
    // A champion named in the link, else a random one each visit.
    const start = (byId.get(fromHash) && traces[byId.get(fromHash).id] && byId.get(fromHash)) ||
      list[Math.floor(Math.random() * list.length)];
    sel.value = start.id;
    load(start.id);
    loadedAt = performance.now();
    requestAnimationFrame(frame);
    if (window.onReplayData) window.onReplayData(index);
  }).catch((err) => {
    $("title").textContent = T("Replays could not be loaded");
    $("state").textContent = T("Try reloading the page.") + " (" + err + ")";
  });

  // ---------- one champion's fight ----------
  function load(id) {
    champ = byId.get(id.toLowerCase());
    trace = custom[champ.id] || traces[champ.id];
    fight = prepare(trace);
    t = 0; playing = true; shown.clear(); clipState.slot = null;
    $("play").textContent = T("Pause");
    // Titles ("the Loose Cannon") are English only, so other languages show the name alone.
    $("title").textContent = champ.name + (champ.title && window.I18N.lang === "en" ? ", " + champ.title : "");
    $("total").textContent = fight.duration.toFixed(1);
    try { history.replaceState(null, "", "#" + champ.id); } catch (e) { /* sandboxed */ }
    renderBuild();
    renderAbilities();
    setupClip();
    setupModels();
    drawTrack();
    if (window.onReplayLoad) window.onReplayLoad(champ, trace, !!custom[champ.id]);
  }

  // Hooks for the simulation settings panel (sim-panel.js).
  window.ReplayViewer = {
    champion: () => champ,
    defaultTrace: () => traces[champ.id],
    showTrace(tr) { custom[champ.id] = tr; load(champ.id); },
    modes: MODES,
    modeValue,
    setMode(m) { mode = MODES[m] ? m : "damage"; if (trace) renderBuild(); },
    resetTrace() { delete custom[champ.id]; load(champ.id); },
  };

  // Turns the event list into lookups the renderer needs at any time t.
  function prepare(tr) {
    const ev = tr.events;
    // A fight that ends with your death plays on for a few seconds after it (the enemies dance).
    const end = ev.find((e) => e.k === "end");
    const f = { duration: Math.max(tr.fight.duration, end ? end.t : 0), length: tr.fight.duration, engage: tr.fight.engage_at, maxHp: tr.fight.max_hp, events: ev,
      casts: [], attacks: [], procs: [], cc: [], kills: [], self: [], spawns: new Map(), focus: [], numbers: [],
      ecc: [], heals: [], shields: [], toggles: [],
      damage: [], death: null, pos: [], geo: {}, poros: [] };
    for (const a of tr.abilities || []) f.geo[a.slot] = a;
    let lastNum = null;
    for (const e of ev) {
      switch (e.k) {
        case "cast": f.casts.push(e); break;
        case "toggle": f.toggles.push(e); break;
        case "attack": f.attacks.push(e); break;
        case "proc": f.procs.push(e); break;
        case "cc": f.cc.push(e); break;
        case "kill": f.kills.push(e); break;
        case "ecc": f.ecc.push(e); break;
        case "heal": {
          // Healing pops up as one number per half second.
          const last = f.heals[f.heals.length - 1];
          if (last && e.t - last.t < 0.5) last.a += e.a || 0; else f.heals.push({ t: e.t, a: e.a || 0 });
          break;
        }
        case "shield": f.shields.push(e); break;
        case "self": f.self.push(e); break;
        case "death": f.death = e; f.self.push(e); break;
        case "defy": case "revive": f.self.push(e); break;
        case "spawn": f.spawns.set(e.u, e); break;
        case "pos": {
          // Where everyone stands: uid, x, y triples in game units; uid -1 is you.
          const m = new Map();
          let me = null;
          for (let i = 0; i + 2 < e.p.length; i += 3) {
            if (e.p[i] === -1) me = { x: e.p[i + 1], y: e.p[i + 2] };
            else m.set(e.p[i], { x: e.p[i + 1], y: e.p[i + 2] });
          }
          if (me) f.pos.push({ t: e.t, me, m });
          break;
        }
        case "focus": f.focus.push(e); break;
        case "poro": f.poros.push(e); break;
        case "damage": {
          f.damage.push(e);
          // Merge ticks that land together on one target so numbers stay readable.
          if (lastNum && lastNum.u === e.u && lastNum.x === e.x && e.t - lastNum.t < 0.12) lastNum.a += e.a || 0;
          else { lastNum = { t: e.t, u: e.u, x: e.x, a: e.a || 0, src: e.src }; f.numbers.push(lastNum); }
          break;
        }
      }
    }
    // A dash is recorded as two snapshots at the same moment; spread it over the time a
    // 1500 u/s dash takes (but before the next snapshot), so the model travels instead of teleporting.
    // Your blinks (Flash, Ezreal's E) stay instant.
    const me = String(tr.champion || (champ && champ.id) || "");
    const blinkAt = (t) => f.casts.some((c) => Math.abs(c.t + (c.a || 0) - t) < 0.15 && moveOf(me, c.s) === "blink");
    for (let i = 1; i < f.pos.length; i++) {
      const a = f.pos[i - 1], b = f.pos[i], next = f.pos[i + 1];
      const dMe = Math.hypot(b.me.x - a.me.x, b.me.y - a.me.y);
      let d = 0;
      for (const [u, p] of b.m) { const q = a.m.get(u); if (q) d = Math.max(d, Math.hypot(p.x - q.x, p.y - q.y)); }
      const gap = b.t - a.t;
      if (dMe > d && blinkAt(b.t)) continue;
      d = Math.max(d, dMe);
      if (gap >= 0.02 && d / gap <= 2000) continue;
      const want = Math.min(a.t + d / 1500, next ? next.t - 0.01 : Infinity);
      if (want > b.t) b.t = want;
    }
    // Numbers landing on one target close together stack upward instead of on top of each other.
    const recent = new Map();
    for (const n of f.numbers) {
      const prev = recent.get(n.u);
      n.fan = prev && n.t - prev.t < 0.25 ? (prev.fan + 1) % 4 : 0;
      recent.set(n.u, n);
    }
    // When each slot is next cast, for the cooldown sweep.
    const bySlot = {};
    for (const c of f.casts) (bySlot[c.s] = bySlot[c.s] || []).push(c);
    for (const list of Object.values(bySlot))
      list.forEach((c, i) => { c.next = i + 1 < list.length ? list[i + 1].t : f.duration; c.land = c.t + (c.a || 0); c.n = i; });
    f.enemyCasts = enemyCasts(f);
    // Traces from the positional simulator say where everyone stands; older ones don't.
    f.positional = f.pos.length > 1;
    if (f.positional) for (const c of f.casts) {
      c.from = worldAt(f, c.land).me;
      // A line's missile at its own speed (newer traces carry it) stays on screen until it reaches its range.
      const geo = f.geo[c.s] || {};
      if (c.x === "line" && geo.speed > 0 && c.ax !== undefined)
        c.life = Math.max(0.6, (geo.range || Math.hypot(c.ax - c.from.x, c.ay - c.from.y)) / geo.speed + 0.3 - (c.fl || 0));
    }
    if (f.positional) for (const w of f.poros) w.from = worldAt(f, w.t).me;
    // A ranged attack's missile flies distance / speed and lands when the simulator applies the
    // hit (e.t); it leaves after the wind-up, so the animation starts wind-up + flight earlier.
    for (const a of f.attacks) {
      let fly = 0;
      if (tr.ranged) {
        const w = f.positional && worldAt(f, a.t), q = w && w.m.get(a.u);
        fly = q ? Math.min(0.6, Math.max(0.05, Math.hypot(q.x - w.me.x, q.y - w.me.y) / ATTACK_MISSILE)) : 0.18;
      }
      a.fly = fly;
      a.start = a.t - fly - (a.a || 0.3);
    }
    f.attacks.forEach((a, i) => { a.n = i; a.span = i + 1 < f.attacks.length ? f.attacks[i + 1].start - a.start : Infinity; });
    // Crits on attacks: tag the matching damage number.
    for (const a of f.attacks) if (a.f) {
      const n = f.numbers.find((n) => n.u === a.u && Math.abs(n.t - a.t) < 1e-6 && n.src === 0);
      if (n) n.crit = true;
    }
    return f;
  }

  // Enemies open with their recommended combo when they engage (data/combos.json), then
  // keep casting their basic abilities in that order every few seconds; R only once. Each crowd control on you is an enemy's ability landing, so a living enemy
  // casts one just before it (their R if it comes before the engage). The simulator
  // models enemy damage as a steady rate, so these casts set the animations only.
  function enemyCasts(f) {
    const life = new Map(), champs = new Map();
    for (const e of f.events) {
      if (e.k === "spawn") { life.set(e.u, { born: e.t, died: f.length }); champs.set(e.u, e.x); }
      else if (e.k === "kill" && life.has(e.u)) life.get(e.u).died = e.t;
    }
    const comboOf = (u) => ((byId.get(String(champs.get(u)).toLowerCase()) || {}).combo || "QWER").split("");
    const out = new Map();
    for (const [u, L] of life) out.set(u, []);
    for (const c of f.cc) {
      const alive = [...life].filter(([, L]) => L.born <= c.t && c.t < L.died);
      if (!alive.length) continue;
      // The engine names whose ability it is; otherwise any living enemy.
      const own = c.c && alive.find(([u]) => String(champs.get(u)).toLowerCase() === c.c.toLowerCase());
      const [u] = own || alive[Math.floor(c.t * 7) % alive.length];
      out.get(u).push({ t: Math.max(0, c.t - 0.3), s: own && c.s ? c.s : c.t < f.engage ? "R" : comboOf(u).find((x) => x !== "R"), cc: true });
    }
    for (const [u, L] of life) {
      const list = out.get(u);
      // Their recommended combo on engaging (R included), then the basic abilities in the same order.
      const combo = comboOf(u);
      const basics = combo.filter((x) => x !== "R");
      let t = Math.max(L.born, f.engage) + 0.3 + ((u * 0.73) % 1.2);
      const usedR = list.some((c) => c.s === "R");
      for (const x of combo) {
        if (t >= L.died - 0.2) break;
        if (x === "R" && usedR) continue;
        list.push({ t, s: x }); t += 1.05;
      }
      for (let k = 0; basics.length; k++) {
        t += 1.6 + ((u * 1.37 + k) % 1.5);
        if (t >= L.died - 0.2) break;
        list.push({ t, s: basics[k % basics.length] });
      }
      list.sort((a, b) => a.t - b.t);
      // Keep casts apart so each animation can play out; crowd control wins a clash.
      const kept = [];
      for (const c of list) {
        const last = kept[kept.length - 1];
        if (!last || c.t - last.t >= 1) kept.push(c);
        else if (c.cc && !last.cc) kept[kept.length - 1] = c;
      }
      const count = {};
      for (const c of kept) { c.n = count[c.s] || 0; count[c.s] = c.n + 1; }
      out.set(u, kept);
    }
    return out;
  }
  function enemyCastAt(uid, time) {
    let cast = null;
    for (const c of fight.enemyCasts.get(uid) || []) { if (c.t > time) break; cast = c; }
    return cast && time - cast.t < castWindow("e" + uid, cast) ? cast : null;
  }

  // Where everyone stands at time t (game units), between the recorded snapshots. out, when
  // given, is reused (its Map cleared) so the per-frame lookups don't allocate a Map each.
  function worldAt(f, time, out) {
    const P = f.pos;
    let lo = 0, hi = P.length - 1;
    if (time <= P[0].t) return P[0];
    if (time >= P[hi].t) return P[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P[mid].t <= time) lo = mid; else hi = mid; }
    const a = P[lo], b = P[hi], k = (time - a.t) / Math.max(1e-6, b.t - a.t);
    const mix = (p, q) => (q ? { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k } : p);
    const m = out ? out.m : new Map();
    m.clear();
    for (const [u, p] of a.m) m.set(u, mix(p, b.m.get(u)));
    // A unit that appears in the next snapshot stands where it will be (not at your feet).
    for (const [u, p] of b.m) if (!m.has(u)) m.set(u, p);
    const w = out || {};
    w.t = time; w.me = mix(a.me, b.me); w.m = m;
    return w;
  }
  const scratch = [0, 1, 2].map(() => ({ m: new Map() }));
  // The lane on screen: the view follows the fight.
  const LANE = 550;
  const cam = { x: null };
  // rate: playback speed, so the view keeps up with the fight at 2x and doesn't race it at 0.25x.
  function camera(W, H, world, focus, dt, rate) {
    // About as much of the lane as the game's own camera shows (2000 game units across), and
    // never less than the lane's whole width top to bottom.
    const k = Math.max((H * 0.74) / (2 * LANE), W / 2000);
    const f = focus >= 0 && world.m.get(focus);
    let want = f ? (world.me.x * 0.55 + f.x * 0.45) : world.me.x + 300;
    const half = W / 2 / k;
    // Keep you on screen with a margin.
    const lo = world.me.x - half + 160, hi = world.me.x + half - 160;
    want = Math.min(Math.max(want, lo), hi);
    if (cam.x === null || dt <= 0 || dt > 0.5) cam.x = want;
    else cam.x += (want - cam.x) * (1 - Math.exp(-dt * (rate || 1) * 3));
    cam.x = Math.min(Math.max(cam.x, lo), hi);  // a dash never carries you off screen while the view catches up
    return { k, cx: cam.x, sx: (p) => W / 2 + (p.x - cam.x) * k, sy: (p) => H * 0.55 + p.y * k };
  }

  // ---------- state at time t ----------
  // The running totals are kept between frames: playing forward only reads the events since the
  // last frame; a seek backwards, a restart or another fight starts over from the first event.
  let acc = null;
  function stateAt(time) {
    if (!acc || acc.fight !== fight || time < acc.time) {
      acc = { fight, time: 0, i: 0, enemies: new Map(), focus: -1, kills: 0, damage: 0,
        bySource: (trace.sources || []).map(() => 0), healing: 0, ccDealt: 0 };
    }
    const ev = fight.events;
    for (; acc.i < ev.length; acc.i++) {
      const e = ev[acc.i];
      if (e.t > time) break;
      if (e.k === "spawn") acc.enemies.set(e.u, { uid: e.u, champ: e.x, hp: e.hp, max: e.max, born: e.t, died: null });
      else if (e.k === "focus") acc.focus = e.u;
      else if (e.k === "damage") {
        const en = acc.enemies.get(e.u);
        if (en) en.hp = e.hp;
        acc.damage += e.a || 0;
        if (e.src >= 0) acc.bySource[e.src] += e.a || 0;
      } else if (e.k === "kill") {
        const en = acc.enemies.get(e.u);
        if (en) { en.hp = 0; en.died = e.t; }
        acc.kills++;
      } else if (e.k === "heal" && e.tot) acc.healing = e.tot;
      else if (e.k === "ecc" && e.tot) acc.ccDealt = e.tot;
    }
    acc.time = time;
    const s = { enemies: acc.enemies, focus: acc.focus, kills: acc.kills, damage: acc.damage, bySource: acc.bySource, selfHp: fight.maxHp,
      cc: false, dead: false, taken: 0, mitigated: 0, healing: acc.healing, ccDealt: acc.ccDealt };
    // Own HP falls steadily between samples.
    const S = fight.self;
    let lo = 0, hi = S.length;  // first sample after time
    while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].t <= time) lo = mid + 1; else hi = mid; }
    const prev = lo > 0 ? S[lo - 1] : null, next = lo < S.length ? S[lo] : null;
    if (prev) {
      s.selfHp = prev.hp;
      s.shield = prev.sh || 0;
      s.taken = prev.tk || 0;
      s.mitigated = prev.mt || 0;
      if (next && next.t > prev.t) {
        const k = (time - prev.t) / (next.t - prev.t);
        s.selfHp = prev.hp + (next.hp - prev.hp) * k;
        s.shield = (prev.sh || 0) + ((next.sh || 0) - (prev.sh || 0)) * k;
        if (next.tk !== undefined) s.taken += (next.tk - s.taken) * k;
        if (next.mt !== undefined) s.mitigated += (next.mt - s.mitigated) * k;
      }
      // Shields end on their own between samples.
      if (s.shield > 0 && !fight.shields.some((sh) => sh.t <= time && time < sh.t + (sh.l || 0))) s.shield = 0;
    }
    s.dead = !!(fight.death && fight.death.t <= time);
    if (s.dead) { s.selfHp = 0; s.shield = 0; }
    const myCc = fight.cc.find((c) => c.t <= time && time < c.a);
    s.cc = !!myCc;
    s.ccOn = myCc || null;
    return s;
  }
  // Your crowd control on an enemy at time t: the one that ends last.
  function enemyCc(uid, time) {
    let best = null;
    for (const c of fight.ecc) {
      if (c.t > time) break;
      if (c.u === uid && time < c.a && (!best || c.a > best.a)) best = c;
    }
    return best;
  }
  const CC_LOOK = {
    stun: ["STUNNED", "#b388ff"], knockup: ["KNOCKED UP", "#ffb35c"], charm: ["CHARMED", "#ff7fc8"],
    fear: ["FEARED", "#9a7bff"], taunt: ["TAUNTED", "#ff6b6b"], sleep: ["ASLEEP", "#9fb7ff"],
    suppress: ["SUPPRESSED", "#d36bff"], polymorph: ["POLYMORPHED", "#6bffb3"], root: ["ROOTED", "#7fd17f"],
    slow: ["SLOWED", "#6bc7ff"], silence: ["SILENCED", "#c9d6e2"],
  };
  // The badge words in the page's language, once the dictionary is in (English keys stay above).
  window.I18N.ready.then(() => { for (const v of Object.values(CC_LOOK)) v[0] = T(v[0]); });
  // How a champion under crowd control moves: the stunned clip, running when feared,
  // tossed into the air when knocked up. Roots, slows and silences don't change the pose.
  function ccPose(kind, age, total) {
    if (kind === "fear") return { role: "run", t: age, loop: true };
    if (kind === "root" || kind === "slow" || kind === "silence") return null;
    if (kind === "knockup") return { role: "knockup", t: age, loop: false, lift: Math.sin(Math.PI * Math.min(1, age / Math.max(0.2, total))) };
    return { role: "stunned", t: age, loop: true, lift: 0 };
  }
  // A badge over a head: what holds the champion and a bar for the time left.
  function ccBadge(g, x, y, kind, left, total, u) {
    const [label, col] = CC_LOOK[kind] || CC_LOOK.stun;
    g.font = `600 ${11 * u}px "Geist Mono", ui-monospace, monospace`;
    const w = g.measureText(label).width + 12 * u, h = 17 * u;
    g.fillStyle = "rgba(10,12,18,.78)"; g.fillRect(x - w / 2, y - h, w, h);
    g.fillStyle = col; g.fillRect(x - w / 2, y - 3 * u, w * Math.max(0, Math.min(1, left / total)), 3 * u);
    g.textAlign = "center"; g.fillText(label, x, y - 6 * u);
  }

  // ---------- graphics quality ----------
  // The site setting graphics: auto (default), low or high. Auto starts high and drops to
  // low for the rest of the visit when frames run slow (a phone, an old laptop). Low draws at 1x
  // pixel ratio, renders the 3D models at a smaller size without antialiasing, skips a few effects
  // and caps the replay at 30 frames a second.
  const readQuality = () => { const v = siteSettings().graphics; return v === "low" || v === "high" ? v : "auto"; };
  let qualitySetting = readQuality(), autoLow = false;
  const lowQuality = () => qualitySetting === "low" || (qualitySetting === "auto" && autoLow);
  const pixelRatio = () => (lowQuality() ? 1 : Math.min(2, window.devicePixelRatio || 1));
  window.replayQuality = () => (lowQuality() ? "low" : "high") + (qualitySetting === "auto" ? " (auto)" : "");
  // Auto: frame times of the last couple of seconds of playback.
  let slowSince = 0, slowFrames = 0, slowTime = 0;
  function watchSpeed(now, ms) {
    if (qualitySetting !== "auto" || autoLow || ms > 250) return;  // a hidden tab or a load stall isn't slowness
    if (!slowSince) slowSince = now;
    slowFrames++; slowTime += ms;
    if (now - slowSince < 2500) return;
    if (now - loadedAt > 1500 && slowTime / slowFrames > 1000 / 40) { autoLow = true; qualityChanged(); }
    slowSince = 0; slowFrames = 0; slowTime = 0;
  }
  let loadedAt = 0;
  function qualityChanged() {
    trackKey = "";
  }
  onSettings(() => { const q = readQuality(); if (q !== qualitySetting) { qualitySetting = q; qualityChanged(); } });

  // ---------- drawing helpers ----------
  const arena = $("arena"), ctx = arena.getContext("2d");
  const overlayCanvas = $("arenaOverlay"), overlay = overlayCanvas.getContext("2d");
  const modelCanvas = $("arena3d");
  function iconRow(champId) { const c = byId.get(String(champId).toLowerCase()); return c ? c.row : -1; }
  // Without the icon atlas, icons load one by one from index.icon_base; until one arrives its
  // square stays blank.
  const ddIcons = new Map();
  function ddImage(row, col) {
    const c = index.champions[row], rel = c && c.icons && c.icons[col];
    if (!rel) return null;
    let im = ddIcons.get(rel);
    if (!im) {
      im = new Image(); im.crossOrigin = "anonymous";
      im.src = (index.icon_base || CDRAGON + "plugins/rcp-be-lol-game-data/global/default/") + rel;
      ddIcons.set(rel, im);
    }
    return im;
  }
  function ddIcon(row, col) {
    const im = ddImage(row, col);
    return im && im.complete && im.naturalWidth ? im : null;
  }
  // An icon on its own canvas, drawn again once its icon finishes loading.
  function paintIcon(c, row, col, size) {
    const g = c.getContext("2d");
    drawIcon(g, row, col, 0, 0, size, false);
    const im = row >= 0 ? ddImage(row, col) : null;
    if (im && !(im.complete && im.naturalWidth))
      im.addEventListener("load", () => { g.clearRect(0, 0, size, size); drawIcon(g, row, col, 0, 0, size, false); }, { once: true });
  }
  function drawIcon(g, row, col, x, y, size, round) {
    g.save();
    if (round) { g.beginPath(); g.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); g.clip(); }
    const single = row >= 0 ? ddIcon(row, col) : null;
    if (single) {
      g.drawImage(single, x, y, size, size);
    } else {
      g.fillStyle = "#262626"; g.fillRect(x, y, size, size);
    }
    g.restore();
  }
  // shieldFrac: shields as a share of max Health, drawn in white after the Health (the bar
  // shrinks to fit when Health plus shields is more than max Health).
  function hpBar(g, x, y, w, frac, color, shieldFrac) {
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x - 1, y - 1, w + 2, 8);
    const sh = Math.max(0, shieldFrac || 0), hp = Math.max(0, Math.min(1, frac)), k = Math.max(1, hp + sh);
    g.fillStyle = color; g.fillRect(x, y, w * hp / k, 6);
    if (sh > 0) { g.fillStyle = "#eef3f8"; g.fillRect(x + w * hp / k, y, w * sh / k, 6); }
  }
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function resize() {
    const r = arena.getBoundingClientRect();
    const dpr = pixelRatio();
    const w = Math.round(r.width * dpr), h = Math.round(r.width * 9 / 16 * dpr);
    if (arena.width !== w || arena.height !== h) { arena.width = w; arena.height = h; overlayCanvas.width = w; overlayCanvas.height = h; }
    return dpr;
  }

  // Seats: you on the left, the enemy you're hitting in front, the rest of their team behind.
  function seats(W, H, n) {
    const front = { x: W * 0.6, y: H * 0.55 };
    const back = [];
    for (let i = 0; i < n; i++) {
      const a = (-0.6 + 1.2 * (n === 1 ? 0.5 : i / (n - 1)));
      back.push({ x: W * 0.8 + Math.cos(a) * W * 0.05, y: H * 0.55 + Math.sin(a) * H * 0.34 });
    }
    return { me: { x: W * 0.2, y: H * 0.55 }, front, back };
  }

  // How long a cast's animation holds: its clips' length once the model is loaded (a channel
  // or a multi-part ability runs longer), at least 1.1 s, and never past the next cast.
  function castWindow(key, cast) {
    const M = window.Models3D && window.Models3D.ok ? window.Models3D : null;
    const len = M ? M.castLength(key, cast.s, cast.n) : 0;
    // A channel holds the pose for its whole lock.
    const hold = (cast.a || 0) + (cast.l || 0);
    return Math.min(Math.max(1.1, len, hold), Math.max(3, hold), (cast.next || Infinity) - cast.t);
  }
  // How far a dash or blink has carried its caster toward the target, 0 to 1, at age k seconds
  // into the cast: a dash slides out and back, a blink jumps there and back.
  function travel(move, k) {
    if (!move || k < 0 || k > 1.1) return 0;
    if (move === "blink") return k < 0.85 ? 0.72 : 0;
    const out = Math.min(1, k / 0.22), back = k > 0.7 ? Math.min(1, (k - 0.7) / 0.35) : 0;
    return 0.62 * (ease(out) - ease(back));
  }
  // Which animation each model plays at time t, worked out from the timeline so
  // scrubbing shows the same pose as playing.
  // free: past the part of the cast or attack that roots its caster (wind-up and channel), so a
  // champion who walks off plays its run instead of sliding in the rest of the clip.
  function myAnim(time, s) {
    if (s.dead) return { role: "death", t: time - fight.death.t, loop: false };
    let cast = null;
    for (const c of fight.casts) { if (c.t > time) break; cast = c; }
    if (cast && time - cast.t < castWindow("me", cast))
      return { role: cast.s, t: time - cast.t, loop: false, n: cast.n, free: time - cast.t > (cast.a || 0.25) + (cast.l || 0) + 0.1 };
    if (s.cc) {
      const c = s.ccOn;
      return (c && ccPose(c.x, time - c.t, c.a - c.t)) || { role: "stunned", t: time, loop: true };
    }
    // An attack's animation starts with its wind-up (and, for a ranged attack, the missile's flight)
    // before the hit lands. Attacks alternate between the model's attack clips, and when they come
    // faster than a clip lasts the clip plays faster to fit, as the game scales attack animations.
    let atk = null;
    for (const a of fight.attacks) { if (a.start > time) break; atk = a; }
    if (atk) {
      const role = atk.f ? "crit" : "attack", age = time - atk.start;
      const M = window.Models3D && window.Models3D.ok ? window.Models3D : null;
      const len = (M && M.castLength("me", role, atk.n)) || (atk.a || 0.3) + 0.45;
      const fit = Math.min(len, atk.span);
      if (age < fit) return { role, t: age * (len / fit), loop: false, n: atk.n, free: age > (atk.a || 0.3) + atk.fly + 0.1 };
    }
    // A kill: a laugh, taunt or joke (in turn) while the next enemy comes; walking cuts it short.
    let kill = null, kn = 0;
    for (const k of fight.kills) { if (k.t > time) break; kill = k; kn++; }
    if (kill && time - kill.t > CHEER_DELAY && time - kill.t < CHEER_DELAY + CHEER_FOR) {
      const cheer = CHEERS[(kn - 1) % CHEERS.length];
      return { role: cheer, t: time - kill.t - CHEER_DELAY, loop: false, free: true };
    }
    return { role: "idle", t: time, loop: true };
  }
  // Enemies attack while you're within their reach (the same test as the red line to you) and
  // alive, about once every ENEMY_ATTACK seconds; otherwise they stand (or run after you).
  const ENEMY_ATTACK = 1.25, DEAD_FOR = 2;
  // Celebrating a kill (after the target falls) and a new enemy's arrival pose, in seconds.
  const CHEERS = ["laugh", "taunt", "joke"], CHEER_DELAY = 0.35, CHEER_FOR = 2.2, ARRIVE_FOR = 1.6;
  function enemyAnim(time, en, world) {
    if (en.died !== null) return { role: "death", t: time - en.died, loop: false };
    // Your champion is down: the enemies who are still standing dance.
    // laughing first, then dancing.
    if (fight.death && time >= fight.death.t + 0.4) {
      const k = time - fight.death.t - 0.4;
      return k < CHEER_FOR ? { role: "laugh", t: k, loop: false } : { role: "dance", t: k - CHEER_FOR, loop: true };
    }
    const held = enemyCc(en.uid, time);
    const pose = held && ccPose(held.x, time - held.t, held.a - held.t);
    if (pose) return pose;
    const cast = enemyCastAt(en.uid, time);
    if (cast) return { role: cast.s, t: time - cast.t, loop: false, n: cast.n, free: time - cast.t > (cast.a || 0.25) + 0.1 };
    // A later enemy arrives with its respawn pose (walking in plays the run instead).
    if (en.born > 0.05 && time - en.born < ARRIVE_FOR) return { role: "respawn", t: time - en.born, loop: false, free: true };
    if (held && held.x === "root") return { role: "idle", t: time, loop: true };
    if (time < fight.engage || (fight.death && time >= fight.death.t)) return { role: "idle", t: time + en.uid * 0.7, loop: true, chase: true };
    if (world) {
      const w = world.m.get(en.uid), sp = fight.spawns.get(en.uid);
      if (!w || Math.hypot(w.x - world.me.x, w.y - world.me.y) > ((sp && sp.a) || 550) + 130) return { role: "idle", t: time, loop: true, chase: true };
    }
    const since = time - fight.engage + ((en.uid * 0.37) % ENEMY_ATTACK), k = Math.floor(since / ENEMY_ATTACK), age = since - k * ENEMY_ATTACK;
    const M = window.Models3D && window.Models3D.ok ? window.Models3D : null;
    const len = (M && M.castLength("e" + en.uid, "attack", k)) || ENEMY_ATTACK, rate = Math.max(1, len / ENEMY_ATTACK);
    if (age * rate >= len) return { role: "idle", t: time, loop: true, chase: true };
    return { role: "attack", t: age * rate, loop: false, n: k, chase: true, free: age > 0.4 };
  }

  // The camera looks down at 45 degrees, so a circle on the floor shows this much as tall as it is wide.
  const FLOOR_TILT = Math.SQRT1_2;
  // A champion's in-game hitbox radius (game units): 65 for most, 55 to 80 for some.
  const hitboxOf = (id) => (byId.get(String(id).toLowerCase()) || {}).radius || 65;
  // A soft pool of light in the team's colour under a model, so it stands out from the floor.
  function footShadow(g, x, y, rx, rgb) {
    g.save();
    g.translate(x, y); g.scale(1, FLOOR_TILT);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grd.addColorStop(0, `rgba(${rgb},.22)`); grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawArena(time, dt) {
    const dpr = resize();
    // Scale: bigger shapes on narrow screens so portraits stay readable on a phone.
    const W = arena.width, H = arena.height, u = W / dpr < 600 ? W / 760 : W / 1280;
    const s = stateAt(time);
    const world = fight.positional ? worldAt(fight, time, scratch[0]) : null;
    const view = world ? camera(W, H, world, s.focus, dt, playing ? speed : 1) : null;
    const scr = (p) => ({ x: view.sx(p), y: view.sy(p) });
    // Ground: a plain, dark lane, kept quiet so champions and ability effects stand out.
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#091017"; g.fillRect(0, 0, W, H);
    const top = world ? view.sy({ y: -LANE }) : H * 0.18, bottom = world ? view.sy({ y: LANE }) : H * 0.92;
    const lane = g.createLinearGradient(0, top, 0, bottom);
    lane.addColorStop(0, "#111b25"); lane.addColorStop(0.5, "#15212c"); lane.addColorStop(1, "#111b25");
    g.fillStyle = lane; g.fillRect(0, top, W, bottom - top);
    // Faint marks across the lane every 250 units scroll with the view, so you can see the fight move.
    g.strokeStyle = "rgba(143,211,255,.045)"; g.lineWidth = 1.5 * u;
    const step = world ? 250 * view.k : 80 * u, shift = world ? -(((view.cx * view.k) % step) + step) % step : 0;
    g.beginPath();
    for (let x = shift; x < W + step; x += step) { g.moveTo(x, top); g.lineTo(x, bottom); }
    g.stroke();
    g.strokeStyle = "rgba(143,211,255,.16)"; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(0, top); g.lineTo(W, top); g.moveTo(0, bottom); g.lineTo(W, bottom); g.stroke();

    // The fallen stay ~2 s so a 3D model can play its death and fade (a portrait goes after 0.8 s).
    let alive = [...s.enemies.values()].filter((e) => e.died === null || time - e.died < DEAD_FOR);
    const others = alive.filter((e) => e.uid !== s.focus).sort((a, b) => a.uid - b.uid);
    const st = world ? { me: scr(world.me), front: scr(world.me), back: [] } : seats(W, H, Math.max(1, others.length));
    const target = (en) => (en.uid === s.focus ? st.front : st.back[others.indexOf(en)] || st.back[0]);
    for (const en of alive) {
      let d = shown.get(en.uid);
      if (world) {
        // Real positions: exactly where the simulation put them (a fallen enemy stays where it fell).
        const w = world.m.get(en.uid);
        if (w) { const p = scr(w); if (!d) { d = {}; shown.set(en.uid, d); } d.x = p.x; d.y = p.y; d.wx = w.x; d.wy = w.y; }
        else if (d && d.wx !== undefined) { d.x = view.sx({ x: d.wx }); d.y = view.sy({ y: d.wy }); }
        continue;  // not drawn until it has a place on the map
      }
      const want = target(en);
      if (!d || dt <= 0 || dt > 0.5) { d = { x: want.x, y: want.y }; shown.set(en.uid, d); }
      else { const k = 1 - Math.exp(-dt * 8); d.x += (want.x - d.x) * k; d.y += (want.y - d.y) * k; }
    }
    if (world) alive = alive.filter((en) => shown.has(en.uid));
    const posOf = (uid) => shown.get(uid) || st.front;
    const R = 46 * u;          // your portrait radius
    const r = 34 * u;          // enemy portrait radius

    // Melee attacks lunge a portrait forward (a 3D model plays its attack clip instead).
    const M = window.Models3D && window.Models3D.ok ? window.Models3D : null;
    const myModel = !!(M && M.actors.has("me"));
    let lunge = 0;
    if (!trace.ranged && !myModel)
      for (const a of fight.attacks) {
        const age = time - a.t;
        if (age < -0.15) break;
        if (age < 0.15) lunge = Math.max(lunge, 1 - Math.abs(age) / 0.15);
      }

    // Poro Charge (Poro Stampede): each wave is a row of Poros running down the lane.
    for (const w of fight.poros) {
      if (!w.from || !world) continue;
      const dx = w.ax - w.from.x, dy = w.ay - w.from.y, len = Math.hypot(dx, dy) || 1;
      const since = time - w.t, travel = len / PORO_SPEED;
      if (since < 0 || since > travel + 0.3) continue;
      const ux = dx / len, uy = dy / len, d = Math.min(len, since * PORO_SPEED);
      g.globalAlpha = since > travel ? 1 - (since - travel) / 0.3 : 1;
      const rad = Math.max(10 * u, 70 * view.k), n = 5;
      for (let i = 0; i < n; i++) {
        const off = (i + 0.5 - n / 2) * (PORO_WIDTH / n);
        const p = scr({ x: w.from.x + ux * d - uy * off, y: w.from.y + uy * d + ux * off });
        const hop = Math.abs(Math.sin(since * 12 + i * 1.9)) * 8 * u;
        g.save();
        g.beginPath(); g.arc(p.x, p.y - hop, rad, 0, Math.PI * 2); g.closePath();
        if (poroImg && !lowQuality()) { g.clip(); g.drawImage(poroImg, p.x - rad, p.y - hop - rad, rad * 2, rad * 2); }
        else { g.fillStyle = "#f2f6fb"; g.fill(); }
        g.restore();
        g.strokeStyle = "#fff"; g.lineWidth = 2 * u;
        g.beginPath(); g.arc(p.x, p.y - hop, rad, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Toggles (Singed Q, Karthus E, Amumu W, Anivia R): a slowly turning ring while switched on,
    // around you or, for one placed on a target, around it.
    const toggleOn = new Map();
    if (!s.dead) for (const e of fight.toggles) { if (e.t > time) break; if (e.f) toggleOn.set(e.s, e); else toggleOn.delete(e.s); }
    for (const [slot, e] of toggleOn) {
      const at = e.u !== undefined ? posOf(e.u) : st.me;
      const rad = world ? Math.max(20 * u, (e.a || 300) * view.k) : (e.u !== undefined ? 50 : 70) * u;
      const col = SLOT_COLORS[slot] || "#fff";
      g.save();
      g.fillStyle = col; g.strokeStyle = col;
      g.globalAlpha = 0.1 + 0.04 * Math.sin(time * 4); g.beginPath(); g.arc(at.x, at.y, rad, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.55; g.lineWidth = 2.5 * u; g.setLineDash([10 * u, 8 * u]); g.lineDashOffset = -time * 30 * u;
      g.beginPath(); g.arc(at.x, at.y, rad, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    // Ability casts.
    for (const c of fight.casts) {
      const age = time - c.land - (world ? c.fl || 0 : 0);  // since it landed
      const life = c.life || 0.6;
      if (time < c.t || (age > life && !(c.l && time < c.land + c.l))) continue;
      const col = SLOT_COLORS[c.s] || "#fff";
      const to = c.u >= 0 ? posOf(c.u) : st.front;
      const miss = !c.f;
      if (time < c.land) {
        // Wind-up ring around you.
        const p = (time - c.t) / Math.max(0.05, c.a || 0.05);
        g.strokeStyle = col; g.lineWidth = 4 * u;
        g.beginPath(); g.arc(st.me.x, st.me.y, R + 10 * u, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
      } else if (c.l && time < c.land + c.l) {
        // Channel: the ring empties while it holds you in place.
        const p = 1 - (time - c.land) / c.l;
        g.strokeStyle = col; g.lineWidth = 4 * u; g.setLineDash([6 * u, 5 * u]);
        g.beginPath(); g.arc(st.me.x, st.me.y, R + 10 * u, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      if (age > life) continue;
      const fly = 0.2;
      if (world && c.from && ["line", "circle", "cone", "self"].includes(c.x)) {
        drawShape(g, c, time, col, scr, view.k, u);
      } else if (c.x === "aoe") {
        if (age > -0.1) {
          const p = ease((age + 0.1) / 0.5);
          g.strokeStyle = col; g.globalAlpha = 1 - p * 0.9; g.lineWidth = 6 * u;
          g.beginPath(); g.arc(miss ? to.x + 40 * u : to.x, to.y, (40 + 150 * p) * u, 0, Math.PI * 2); g.stroke();
          g.fillStyle = col; g.globalAlpha = 0.18 * (1 - p);
          g.beginPath(); g.arc(miss ? to.x + 40 * u : to.x, to.y, (40 + 150 * p) * u, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
      } else if (c.x === "line") {
        if (age > -fly && age < 0.35) {
          const p = Math.min(1, (age + fly) / fly);
          const ty = miss ? to.y - 70 * u : to.y;
          const ex = st.me.x + (W * 1.05 - st.me.x) * p, ey = st.me.y + (ty - st.me.y) * ((ex - st.me.x) / (to.x - st.me.x || 1));
          g.strokeStyle = col; g.lineCap = "round";
          g.globalAlpha = age > 0 ? Math.max(0, 1 - age / 0.35) : 1;
          g.lineWidth = 14 * u; g.beginPath(); g.moveTo(st.me.x, st.me.y); g.lineTo(ex, ey); g.stroke();
          g.globalAlpha *= 0.5; g.lineWidth = 30 * u; g.stroke();
          g.globalAlpha = 1;
        }
      } else if (age > -fly && age < 0.3) {
        if (age < 0) {
          const p = 1 + age / fly;
          const ty = miss ? to.y - 80 * u : to.y;
          const x = st.me.x + (to.x - st.me.x) * p, y = st.me.y + (ty - st.me.y) * p;
          g.fillStyle = col; g.beginPath(); g.arc(x, y, 11 * u, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 0.35; g.beginPath(); g.arc(x - (to.x - st.me.x) * 0.04, y, 18 * u, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        } else if (!miss) {
          g.strokeStyle = col; g.globalAlpha = 1 - age / 0.3; g.lineWidth = 5 * u;
          g.beginPath(); g.arc(to.x, to.y, r + age * 120 * u, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
        }
      }
      if (miss && age > 0 && age < 0.6) floatText(overlay, T("MISS"), to.x, to.y - r - 30 * u - age * 40 * u, 1 - age / 0.6, "#c9d6e2", 18 * u);
    }

    // Who is hurting you: a faint line from each enemy whose reach you're inside.
    if (world && time > fight.engage && !s.dead && !lowQuality()) {
      g.strokeStyle = "rgba(240,96,90,.22)"; g.lineWidth = 2 * u;
      for (const en of alive) {
        if (en.died !== null) continue;
        const w = world.m.get(en.uid), sp = fight.spawns.get(en.uid);
        if (!w || !sp) continue;
        if (Math.hypot(w.x - world.me.x, w.y - world.me.y) > (sp.a || 550) + 130) continue;
        const p = posOf(en.uid);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(st.me.x, st.me.y); g.stroke();
      }
    }

    // Fighters: 3D models when they're loaded (models3d.js), otherwise portraits.
    const lungeTo = posOf(s.focus);
    let meX = st.me.x + (lungeTo.x - st.me.x) * (world ? 0.12 : 0.25) * lunge, meY = st.me.y + (world ? (lungeTo.y - st.me.y) * 0.12 * lunge : 0);
    // Dashes and blinks carry your model toward your target.
    // A later cast doesn't cancel the move (Zed's E right after his R stays at the target).
    let myCast = null, myTravel = 0;
    for (const c of fight.casts) {
      if (c.t > time || world) break;  // with positions, dashes are already in where you stand
      const m = s.dead ? 0 : travel(moveOf(champ.id, c.s), time - c.t);
      if (m > myTravel) { myTravel = m; myCast = c; }
    }
    const myMove = myCast ? moveOf(champ.id, myCast.s) : null;
    if (myTravel > 0) {
      const to = posOf(s.focus);
      meX = st.me.x + (to.x - st.me.x) * Math.max(myTravel, 0.25 * lunge);
      meY = st.me.y + (to.y - st.me.y) * myTravel;
    }
    const blinks = [];
    if (myMove === "blink" && myCast) blinks.push({ k: time - myCast.t, a: st.me, b: { x: meX, y: meY } });
    if (world)  // a blink: a flash where you left and where you landed
      for (const c of fight.casts) {
        if (c.t > time) break;
        if (time - c.land > 0.3 || moveOf(champ.id, c.s) !== "blink") continue;
        blinks.push({ k: time - c.land, a: scr(worldAt(fight, c.t).me), b: scr(c.from), once: true });
      }
    // An enemy's dash or blink carries it toward you and back (the fight's positions don't move it).
    const dashedTo = (en, p) => {
      const ec = en.died === null ? enemyCastAt(en.uid, time) : null;
      const em = ec && moveOf(en.champ, ec.s);
      const et = em ? travel(em, time - ec.t) : 0;
      return et > 0 ? { x: p.x + (st.me.x - p.x) * et, y: p.y + (st.me.y - p.y) * et, blink: em === "blink", k: time - ec.t } : null;
    };
    let heads = {};
    if (M) {
      const look = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
      // Who is on the move (game units a second), to play their run while they walk.
      const before = world && worldAt(fight, time - 0.15, scratch[1]), after = world && worldAt(fight, time + 0.15, scratch[2]);
      const velocity = (a, b) => (a && b ? { x: (b.x - a.x) / 0.3, y: (b.y - a.y) / 0.3 } : null);
      // Walking plays the run, sped up or slowed to the pace (the clips are made for about 345 u/s).
      // A cast or attack holds its pose through its wind-up, then gives way to the run; a dash
      // (much faster than any walk) keeps the cast's pose.
      const pace = (v) => (v ? Math.hypot(v.x, v.y) : 0);
      const runs = (anim, v) => { const k = pace(v); return k > 60 && (anim.role === "idle" || (anim.free && k < 1000)); };
      // Well above a walk (a speed burst), the haste run where the model has one.
      const runPose = (v) => pace(v) > 480
        ? { role: "haste", t: time, loop: true, rate: Math.min(2, Math.max(0.5, pace(v) / 480)) }
        : { role: "run", t: time, loop: true, rate: Math.min(2, Math.max(0.5, pace(v) / 345)) };
      // After the engage, idle is the plain loop (no idle variations in the middle of a fight).
      const calm = (a) => (a.role === "idle" ? { ...a, rate: 1, base: time >= fight.engage } : a);
      // Models are drawn at their in-game size: px per game unit, as the floor is drawn.
      const unit = view ? view.k : null;
      const mine = myAnim(time, s), myV = world && velocity(before.me, after.me);
      const myRun = !s.dead && runs(mine, myV);
      const fighters = [{ key: "me", champ: champ.id, x: meX, y: meY, face: 1, unit,
        dir: myRun ? myV : world && s.focus >= 0 ? look(st.me, posOf(s.focus)) : null,
        ...(myRun ? runPose(myV) : calm(mine)) }];
      for (const en of alive) {
        let p = posOf(en.uid);
        const q = dashedTo(en, p);
        if (q) {
          if (q.blink) blinks.push({ k: q.k, a: p, b: q });
          p = q;
        }
        const anim = enemyAnim(time, en, world), v = world && en.died === null && velocity(before.m.get(en.uid), after.m.get(en.uid));
        const run = en.died === null && runs(anim, v);
        // The fallen fade out over the last part of their stay.
        const gone = en.died === null ? 0 : time - en.died;
        fighters.push({ key: "e" + en.uid, champ: en.champ, x: p.x, y: p.y, face: -1, unit,
          dir: run ? v : world ? look(p, st.me) : null, alpha: Math.max(0, Math.min(1, (DEAD_FOR - gone) / 0.6)),
          ...(run ? runPose(v) : calm(anim)) });
      }
      for (const f of fighters) if (f.lift) f.y -= f.lift * 55 * u;  // knocked up into the air
      heads = M.frame(fighters, W, H, lowQuality() ? 0.75 : 1);
      // Keep the bars and badges above heads clear of the HUD along the top.
      for (const k in heads) heads[k].y = Math.max(heads[k].y, 56 * dpr);
    }
    const og = overlay;
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, W, H);
    // Blinks: a flash where the caster leaves and where they land, and again on the way back.
    for (const b of blinks) {
      for (const [age, from, to] of b.once ? [[b.k, b.a, b.b]] : [[b.k, b.a, b.b], [b.k - 0.85, b.b, b.a]]) {
        if (age < 0 || age > 0.3) continue;
        og.globalAlpha = 1 - age / 0.3; og.strokeStyle = "#e9f3ff"; og.lineWidth = 2.5 * u;
        for (const p of [from, to]) { og.beginPath(); og.ellipse(p.x, p.y, (18 + age * 90) * u, (7 + age * 35) * u, 0, 0, Math.PI * 2); og.stroke(); }
      }
    }
    og.globalAlpha = 1;

    // Your ranged attacks: the missile leaves after the wind-up and lands as the hit does, at
    // about half the models' height (chest to chest).
    if (trace.ranged && !s.dead) {
      const mid = (x, y, head) => (head ? y + (head.y - y) * 0.45 : y);
      for (const a of fight.attacks) {
        const age = time - a.t;
        if (age < -0.6) break;  // the longest flight
        if (age >= 0 || age < -a.fly) continue;
        const to = posOf(a.u), p = 1 + age / a.fly;
        const y0 = mid(meX, meY, heads.me), y1 = mid(to.x, to.y, heads["e" + a.u]);
        const x = meX + (to.x - meX) * p, y = y0 + (y1 - y0) * p;
        og.fillStyle = a.f ? "#ffd36b" : "#e9f3ff";
        og.beginPath(); og.arc(x, y, (a.f ? 7 : 4.5) * u, 0, Math.PI * 2); og.fill();
      }
    }

    // Enemies. numTop: where damage numbers start over each enemy, above its badge and cast icon.
    const numTop = new Map();
    for (const en of alive) {
      const p = dashedTo(en, posOf(en.uid)) || posOf(en.uid);
      const born = ease((time - en.born) / 0.3);
      const fade = en.died !== null ? 1 - (time - en.died) / 0.8 : 1;
      const rr = r * (en.uid === s.focus ? 1.15 : 0.9);
      const d = shown.get(en.uid);
      d.hp = d.hp === undefined || dt <= 0 || dt > 0.5 ? en.hp : d.hp + (en.hp - d.hp) * (1 - Math.exp(-dt * 12));
      const head = heads["e" + en.uid];
      if (!head && en.died !== null && time - en.died >= 0.8) continue;
      const held = en.died === null ? enemyCc(en.uid, time) : null;
      const cast = en.died === null ? enemyCastAt(en.uid, time) : null;
      const above = head ? head.y - 10 * u : p.y - rr - 20 * u;  // the badge's bottom edge
      numTop.set(en.uid, above - (cast && time - cast.t < 1.1 ? 58 : held ? 23 : 10) * u);
      if (cast) {
        const age = time - cast.t, ic = 44 * u;
        const top = head ? head.y - 14 * u : p.y - rr - 18 * u;
        og.globalAlpha = Math.max(0, Math.min(1, (1.1 - age) / 0.3));
        drawIcon(og, iconRow(en.champ), SLOT_COL[cast.s], (head ? head.x : p.x) - ic / 2, top - ic, ic, false);
        og.strokeStyle = SLOT_COLORS[cast.s]; og.lineWidth = 2 * u;
        og.strokeRect((head ? head.x : p.x) - ic / 2, top - ic, ic, ic);
        og.globalAlpha = 1;
        // The ability flying at you.
        const fly = (age - 0.15) / 0.35;
        if (fly > 0 && fly < 1.4) {
          const tx = meX, ty = meY - R * 0.6, k = Math.min(1, fly);
          const x0 = p.x, y0 = p.y - rr * 0.6, x1 = x0 + (tx - x0) * k, y1 = y0 + (ty - y0) * k;
          g.globalAlpha = Math.max(0, 1 - Math.max(0, fly - 1) / 0.4) * 0.9;
          g.strokeStyle = SLOT_COLORS[cast.s]; g.lineWidth = (cast.s === "R" ? 7 : 4) * u; g.lineCap = "round";
          g.beginPath(); g.moveTo(x0 + (x1 - x0) * Math.max(0, k - 0.35) / k, y0 + (y1 - y0) * Math.max(0, k - 0.35) / k); g.lineTo(x1, y1); g.stroke();
          g.lineCap = "butt"; g.globalAlpha = 1;
        }
      }
      if (head) {
        // Model: a ring at its feet, portrait and HP bar above its head.
        g.globalAlpha = Math.max(0, fade);
        // The ring is the champion's hitbox, at its in-game size.
        const hb = view ? Math.max(6 * u, hitboxOf(en.champ) * view.k) : rr * 1.2;
        footShadow(g, p.x, p.y, hb * 1.15, "240,96,90");
        g.strokeStyle = en.uid === s.focus ? "#f0605a" : "rgba(240,96,90,.55)"; g.lineWidth = 2.5 * u;
        g.beginPath(); g.ellipse(p.x, p.y, hb, hb * FLOOR_TILT, 0, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
        if (en.died === null) {
          const bw = rr * 2;
          drawIcon(og, iconRow(en.champ), 0, head.x - bw / 2 - 22 * u, head.y - 10 * u, 18 * u, true);
          hpBar(og, head.x - bw / 2, head.y - 4 * u, bw, d.hp / en.max, "#f0605a");
          if (held) ccBadge(og, head.x, head.y - 10 * u, held.x, held.a - time, held.a - held.t, u);
        }
        continue;
      }
      g.globalAlpha = Math.max(0, fade) * born;
      g.fillStyle = "rgba(240,96,90,.25)";
      g.beginPath(); g.arc(p.x, p.y, rr + 5 * u, 0, Math.PI * 2); g.fill();
      if (en.died !== null && !lowQuality()) g.filter = "grayscale(1)";
      drawIcon(g, iconRow(en.champ), 0, p.x - rr, p.y - rr, rr * 2, true);
      g.filter = "none";
      g.strokeStyle = en.uid === s.focus ? "#f0605a" : "rgba(240,96,90,.6)"; g.lineWidth = 3 * u;
      g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.stroke();
      hpBar(og, p.x - rr, p.y - rr - 14 * u, rr * 2, d.hp / en.max, "#f0605a");
      if (held) ccBadge(og, p.x, p.y - rr - 20 * u, held.x, held.a - time, held.a - held.t, u);
      if (en.died !== null) {
        g.strokeStyle = "#f4f4f4"; g.lineWidth = 5 * u;
        g.beginPath(); g.moveTo(p.x - rr * 0.6, p.y - rr * 0.6); g.lineTo(p.x + rr * 0.6, p.y + rr * 0.6);
        g.moveTo(p.x + rr * 0.6, p.y - rr * 0.6); g.lineTo(p.x - rr * 0.6, p.y + rr * 0.6); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // You.
    const frac = s.selfHp / fight.maxHp;
    const myHead = heads.me;
    let labelY = meY + R + 30 * u;
    if (myHead) {
      const hb = view ? Math.max(6 * u, hitboxOf(trace.champion) * view.k) : R * 1.2;
      footShadow(g, meX, meY, hb * 1.15, "143,211,255");
      g.strokeStyle = s.dead ? "rgba(120,120,120,.6)" : "#8fd3ff"; g.lineWidth = 2.5 * u;
      g.beginPath(); g.ellipse(meX, meY, hb, hb * FLOOR_TILT, 0, 0, Math.PI * 2); g.stroke();
      hpBar(og, myHead.x - R, myHead.y - 4 * u, R * 2, frac, frac < 0.3 ? "#f0605a" : "#5fd38a", (s.shield || 0) / fight.maxHp);
      labelY = meY + R * 0.5 + 26 * u;
    } else {
      g.fillStyle = s.dead ? "rgba(120,120,120,.2)" : "rgba(143,211,255,.18)";
      g.beginPath(); g.arc(meX, meY, R + 7 * u, 0, Math.PI * 2); g.fill();
      if (s.dead || s.cc) g.filter = s.dead ? "grayscale(1) brightness(.5)" : "saturate(.4)";
      drawIcon(g, champ.row, 0, meX - R, meY - R, R * 2, true);
      g.filter = "none";
      g.strokeStyle = "#8fd3ff"; g.lineWidth = 3 * u;
      g.beginPath(); g.arc(meX, meY, R, 0, Math.PI * 2); g.stroke();
      hpBar(og, meX - R, meY - R - 16 * u, R * 2, frac, frac < 0.3 ? "#f0605a" : "#5fd38a", (s.shield || 0) / fight.maxHp);
    }
    if (s.cc && !s.dead) {
      const cy = myHead ? myHead.y - 18 * u : meY - R - 30 * u;
      og.strokeStyle = "#b388ff"; og.lineWidth = 3 * u;
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + i * 2.1;
        og.beginPath(); og.arc(meX + Math.cos(a) * R * 0.8, cy + Math.sin(a) * 6 * u, 5 * u, 0, Math.PI * 2); og.stroke();
      }
      const c = s.ccOn, kind = (c && c.x) || "stun";
      const top = myHead ? myHead.y - 10 * u : meY - R - 22 * u;
      if (c) ccBadge(og, meX, top, kind, c.a - time, c.a - c.t, u);
      else floatText(og, CC_LOOK.stun[0], meX, labelY, 1, CC_LOOK.stun[1], 15 * u);
    }
    if (s.dead) floatText(og, T("SLAIN"), meX, labelY, 1, "#f0605a", 18 * u);
    else if (time < fight.engage) floatText(og, T("ENEMIES ENGAGE IN {n} s", { n: (fight.engage - time).toFixed(1) }), meX, labelY + (s.cc ? 18 * u : 0), 0.8, "#8295a8", 13 * u);

    // On-hit passives.
    for (const pr of fight.procs) {
      const age = time - pr.t;
      if (age < 0 || age > 0.4) continue;
      const p = posOf(pr.u);
      g.strokeStyle = SLOT_COLORS[pr.s]; g.globalAlpha = 1 - age / 0.4; g.lineWidth = 4 * u;
      g.beginPath(); g.arc(p.x, p.y, r + 10 * u + age * 40 * u, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
    }

    // Damage numbers.
    for (const n of fight.numbers) {
      const age = time - n.t;
      if (age < 0 || age > 0.9 || n.a < 1) continue;
      const p = posOf(n.u);
      const head = heads["e" + n.u];
      const baseY = (numTop.get(n.u) ?? (head ? head.y - 20 * u : p.y - r - 26 * u)) - (n.fan || 0) * 16 * u;
      // As in the game: the number pops in large, rises fast then slows while drifting to one side,
      // and fades at the end; crits are bigger and redder.
      const k = age / 0.9, side = (n.t * 997) % 1 - 0.5;
      const pop = 1 + (n.crit ? 0.8 : 0.45) * Math.max(0, 1 - age / 0.12);
      const size = (n.crit ? 27 : n.a > 400 ? 21 : 17) * u * pop;
      const x = (head ? head.x : p.x) + side * 40 * u + Math.sign(side) * k * 18 * u;
      const y = baseY - (1 - (1 - k) * (1 - k)) * 64 * u;
      gameNumber(overlay, Math.round(n.a).toString(), x, y, k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4,
        n.crit && n.x === "physical" ? CRIT_COLOR : TYPE_COLORS[n.x] || "#fff", size);
    }

    $("kills").textContent = s.kills;
    $("dmg").textContent = Math.round(s.damage).toLocaleString();
    // The chosen mode's running total for this fight, next to the damage (older replays don't carry it).
    const showMode = mode !== "damage" && trace.fight[MODES[mode].fight] !== undefined;
    $("modeHud").hidden = !showMode;
    if (showMode) { $("modeName").textContent = MODES[mode].label; $("modeVal").textContent = modeValue(mode, MODES[mode].now(s)); }
    // Crits: a flash where the attack lands.
    if (!lowQuality())
      for (const a of fight.attacks) {
        const age = time - a.t;
        if (!a.f || age < 0 || age > 0.25) continue;
        const p = posOf(a.u), head = heads["e" + a.u], cx = p.x, cy = head ? (p.y + head.y) / 2 : p.y;
        og.globalAlpha = 1 - age / 0.25; og.strokeStyle = "#ffd36b"; og.lineWidth = 3 * u;
        og.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = i * Math.PI / 4 + 0.3, r0 = (10 + age * 60) * u, r1 = r0 + (i % 2 ? 14 : 24) * u;
          og.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); og.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        }
        og.stroke(); og.globalAlpha = 1;
      }

    // Healing on you: green numbers.
    for (const h of fight.heals) {
      const age = time - h.t;
      if (age < 0 || age > 1 || h.a < 5) continue;
      const top = myHead ? myHead.y - 30 * u : meY - R - 40 * u;
      gameNumber(og, "+" + Math.round(h.a), meX + 40 * u, top - age * 50 * u, age < 0.6 ? 1 : (1 - age) / 0.4, "#5fe06a", 16 * u);
    }

    // Shields on you: a white number and, outside Low graphics, a ring that fades as it ends.
    for (const sh of fight.shields) {
      const age = time - sh.t;
      if (age < 0 || age > (sh.l || 1)) continue;
      const top = myHead ? myHead.y - 30 * u : meY - R - 40 * u;
      if (age < 1) floatText(og, T("+{n} shield", { n: Math.round(sh.a) }), meX - 40 * u, top - age * 50 * u, 1 - age, "#eef3f8", 14 * u);
    }
    if ((s.shield || 0) > 1 && !s.dead && !lowQuality()) {
      og.globalAlpha = 0.35 + 0.15 * Math.sin(time * 6);
      og.strokeStyle = "#dbe8ff"; og.lineWidth = 3 * u;
      og.beginPath(); og.ellipse(meX, myHead ? meY : meY, R * 1.35, myHead ? R * 0.6 : R * 1.35, 0, 0, Math.PI * 2); og.stroke();
      og.globalAlpha = 1;
    }

    // Kills: a burst where the enemy falls; executes say so.
    for (const k of fight.kills) {
      const age = time - k.t;
      if (age < 0 || age > 0.9) continue;
      const p = posOf(k.u), head = heads["e" + k.u], y = head ? head.y : p.y - r;
      if (!lowQuality() && age < 0.5) {
        og.globalAlpha = 1 - age / 0.5; og.strokeStyle = k.f ? "#ff5a4f" : "#ffd36b"; og.lineWidth = 4 * u;
        og.beginPath(); og.ellipse(p.x, p.y, (30 + age * 160) * u, (12 + age * 60) * u, 0, 0, Math.PI * 2); og.stroke();
        og.globalAlpha = 1;
      }
      floatText(og, k.f ? T("EXECUTED") : T("KILL"), p.x, y - 30 * u - age * 30 * u, 1 - age / 0.9, k.f ? "#ff5a4f" : "#ffd36b", (k.f ? 18 : 16) * u);
    }

    // Dashes: a streak from where you set off.
    if (world && !lowQuality())
      for (const c of fight.casts) {
        if (c.t > time) break;
        const age = time - c.land;
        if (age < -0.05 || age > 0.35 || moveOf(champ.id, c.s) !== "dash" || !c.from) continue;
        const a = scr(worldAt(fight, c.t).me), b = scr(c.from);
        const grad = og.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, "rgba(233,243,255,0)"); grad.addColorStop(1, "rgba(233,243,255,.7)");
        og.globalAlpha = Math.max(0, 1 - age / 0.35); og.strokeStyle = grad; og.lineWidth = 10 * u; og.lineCap = "round";
        og.beginPath(); og.moveTo(a.x, a.y); og.lineTo(b.x, b.y); og.stroke();
        og.lineCap = "butt"; og.globalAlpha = 1;
      }

    const held = s.cc ? (CC_LOOK[(s.ccOn && s.ccOn.x) || "stun"] || CC_LOOK.stun)[0] : "";
    $("state").textContent = s.dead ? T("Slain") : held ? (window.I18N.lang === "en" ? held[0] + held.slice(1).toLowerCase() : held) : "";
    return s;
  }

  // One of your abilities drawn to scale where it was aimed: a line's path and missile,
  // a circle landing after its missile flies, a cone, or a ring around you.
  function drawShape(g, c, time, col, scr, k, u) {
    const geo = fight.geo[c.s] || {};
    const from = scr(c.from), aim = scr({ x: c.ax, y: c.ay });
    const fl = c.fl || 0, since = time - c.land, hitAge = since - fl;
    const dx = aim.x - from.x, dy = aim.y - from.y, dl = Math.hypot(dx, dy) || 1;
    if (since < 0) return;
    g.save();
    g.strokeStyle = col; g.fillStyle = col;
    if (c.x === "line") {
      // With its missile speed (newer traces), the head flies at that speed out to the ability's
      // range; older traces only know the flight to the target.
      const wl = Math.hypot(c.ax - c.from.x, c.ay - c.from.y) || 1, reach = geo.speed > 0 ? (geo.range || wl) / wl : 1;
      const span = geo.speed > 0 ? (geo.range || wl) / geo.speed : fl > 0 ? fl * 1.25 : 0.15;
      const p = reach * Math.min(1, since / span), fade = since > span ? 1 - (since - span) / 0.3 : 1;
      if (fade > 0) {
        const w = Math.max(3 * u, (geo.width || 80) * k);
        g.globalAlpha = 0.16 * fade; g.lineWidth = w;
        g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(from.x + dx * reach, from.y + dy * reach); g.stroke();
        const hx = from.x + dx * p, hy = from.y + dy * p;
        g.globalAlpha = fade; g.lineWidth = Math.max(5 * u, w * 0.7); g.lineCap = "round";
        g.beginPath(); g.moveTo(hx - (dx / dl) * 50 * u * Math.min(1, p * 4), hy - (dy / dl) * 50 * u * Math.min(1, p * 4)); g.lineTo(hx, hy); g.stroke();
      }
    } else if (c.x === "circle") {
      const rad = Math.max(8 * u, (geo.radius || 250) * k);
      if (hitAge < 0) {
        // In flight: the landing spot outlined, the missile on its way.
        const p = since / Math.max(0.05, fl);
        g.globalAlpha = 0.5; g.lineWidth = 2 * u; g.setLineDash([6 * u, 6 * u]);
        g.beginPath(); g.arc(aim.x, aim.y, rad, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.globalAlpha = 1; g.beginPath(); g.arc(from.x + dx * p, from.y + dy * p, 9 * u, 0, Math.PI * 2); g.fill();
      } else if (hitAge < 0.5) {
        const p = ease(hitAge / 0.5);
        g.globalAlpha = 0.28 * (1 - p); g.beginPath(); g.arc(aim.x, aim.y, rad, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1 - p; g.lineWidth = 4 * u; g.beginPath(); g.arc(aim.x, aim.y, rad * (0.9 + 0.15 * p), 0, Math.PI * 2); g.stroke();
      }
    } else if (c.x === "cone") {
      if (since < 0.45) {
        const p = ease(since / 0.45), a0 = Math.atan2(dy, dx), half = ((geo.angle || 45) * Math.PI) / 360;
        const rad = Math.max(20 * u, (geo.range || 600) * k);
        g.globalAlpha = 0.3 * (1 - p);
        g.beginPath(); g.moveTo(from.x, from.y); g.arc(from.x, from.y, rad * (0.6 + 0.4 * p), a0 - half, a0 + half); g.closePath(); g.fill();
        g.globalAlpha = 1 - p; g.lineWidth = 3 * u; g.stroke();
      }
    } else if (c.x === "self") {
      if (since < 0.5) {
        const p = ease(since / 0.5), rad = Math.max(20 * u, (geo.radius || 300) * k);
        g.globalAlpha = 0.25 * (1 - p); g.beginPath(); g.arc(from.x, from.y, rad, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1 - p; g.lineWidth = 4 * u; g.beginPath(); g.arc(from.x, from.y, rad * (0.7 + 0.3 * p), 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
  }

  // A damage or heal number in the game's style: heavy type with a thick dark outline.
  function gameNumber(g, text, x, y, alpha, color, size) {
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.font = `800 ${size}px "Geist", system-ui, sans-serif`;
    g.textAlign = "center"; g.lineJoin = "round";
    g.lineWidth = Math.max(3, size / 4.5); g.strokeStyle = "rgba(10,6,4,.9)"; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
    g.lineJoin = "miter"; g.globalAlpha = 1;
  }
  function floatText(g, text, x, y, alpha, color, size) {
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.font = `600 ${size}px "Geist Mono", ui-monospace, monospace`;
    g.textAlign = "center";
    g.lineWidth = Math.max(2, size / 6); g.strokeStyle = "rgba(0,0,0,.8)"; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
    g.globalAlpha = 1;
  }

  // ---------- timeline ----------
  const track = $("track"), tc = $("trackCanvas"), tg = tc.getContext("2d");
  // The track is drawn once into a spare canvas (again when the fight, size or quality changes);
  // each frame only copies it and adds the playhead.
  const trackCache = document.createElement("canvas"), tcg = trackCache.getContext("2d");
  let trackKey = "";
  function drawTrack() {
    if (!fight) return;
    const dpr = pixelRatio();
    const w = Math.round(track.clientWidth * dpr), h = Math.round(track.clientHeight * dpr);
    if (!w || !h) return; // hidden (another Simulator tab is open): nothing to draw until it shows
    if (tc.width !== w || tc.height !== h) { tc.width = w; tc.height = h; }
    const key = w + "x" + h;
    if (trackKey === key && trackCache.fight === fight) return;
    trackKey = key; trackCache.fight = fight;
    trackCache.width = w; trackCache.height = h;
    const tg = tcg;
    const W = w, H = h, X = (s) => (s / fight.duration) * W;
    tg.clearRect(0, 0, W, H);
    tg.fillStyle = "#14171b"; tg.fillRect(0, 0, W, H);
    for (const c of fight.cc) { tg.fillStyle = "rgba(179,136,255,.35)"; tg.fillRect(X(c.t), 0, Math.max(2, X(c.a) - X(c.t)), H); }
    // Your HP line.
    tg.strokeStyle = "#f0605a"; tg.lineWidth = 1.5 * dpr; tg.beginPath();
    tg.moveTo(0, H * 0.1);
    for (const e of fight.self) tg.lineTo(X(e.t), H * (0.1 + 0.8 * (1 - e.hp / fight.maxHp)));
    tg.stroke();
    for (const c of fight.casts) {
      tg.fillStyle = SLOT_COLORS[c.s];
      const row = "QWER".indexOf(c.s);
      tg.fillRect(X(c.t), H * (0.2 + row * 0.16), Math.max(2 * dpr, X(c.a || 0.1)), H * 0.12);
    }
    tg.fillStyle = "#f4f4f4";
    for (const k of fight.kills) { tg.beginPath(); tg.arc(X(k.t), H * 0.1, 3 * dpr, 0, Math.PI * 2); tg.fill(); }
    if (fight.death) { tg.fillStyle = "#f0605a"; tg.fillRect(X(fight.death.t) - dpr, 0, 2 * dpr, H); }
    tg.fillStyle = "rgba(237,237,237,.45)"; tg.fillRect(X(fight.engage), 0, dpr, H);
  }
  function drawPlayhead() {
    drawTrack();
    if (!trackCache.width || !trackCache.height || !tc.width || !tc.height) return;
    const W = tc.width, H = tc.height, x = (t / fight.duration) * W;
    tg.drawImage(trackCache, 0, 0);
    tg.fillStyle = "rgba(10,16,23,.45)"; tg.fillRect(x, 0, W - x, H);
    tg.fillStyle = "#ededed"; tg.fillRect(x - 1, 0, 3, H);
  }
  function seek(ev) {
    const r = track.getBoundingClientRect();
    t = Math.max(0, Math.min(fight.duration, ((ev.clientX - r.left) / r.width) * fight.duration));
    shown.clear();
  }
  let dragging = false;
  track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(e); });
  track.addEventListener("pointermove", (e) => { if (dragging) seek(e); });
  track.addEventListener("pointerup", () => { dragging = false; });

  // ---------- 3D models ----------
  let modelMode = false;
  function attachModels() {
    if (!FULL) return;
    const M = window.Models3D;
    // Antialiasing is fixed when the 3D canvas is made: off for low, and for auto on touch screens
    // (phones have dense screens, where it costs the most and shows the least).
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!M || M.arena || !M.attach($("arena3d"), qualitySetting === "low" || (qualitySetting === "auto" && coarse))) return;
    if (champ) setupModels();
  }
  window.addEventListener("models3d-ready", attachModels);
  attachModels();
  function setupModels() {
    if (!FULL) return;
    const M = window.Models3D;
    if (!M || !M.ok || !champ) return;
    const id = champ.id;
    M.setFight(id, trace.fight.team).then((ok) => {
      if (!champ || champ.id !== id) return;
      modelMode = ok;
      video.pause();
      $("clipVideo").hidden = ok;
      $("clipNote").textContent = ok
        ? T("Click an ability (or press Q, W, E, R) and your champion casts it in the arena.")
        : T("No model for this champion yet, so casts play the ability's preview instead.");
    });
  }
  // Ability button or key: the model's animation, or the clip without a model.
  function showAbility(slot) {
    showCaption(slot);
    if (modelMode) window.Models3D.previewRole(slot);
    playSound(champ, slot, 1);
  }

  // ---------- ability and death sounds ----------
  // With the 3D models, each cast plays its ability's sound and each death the champion's death sound.
  // replay-data/sounds/ holds them all joined into one file (tools/build_game_sounds.py); without it, the
  // website's pack in /assets/sounds/ (tools/pack_clip_sounds.py, ability sounds only, so deaths are silent).
  // Browsers only allow sound after the first click or key.
  // On or off follows the site setting sound (on unless it is false); the Sound button changes it too.
  const readSound = () => siteSettings().sound !== false;
  const saveSound = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...siteSettings(), sound: soundOn })); } catch (e) {}
    try { if (window.parent !== window) window.parent.dispatchEvent(new Event("deeparam-settings")); } catch (e) {}
  };
  let soundOn = readSound(), gestured = false, soundFiles = {};
  onSettings(() => { const on = readSound(); if (on !== soundOn) { soundOn = on; syncSound(); } });
  // Master volume from the slider, 0 to 1, remembered between visits.
  let masterVolume = 0.8;
  try { const v = parseFloat(localStorage.getItem("replayVolume")); if (v >= 0 && v <= 1) masterVolume = v; } catch (e) {}
  let soundBase = DATA + "sounds/";
  const loadSounds = (base) => fetch(base + "sounds.json" + BUST).then((r) => (r.ok ? r.json() : null)).then((m) => {
    if (m && m.clips) { soundFiles = m; soundBase = base; return true; }
    return false;
  }).catch(() => false);
  // The site serves files whole (no byte ranges), so a player can't jump into the middle of one and every
  // clip would start at 0:00, which is Aatrox's first sound. A copy held in memory can be jumped into.
  let soundUrl = null;
  loadSounds(DATA + "sounds/").then((ok) => ok || loadSounds("/assets/sounds/")).then((ok) => {
    if (!ok) return;
    fetch(soundBase + soundFiles.file + BUST).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) soundUrl = URL.createObjectURL(b);
    }).catch(() => {});
  });
  // A few audio players reused round robin. Each is started once inside the first click or
  // key press, which lets it play later from the animation loop (Safari needs this per player).
  const voices = [];
  let nextVoice = 0;
  function silentWav() {
    const n = 400, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, "data"); v.setUint32(40, n, true); b.fill(128, 44);
    return "data:audio/wav;base64," + btoa(String.fromCharCode(...b));
  }
  function unlockVoices() {
    const silent = silentWav();
    for (let i = 0; i < 6; i++) {
      const a = new Audio(silent);
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      voices.push(a);
    }
    pickVoice = new Audio(silent);
    const p = pickVoice.play();
    if (p && p.catch) p.catch(() => {});
  }
  // A short synthesized tone per ability (lower for the ultimate, falling for a death).
  let audio = null;
  const TONES = { Q: [660, 0.12], W: [520, 0.12], E: [440, 0.14], R: [220, 0.35], P: [780, 0.08], D: [300, 0.45] };
  function synth(slot, volume) {
    const [freq, len] = TONES[slot] || TONES.Q;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = slot === "R" ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(slot === "D" ? freq / 3 : freq * 1.5, now + len);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.18 * volume * masterVolume), now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(now); osc.stop(now + len + 0.02);
    } catch (e) { /* no Web Audio */ }
  }
  function playSound(c, slot, volume) {
    if (!soundOn || !gestured || !c || masterVolume === 0) return;
    // Until the game's sounds have loaded (or if they can't), a tone of our own.
    const packed = soundUrl && voices.length && soundFiles.clips && soundFiles.clips[c.id] && soundFiles.clips[c.id][slot];
    if (!packed) { if (!soundUrl) synth(slot, volume); return; }
    const a = voices[nextVoice++ % voices.length];
    a.pause();
    clearTimeout(a.stopTimer);
    a.volume = Math.min(1, volume * masterVolume);
    // Every champion's clips sit in one file; jump to this clip's start.
    const src = soundUrl;
    const start = () => {
      a.currentTime = packed[0];
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    };
    a.onplaying = () => { clearTimeout(a.stopTimer); a.stopTimer = setTimeout(() => a.pause(), packed[1] * 1000); };
    if (a.dataset.src === src && a.readyState >= 1) start();
    else {
      a.dataset.src = src;
      a.onloadedmetadata = () => { a.onloadedmetadata = null; start(); };
      a.src = src;
    }
  }
  // The champion's pick quote, when you choose a champion.
  let pickVoice = null;
  function playPickQuote(c) {
    if (!pickVoice || !soundOn || masterVolume === 0 || !c) return;
    const path = `plugins/rcp-be-lol-game-data/global/default/v1/champion-choose-vo/${c.key}.ogg`;
    const urls = [CDRAGON + path, `${DATA}pick/${c.key}.ogg`];
    let i = 0;
    pickVoice.pause();
    pickVoice.onerror = () => { if (++i < urls.length) { pickVoice.src = urls[i]; pickVoice.play().catch(() => {}); } };
    pickVoice.src = urls[0];
    pickVoice.volume = masterVolume;
    pickVoice.play().catch(() => {});
  }
  function syncSound() {
    video.muted = !(soundOn && gestured) || masterVolume === 0;
    video.volume = masterVolume;
    for (const a of voices) if (!a.paused) a.volume = Math.min(a.volume, masterVolume);
    if (!soundOn) for (const a of voices) a.pause();
    if (pickVoice) { pickVoice.volume = Math.min(pickVoice.volume, masterVolume); if (!soundOn) pickVoice.pause(); }
    const b = $("sound");
    b.textContent = soundOn ? T("Sound on") : T("Sound off");
    b.setAttribute("aria-pressed", String(soundOn));
  }
  for (const type of ["pointerdown", "keydown"])
    window.addEventListener(type, () => { if (!gestured) { gestured = true; unlockVoices(); syncSound(); } }, { capture: true });

  // ---------- ability clips ----------
  const video = $("video");
  const clipState = { slot: null, start: 0, end: 0, startedAt: 0 };
  function setupClip() {
    const local = index.local_clips && champ.clip;
    $("fallback").hidden = true;
    if (local) video.src = DATA + "clips/" + champ.id + ".mp4";
    else video.removeAttribute("src");
    showCaption("Q");
    video.pause();
    if (!modelMode) $("clipNote").textContent = T("Each cast plays the official preview of that ability. Click an ability to watch it again.");
  }
  function showCaption(slot) {
    $("clipChip").textContent = slot;
    $("clipChip").style.background = SLOT_COLORS[slot];
    $("clipName").textContent = (champ.spells && champ.spells[slot]) || slot;
    for (const b of document.querySelectorAll(".ab")) b.classList.toggle("lit", b.dataset.slot === slot);
  }
  function playClip(slot) {
    showCaption(slot);
    clipState.slot = slot;
    clipState.startedAt = performance.now();
    const fb = $("fallback");
    const showFallback = (msg) => {
      fb.hidden = false; fb.textContent = "";
      const c = document.createElement("canvas"); c.width = c.height = 96; c.className = "big";
      paintIcon(c, champ.row, SLOT_COL[slot], 96);
      const p = document.createElement("div"); p.textContent = msg;
      fb.append(c, p);
    };
    if (index.local_clips) {
      const seg = champ.clip && champ.clip[slot];
      if (!seg) { video.pause(); showFallback(T("There's no preview clip for this ability.")); return; }
      fb.hidden = true;
      clipState.start = seg[0]; clipState.end = seg[0] + seg[1] - 0.05;
      video.currentTime = seg[0];
    } else {
      video.pause(); showFallback(T("There's no preview clip for this ability."));
      return;
    }
    video.playbackRate = 1;
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  }
  video.addEventListener("timeupdate", () => { if (video.currentTime >= clipState.end) video.pause(); });
  // A new cast takes over the clip once the current one has had a moment, or at once for an ultimate.
  function maybeClip(slot) {
    if (modelMode || document.querySelector(".clip").hidden) { showCaption(slot); return; }
    const playedFor = (performance.now() - clipState.startedAt) / 1000;
    const busy = clipState.slot && !video.paused && playedFor < 1.2;
    if (!busy || (slot === "R" && clipState.slot !== "R")) playClip(slot);
  }

  let abButtons = [];  // the ability buttons' cooldown canvases, so a frame doesn't query the page
  function renderAbilities() {
    const box = $("abilities"); box.textContent = ""; abButtons = [];
    for (const slot of "QWER") {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ab"; b.dataset.slot = slot;
      b.title = T("{slot}: {name}. Click to see it.", { slot, name: (champ.spells || {})[slot] || "" });
      const c = document.createElement("canvas"); c.width = c.height = 128;
      paintIcon(c, champ.row, SLOT_COL[slot], 128);
      const cd = document.createElement("canvas"); cd.width = cd.height = 128; cd.className = "cd";
      const k = document.createElement("span"); k.className = "key"; k.textContent = slot; k.style.color = SLOT_COLORS[slot];
      b.append(c, cd, k);
      abButtons.push({ slot, cd, g: cd.getContext("2d") });
      b.addEventListener("click", () => showAbility(slot));
      // The ability's cooldown with this build's ability haste, under its icon.
      const w = document.createElement("div"); w.className = "ab-wrap";
      const t = document.createElement("span"); t.className = "ab-cd"; t.dataset.slot = slot;
      w.append(b, t);
      box.append(w);
    }
    showCooldownTimes();
  }
  // Each ability's cooldown in this fight's build (older replays only have the base cooldown).
  function cooldownOf(slot) {
    const a = fight && fight.geo[slot];
    return a ? (a.build_cooldown !== undefined ? a.build_cooldown : a.cooldown) : null;
  }
  function showCooldownTimes() {
    for (const el of document.querySelectorAll("#abilities .ab-cd")) {
      const cd = cooldownOf(el.dataset.slot);
      el.textContent = cd ? T("{n} s", { n: cd < 10 ? cd.toFixed(1) : Math.round(cd) }) : "";
    }
  }
  function drawCooldowns(time) {
    for (const { slot, cd, g } of abButtons) {
      let last = null, never = true;
      for (const c of fight.casts) { if (c.s !== slot) continue; never = false; if (c.t > time) break; last = c; }
      // Ready again after its cooldown, or sooner when the next cast came first (a reset).
      const len = cooldownOf(slot);
      const ready = last ? Math.min(last.next, len ? last.land + len : last.next) : 0;
      const p = never ? -1 : !last || time >= ready ? 2 : (time - last.t) / Math.max(0.01, ready - last.t);
      const left = p >= 0 && p <= 1 ? ready - time : 0;
      const key = fight === cd.fight ? Math.round(p * 200) * 1000 + Math.ceil(left * 10) : NaN;  // skip a redraw that wouldn't change it
      if (key === cd.drawn) continue;
      cd.drawn = key; cd.fight = fight;
      g.clearRect(0, 0, 128, 128);
      if (never) { g.fillStyle = "rgba(10,16,23,.7)"; g.fillRect(0, 0, 128, 128); continue; }
      if (p > 1) continue;
      g.fillStyle = "rgba(10,16,23,.65)";
      g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 100, -Math.PI / 2 + p * Math.PI * 2, Math.PI * 1.5); g.closePath(); g.fill();
      // Seconds until it's back, as in the game.
      g.font = "700 46px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,.8)"; g.fillStyle = "#fff";
      const txt = left < 1 ? left.toFixed(1) : String(Math.ceil(left));
      g.strokeText(txt, 64, 66); g.fillText(txt, 64, 66);
    }
  }

  // ---------- side panels ----------
  function renderBuild() {
    const b = $("build"); b.textContent = "";
    for (const it of trace.build.items) { const s = document.createElement("span"); s.textContent = NAME("items", it.id, it.name); b.append(s); }
    for (const a of trace.build.augments) { const s = document.createElement("span"); s.className = "aug " + (a.rarity || ""); s.textContent = NAME("augments", a.id, a.name); b.append(s); }
    const sm = trace.summary, f = trace.fight;
    const has = mode !== "damage" && sm[MODES[mode].key] !== undefined;
    const st = [
      ...(has ? [[T("{mode} / fight", { mode: MODES[mode].label }), modeValue(mode, sm[MODES[mode].key])]] : []),
      [T("Average DPS"), Math.round(sm.mean_dps).toLocaleString()],
      [T("Time alive"), T("{n} s", { n: (sm.time_alive || 0).toFixed(1) })],
      [T("Kills / min"), sm.kills_per_minute.toFixed(1)],
      [T("This fight"), T("{n} s", { n: f.duration.toFixed(1) })],
      [f.team.length === 1 ? T("Enemy") : T("Enemies"), f.team.map((id) => NAME("champions", id, (byId.get(id.toLowerCase()) || { name: id }).name)).join(", ")],
    ];
    const box = $("stats"); box.textContent = "";
    for (const [k, v] of st) {
      const d = document.createElement("div");
      const s = document.createElement("small"); s.textContent = k;
      const bb = document.createElement("b"); bb.textContent = v;
      if (k === "Enemy team") { bb.style.fontSize = "13px"; d.style.gridColumn = "1 / -1"; }
      d.append(s, bb); box.append(d);
    }
  }
  function renderBars(s) {
    const box = $("bars");
    if (box.childElementCount !== trace.sources.length) {
      box.replaceChildren(); box.drawn = null;
      trace.sources.forEach((name, i) => {
        const row = document.createElement("div"); row.className = "bar";
        const label = document.createElement("span"); label.textContent = T(name);
        const fill = document.createElement("div"); fill.className = "fill";
        const bar = document.createElement("i"); bar.style.background = SOURCE_COLORS[i]; fill.append(bar);
        const v = document.createElement("b");
        row.append(label, fill, v); box.append(row);
      });
    }
    const max = Math.max(1, ...s.bySource);
    const key = s.bySource.map(Math.round).join();
    if (box.drawn === key) return;
    box.drawn = key;
    [...box.children].forEach((row, i) => {
      row.querySelector("i").style.width = (100 * s.bySource[i] / max).toFixed(1) + "%";
      row.querySelector("b").textContent = Math.round(s.bySource[i]).toLocaleString();
    });
  }

  // When embedded in the site (same origin), let it buzz and chime when you come out of the fight alive.
  function haptic(kind) {
    try { if (window.parent !== window) window.parent.postMessage({ type: "deeparam-haptic", kind }, location.origin); } catch {}
  }

  // ---------- main loop ----------
  function frame(now) {
    // Low quality: about 30 frames a second (skip a screen refresh when the last frame was recent).
    if (lowQuality() && lastFrame && now - lastFrame < 28) { requestAnimationFrame(frame); return; }
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    if (lastFrame && playing && !document.hidden) watchSpeed(now, now - lastFrame);
    lastFrame = now;
    window.replayFrames = (window.replayFrames || 0) + 1;
    if (fight) {
      const before = t;
      if (playing && !dragging) {
        t = Math.min(fight.duration, t + dt * speed);
        if (t >= fight.duration) { playing = false; $("play").textContent = T("Play"); if (before < fight.duration && !fight.death) haptic("win"); }
        // Clips for casts that started during this frame.
        let latest = null;
        for (const c of fight.casts) if (c.t > before && c.t <= t) latest = !latest || c.s === "R" ? c : latest;
        if (latest) maybeClip(latest.s);
        for (const c of fight.casts) if (c.t > before && c.t <= t) playSound(champ, c.s, 1);
        for (const [uid, list] of fight.enemyCasts)
          for (const c of list) if (c.t > before && c.t <= t) {
            const sp = fight.spawns.get(uid);
            playSound(sp && byId.get(String(sp.x).toLowerCase()), c.s, 0.45);
          }
        if (fight.death && fight.death.t > before && fight.death.t <= t) playSound(champ, "D", 1);
        for (const k of fight.kills) if (k.t > before && k.t <= t) {
          const sp = fight.spawns.get(k.u);
          playSound(sp && byId.get(String(sp.x).toLowerCase()), "D", 0.6);
        }
      }
      const s = drawArena(t, reduceMotion ? 0 : dt);
      drawPlayhead();
      drawCooldowns(t);
      renderBars(s);
      $("now").textContent = t.toFixed(1);
    }
    requestAnimationFrame(frame);
  }

  // ---------- controls ----------
  $("champ").addEventListener("change", (e) => { load(e.target.value); playPickQuote(champ); });
  $("rand").addEventListener("click", () => {
    const opts = $("champ").options;
    const pick = opts[Math.floor(Math.random() * opts.length)].value;
    $("champ").value = pick; load(pick); playPickQuote(champ);
  });
  $("play").addEventListener("click", () => {
    if (!fight) return;
    if (t >= fight.duration) { t = 0; shown.clear(); }
    playing = !playing;
    $("play").textContent = playing ? T("Pause") : T("Play");
    if (!playing) video.pause();
  });
  $("restart").addEventListener("click", () => { t = 0; shown.clear(); playing = true; $("play").textContent = T("Pause"); });
  $("speed").addEventListener("change", (e) => { speed = parseFloat(e.target.value); });
  $("sound").addEventListener("click", () => { soundOn = !soundOn; saveSound(); syncSound(); });
  syncSound();  // the button shows the saved setting from the start
  const volumeInput = $("volume");
  volumeInput.value = Math.round(masterVolume * 100);
  volumeInput.addEventListener("input", () => {
    masterVolume = volumeInput.value / 100;
    try { localStorage.setItem("replayVolume", String(masterVolume)); } catch (e) {}
    if (masterVolume > 0 && !soundOn) { soundOn = true; saveSound(); }
    syncSound();
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); $("play").click(); }
    else if (e.key === "ArrowRight" && fight) { t = Math.min(fight.duration, t + 1); shown.clear(); }
    else if (e.key === "ArrowLeft" && fight) { t = Math.max(0, t - 1); shown.clear(); }
    else if ("qwer".includes(e.key.toLowerCase()) && e.key.length === 1 && champ) showAbility(e.key.toUpperCase());
  });
  window.addEventListener("resize", drawTrack);
})();
