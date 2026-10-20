// "Change the simulation" panel: edit the build, the enemies and the fight settings,
// re-run the simulator in a Web Worker (sim-worker.js) and replay the new fight.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DUMMY_KEYS = ["fixed_target", "target_hp", "target_armor", "target_mr"];
  // The Fight box shows the four settings most people change; the rest sit under "Advanced settings", by topic.
  const BASIC_KEYS = ["level", "enemy_level", "until_death", "enemy_damage_scale"];
  const WHOLE_KEYS = ["level", "enemy_level", "until_death", "on_fire", "random_respawn", "team_size", "fixed_target", "combo_order"];  // integer steps
  const ADVANCED = [
    ["Fight length", ["fight_cap", "fight_mean", "fight_sd", "fight_min", "fight_max", "engage_min", "engage_max"]],
    ["Crowd control on you", ["cc_scale", "cc_min", "cc_max"]],
    ["Skillshots and movement", ["dodge_chance", "reaction_time", "aim_lead", "start_distance", "enemy_spread", "retarget_delay", "random_respawn"]],
    ["Your champion", ["r_ready_chance", "combo_order", "on_fire"]],
    ["Training dummy", ["target_hp", "target_armor", "target_mr"]],
  ];
  // Short names for the settings; the engine's own description shows under each in small print.
  const LABELS = {
    level: "Your level", enemy_level: "Enemy level", until_death: "Fight lasts", enemy_damage_scale: "Enemy damage ×",
    team_size: "Number of enemies", fight_cap: "Time limit (s)", fight_mean: "Usual length (s)", fight_sd: "Length spread (s)",
    fight_min: "Shortest usual fight (s)", fight_max: "Longest usual fight (s)", engage_min: "Enemies engage from (s)",
    engage_max: "Enemies engage by (s)", cc_scale: "How often ×", cc_min: "Shortest (s)", cc_max: "Longest (s)",
    dodge_chance: "Enemy dodge chance", reaction_time: "Dodge reaction (s)", aim_lead: "Aim ahead (0-1)",
    start_distance: "Enemy start distance", enemy_spread: "Enemy spread", retarget_delay: "Time to next target (s)",
    r_ready_chance: "Ultimate ready at start", combo_order: "Cast order", target_hp: "Dummy HP",
    target_armor: "Dummy armor", target_mr: "Dummy magic resist", on_fire: "On Fire!",
    random_respawn: "Next enemy",
  };
  // Settings that are a choice rather than a number.
  const CHOICES = {
    until_death: [[1, "Until you fall"], [0, "A usual fight length"]],
    combo_order: [[1, "Recommended combo"], [0, "Strongest first"]],
    on_fire: [[0, "Off"], [1, "On"]],
    random_respawn: [[1, "A new random champion"], [0, "The same champion"]],
  };
  const ENEMY_STATS = [
    ["hp", "HP", 1], ["armor", "Armor", 1], ["mr", "MR", 1], ["damage_share", "Dmg share", 0.01],
  ];

  let meta = null, champ = null, trace = null, busy = false;
  // What the simulator measures and Optimize looks for (MODES in replay.js).
  let mode = "damage";
  // Live patch by default; PBE runs the same model on the test server's numbers (data/pbe).
  let patch = "live";
  const patchArgs = () => (patch === "pbe" ? ["--game-data", "data/pbe"] : []);
  // The PBE patch's best builds (replay-data/pbe/best-builds.json), by champion id in lower case:
  // what the build slots start from on the PBE patch until you simulate something yourself.
  let pbeBest = null, custom = false;
  let picks = null; // five enemies [{id, stats:{hp, armor, mr, damage_share}, items:[], augs:[]}]; the first team_size fight
  const combos = {};  // champion id -> combo the user typed
  const enemyById = new Map();

  // ---------- worker ----------
  let worker = null;
  const pending = new Map();
  let nextId = 1;
  function call(args) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      worker.postMessage({ id, args });
    });
  }
  function status(text, kind) {
    const el = $("simStatus");
    el.textContent = text;
    el.className = "sim-status" + (kind ? " " + kind : "");
  }
  try {
    worker = new Worker("sim-worker.js?v=" + (window.REPLAY_VERSION || "0"));
    worker.onmessage = (e) => { const r = pending.get(e.data.id); pending.delete(e.data.id); if (r) r(e.data); };
    worker.onerror = () => status(T("The simulator couldn't start in this browser. The replays above still work."), "err");
    window.I18N.ready.then(loadMeta).then((ok) => { if (ok) status(T("Change anything below, then simulate. Changed values are marked with a dot.")); });
  } catch (e) {
    status(T("The simulator needs Web Workers, which this browser blocks."), "err");
  }

  // Champions, items, augments and settings for the chosen patch.
  function loadMeta() {
    for (const b of ["runBuild", "findBest", "patchSel", "modeSel"]) $(b).disabled = true;
    const best = patch === "pbe" && !pbeBest
      ? fetch("replay-data/pbe/best-builds.json?v=" + (window.REPLAY_VERSION || "0")).then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          pbeBest = {};
          for (const c of (d && d.champions) || []) pbeBest[c.champion.toLowerCase()] = c.build;
        }).catch(() => {})
      : Promise.resolve();
    return Promise.all([call(["--list", "--json", ...patchArgs()]), best]).then(([r]) => {
      if (!r.ok) { status(T("The simulator couldn't load its data:") + " " + r.stderr, "err"); return false; }
      meta = JSON.parse(r.stdout);
      // Official names in the page's language.
      for (const i of meta.items) { i.en = i.name; i.name = NAME("items", i.id, i.name); }
      for (const a of meta.augments) { a.en = a.name; a.name = NAME("augments", a.id, a.name); }
      for (const c of meta.champions) c.name = NAME("champions", c.id, c.name);
      for (const e of meta.enemies) e.name = NAME("champions", e.id, e.name);
      enemyById.clear();
      for (const e of meta.enemies) enemyById.set(e.id.toLowerCase(), e);
      buildFightForm();
      for (const b of ["runBuild", "findBest", "patchSel", "modeSel"]) $(b).disabled = false;
      if (champ) { setTitle(); fillFromTrace(); }
      runLinked();
      return true;
    });
  }
  $("patchSel").addEventListener("change", (e) => {
    patch = e.target.value;
    loadMeta().then((ok) => {
      if (!ok) return;
      status(patch === "pbe"
        ? T("PBE patch: simulations now use the test server's numbers. The replay above changes when you simulate.")
        : T("Live patch: simulations use the current patch's numbers again."));
    });
  });

  $("modeSel").addEventListener("change", (e) => {
    mode = e.target.value;
    window.ReplayViewer.setMode(mode);
    const label = window.ReplayViewer.modes[mode].label;
    status(mode === "damage"
      ? T("Optimizing for damage: Optimize looks for the build with the most damage per second.")
      : T("Optimizing for {mode}: Simulate shows it per fight, and Optimize looks for the build with the most per fight.", { mode: label }));
  });

  window.onReplayLoad = (c, tr, isCustom) => {
    const changedChamp = !champ || champ.id !== c.id;
    if (changedChamp) { offerSubmit(null); offerKitchen(null); }
    champ = c; trace = tr; custom = isCustom;
    setTitle();
    if (meta && (changedChamp || !isCustom)) fillFromTrace();
    runLinked();
  };
  function setTitle() {
    $("buildTitle").textContent = custom
      ? (trace.patch === "pbe" ? T("Your simulated setup (PBE patch)") : T("Your simulated setup"))
      : (pbeBuild() ? T("Simulated best build (PBE patch)") : T("Simulated best build"));
  }
  // The PBE best build for this champion when the PBE patch is chosen and nothing custom is shown.
  function pbeBuild() {
    return patch === "pbe" && !custom && pbeBest && pbeBest[champ.id.toLowerCase()];
  }
  // The Survival leaderboard's enemy, the same for every champion: Ashe (the most picked enemy) with her
  // most popular build, and Teemo for Ashe herself. Keep in step with tools/verify_leaderboard.py.
  const SURVIVAL = { enemy: "Ashe", fallback: "Teemo" };
  const survivalEnemy = (id) => (id.toLowerCase() === SURVIVAL.enemy.toLowerCase() ? SURVIVAL.fallback : SURVIVAL.enemy);
  // A leaderboard link (#Jinx&items=…&augs=…) loads that build into the slots and simulates it, once,
  // against the Survival enemy, as the leaderboard did.
  function runLinked() {
    const l = window.linkedBuild;
    if (!l || !meta || !champ || champ.id.toLowerCase() !== l.champion) return;
    window.linkedBuild = null;
    trace = { build: { items: l.items.map((key) => ({ key })), augments: l.augs.map((key) => ({ key })) }, fight: trace.fight };
    custom = true;
    fillFromTrace();
    const foe = survivalEnemy(champ.id);
    picks = [withBuild({ id: foe, stats: {} }), ...picks.filter((p) => p.id !== foe)].slice(0, 5);
    $("emodePick").checked = true;
    renderEnemies();
    run(true);
  }

  // ---------- build ----------
  function select(options, value, label) {
    const s = document.createElement("select");
    s.setAttribute("aria-label", label);
    s.add(new Option(T("(empty)"), ""));
    for (const o of options) s.add(new Option(o.name + (o.rarity ? " · " + rarityName(o.rarity) : ""), o.key));
    s.value = value || "";
    return s;
  }
  function rarityName(r) { return T({ S: "Silver", G: "Gold", P: "Prismatic" }[r] || r.charAt(0).toUpperCase() + r.slice(1)); }
  // The augments a champion can be offered, sorted by name; ones the simulator can't model yet are marked.
  function augmentsFor(id, keep) {
    const c = meta.champions.find((x) => x.id.toLowerCase() === String(id).toLowerCase());
    const pool = new Set((c && c.augments) || []);
    for (const k of keep || []) pool.add(k);
    return meta.augments.filter((a) => !c || pool.has(a.key))
      .map((a) => a.modeled === false ? { ...a, name: a.name + " " + T("(no effect yet)") } : a)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function fillFromTrace() {
    const box = $("buildBox");
    box.querySelectorAll(".slot-row, .sub").forEach((n) => n.remove());
    const boots = meta.items.filter((i) => i.slot === "boots").sort((a, b) => a.name.localeCompare(b.name));
    const legs = meta.items.filter((i) => i.slot !== "boots").sort((a, b) => a.name.localeCompare(b.name));
    const pbe = pbeBuild();
    const build = pbe ? { items: pbe.items.map((key) => ({ key })), augments: pbe.augments.map((key) => ({ key })) } : trace.build;
    const items = build.items.map((i) => i.key);
    const bootKey = items.find((k) => boots.some((b) => b.key === k)) || "";
    const legKeys = items.filter((k) => k !== bootKey);
    const row = (label, el) => {
      const r = document.createElement("div"); r.className = "slot-row";
      const l = document.createElement("span"); l.textContent = label;
      r.append(l, el); box.append(r);
    };
    row("B", select(boots, bootKey, T("Boots")));
    for (let i = 0; i < 5; i++) row(String(i + 1), select(legs, legKeys[i], T("Item {n}", { n: i + 1 })));
    const sub = document.createElement("div"); sub.className = "sub"; sub.textContent = T("Augments"); box.append(sub);
    const augKeys = build.augments.map((a) => a.key);
    const augs = augmentsFor(champ.id, augKeys);
    for (let i = 0; i < 4; i++) row(String(i + 1), select(augs, augKeys[i], T("Augment {n}", { n: i + 1 })));
    renderCombo();

    if (!picks) {
      picks = trace.fight.team.slice(0, 5).map((id) => withBuild({ id, stats: {} }));
      const byWeight = meta.enemies.slice().sort((a, b) => b.weight - a.weight);
      for (const e of byWeight) {
        if (picks.length >= 5) break;
        if (!picks.some((p) => p.id === e.id) && e.id.toLowerCase() !== champ.id.toLowerCase())
          picks.push(withBuild({ id: e.id, stats: {} }));
      }
    }
    // A champion never fights itself in Mayhem.
    for (const p of picks)
      if (p.id.toLowerCase() === champ.id.toLowerCase())
        p.id = meta.enemies.find((e) => !picks.some((q) => q.id === e.id) && e.id.toLowerCase() !== champ.id.toLowerCase()).id;
    renderEnemies();
  }
  function defaultCombo() {
    const c = meta.champions.find((x) => x.id === champ.id);
    return (c && c.combo) || "";
  }
  function chosenBuild() {
    const sels = [...$("buildBox").querySelectorAll("select")];
    const items = sels.slice(0, 6).map((s) => s.value).filter(Boolean);
    const augs = sels.slice(6).map((s) => s.value).filter(Boolean);
    return { items, augs };
  }

  // ---------- enemies ----------
  // The Enemies box holds how many enemies fight and how they're chosen; each chosen enemy's
  // champion, stats, items and augments sit under Advanced settings.
  function enemyMode() { return document.querySelector('input[name="emode"]:checked').value; }
  for (const r of document.querySelectorAll('input[name="emode"]')) r.addEventListener("change", renderEnemies);
  const teamSize = () => {
    const s = meta && meta.settings.find((x) => x.key === "team_size");
    const v = fieldValues.team_size !== undefined ? fieldValues.team_size : s ? s.default : 1;
    return Math.max(1, Math.min(5, Math.round(v) || 1));
  };
  function renderEnemies() {
    const box = $("enemyDetail");
    box.textContent = "";
    if (!meta) return;
    const size = meta.settings.find((s) => s.key === "team_size");
    if (size) {
      const f = field(size, false);
      f.querySelector("input").min = 1; f.querySelector("input").max = 5;
      f.querySelector("input").addEventListener("change", renderEnemies);
      box.append(f);
    }
    const mode = enemyMode();
    const n = teamSize();
    const p = document.createElement("p"); p.className = "note";
    if (mode === "pool")
      p.textContent = (n === 1
        ? T("Each fight draws one enemy weighted by how often they're picked in Mayhem, with their HP, resists and damage.")
        : T("Each fight draws {n} enemies weighted by how often they're picked in Mayhem, with their HP, resists and damage.", { n })) + " " +
        T("To fight a particular champion or change its stats, items or augments, open Advanced settings.");
    else if (mode === "pick")
      p.textContent = n === 1 ? T("Every fight is against the enemy set under Advanced settings.")
        : T("Every fight is against the {n} enemies set under Advanced settings.", { n });
    else p.id = "dummyNote";
    box.append(p);
    if (mode === "dummy") dummyNote();
    renderEnemyCards();
  }
  // What the dummies are: the average enemy unless changed under Advanced settings.
  function dummyNote() {
    const p = $("dummyNote");
    if (!p || !meta) return;
    const val = (k) => {
      const s = meta.settings.find((x) => x.key === k);
      return Math.round(fieldValues[k] !== undefined ? fieldValues[k] : s ? s.default : 0).toLocaleString();
    };
    const changed = ["target_hp", "target_armor", "target_mr"].some((k) => fieldValues[k] !== undefined);
    const n = teamSize();
    const v = { n, hp: val("target_hp"), armor: val("target_armor"), mr: val("target_mr") };
    p.textContent = (n === 1
      ? (changed ? T("One dummy with {hp} HP, {armor} armor and {mr} magic resist.", v) : T("One dummy with {hp} HP, {armor} armor and {mr} magic resist, the average enemy's.", v))
      : (changed ? T("{n} dummies with {hp} HP, {armor} armor and {mr} magic resist.", v) : T("{n} dummies with {hp} HP, {armor} armor and {mr} magic resist, the average enemy's.", v))) +
      " " + T("They stand still and don't hit back.") + " ";
    const b = document.createElement("button"); b.type = "button"; b.className = "linkish"; b.textContent = T("Change dummy stats");
    b.addEventListener("click", () => {
      openAdvanced();
      const f = $("set_target_hp");
      if (f) { f.scrollIntoView({ block: "center", behavior: "smooth" }); f.focus({ preventScroll: true }); }
    });
    p.append(b);
  }
  // Each enemy starts with its own most popular items and augments.
  function defaultBuild(id) {
    const e = enemyById.get(String(id).toLowerCase()) || {};
    return { items: (e.items || []).slice(), augs: (e.augments || []).slice() };
  }
  function withBuild(pick) { return Object.assign(pick, defaultBuild(pick.id)); }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function changedBuild(pick) {
    const d = defaultBuild(pick.id);
    return { items: !sameList(pick.items, d.items), augs: !sameList(pick.augs, d.augs) };
  }
  function changedPick(pick) {
    const c = changedBuild(pick);
    return Object.keys(pick.stats).length > 0 || c.items || c.augs;
  }
  // Editing a chosen enemy means you want to fight it.
  function useChosen() {
    if (enemyMode() === "pick") return;
    $("emodePick").checked = true;
    renderEnemies();
  }
  function renderEnemyCards() {
    const grid = $("advGrid");
    let fs = $("enemyCards");
    if (!fs) {
      fs = document.createElement("fieldset"); fs.id = "enemyCards"; fs.className = "wide";
      grid.prepend(fs);
    }
    fs.textContent = "";
    const lg = document.createElement("legend"); lg.textContent = T("Chosen enemies"); fs.append(lg);
    if (!meta || !champ || !picks) return;
    const intro = document.createElement("p"); intro.className = "note";
    intro.textContent = T("Used when Enemies is set to Chosen; changing one switches to it. Each enemy starts with its most popular items and augments; its Health, Armor and Magic Resist come from its level and build. Dmg share sets how hard the enemy hits.");
    fs.append(intro);
    const pool = meta.enemies.filter((e) => e.id.toLowerCase() !== champ.id.toLowerCase())
      .sort((a, b) => a.name.localeCompare(b.name));
    const items = meta.items.slice().sort((a, b) => a.name.localeCompare(b.name));
    const cards = document.createElement("div"); cards.className = "enemy-cards";
    picks.slice(0, teamSize()).forEach((pick, idx) => {
      const card = document.createElement("div"); card.className = "enemy";
      const mark = () => { card.classList.toggle("changed", changedPick(pick)); countAdvanced(); };
      const s = document.createElement("select"); s.setAttribute("aria-label", T("Enemy {n}", { n: idx + 1 }));
      for (const e of pool) s.add(new Option(e.name, e.id));
      s.value = pick.id;
      s.addEventListener("change", () => { pick.id = s.value; pick.stats = {}; withBuild(pick); useChosen(); renderEnemyCards(); });
      const stats = document.createElement("div"); stats.className = "enemy-stats";
      const base = enemyById.get(pick.id.toLowerCase()) || {};
      for (const [key, label, step] of ENEMY_STATS) {
        const l = document.createElement("label");
        l.append(T(label));
        const inp = document.createElement("input");
        inp.type = "number"; inp.step = step; inp.min = 0;
        inp.value = pick.stats[key] !== undefined ? pick.stats[key] : base[key];
        const markInput = () => inp.classList.toggle("changed", Math.abs(parseFloat(inp.value) - base[key]) > 1e-9);
        inp.addEventListener("input", () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v) && Math.abs(v - base[key]) > 1e-9) pick.stats[key] = v; else delete pick.stats[key];
          markInput(); mark(); useChosen();
        });
        markInput();
        l.append(inp); stats.append(l);
      }
      const gear = (label, list, chosen, count) => {
        const wrap = document.createElement("div"); wrap.className = "enemy-gear";
        const h = document.createElement("span"); h.textContent = T(label); wrap.append(h);
        for (let i = 0; i < count; i++) {
          const g = select(list, chosen[i], `${T("Enemy {n}", { n: idx + 1 })} · ${T(label)} ${i + 1}`);
          g.addEventListener("change", () => {
            const vals = [...wrap.querySelectorAll("select")].map((x) => x.value).filter(Boolean);
            chosen.length = 0; chosen.push(...vals);
            mark(); useChosen();
          });
          wrap.append(g);
        }
        return wrap;
      };
      card.append(s, stats, gear("Items", items, pick.items, 6), gear("Augments", augmentsFor(pick.id, pick.augs), pick.augs, 4));
      cards.append(card);
      mark();
    });
    fs.append(cards);
  }

  // ---------- fight settings ----------
  const fieldValues = {};
  function field(s, hint = true) {
    const wrap = document.createElement("div"); wrap.className = "field";
    const id = "set_" + s.key;
    const l = document.createElement("label"); l.htmlFor = id;
    const en = s.description.charAt(0).toUpperCase() + s.description.slice(1);
    const words = T(en);
    l.textContent = LABELS[s.key] ? T(LABELS[s.key]) : words;
    if (LABELS[s.key]) {
      l.title = words;
      // The description under the name, unless it only repeats it.
      if (hint && !en.toLowerCase().startsWith(LABELS[s.key].toLowerCase())) {
        const sm = document.createElement("small"); sm.textContent = words; l.append(sm);
      }
    }
    let inp;
    if (CHOICES[s.key]) {
      inp = document.createElement("select"); wrap.classList.add("has-select");  // :has(select) is too new for some browsers
      for (const [v, name] of CHOICES[s.key]) inp.add(new Option(T(name), v));
    } else {
      inp = document.createElement("input");
      inp.type = "number";
      inp.step = WHOLE_KEYS.includes(s.key) ? 1 : Math.abs(s.default) <= 1 ? 0.05 : s.default >= 100 ? 10 : 1;
    }
    inp.id = id;
    inp.value = fieldValues[s.key] !== undefined ? fieldValues[s.key] : s.default;
    const mark = () => wrap.classList.toggle("changed", Math.abs(parseFloat(inp.value) - s.default) > 1e-9);
    inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && Math.abs(v - s.default) > 1e-9) fieldValues[s.key] = v; else delete fieldValues[s.key];
      mark();
      countAdvanced();
      // Changing the dummy means you want to fight it.
      if (DUMMY_KEYS.includes(s.key) && enemyMode() !== "dummy") { $("emodeDummy").checked = true; renderEnemies(); }
      else if (DUMMY_KEYS.includes(s.key)) dummyNote();
    });
    mark();
    wrap.append(l, inp);
    return wrap;
  }
  function buildFightForm() {
    const byKey = new Map(meta.settings.map((s) => [s.key, s]));
    const box = $("fightBox");
    box.querySelectorAll(".field, .sub").forEach((n) => n.remove());
    for (const k of BASIC_KEYS) if (byKey.has(k)) box.append(field(byKey.get(k), false));  // short names only; Advanced settings explain each
    const grid = $("advGrid");
    grid.textContent = "";
    const placed = new Set([...BASIC_KEYS, ...DUMMY_KEYS, "team_size"]);
    const groups = ADVANCED.map(([name, keys]) => {
      keys.forEach((k) => placed.add(k));
      return [name, keys.filter((k) => byKey.has(k))];
    });
    // Settings the engine adds later still show up, in the first group.
    groups[0][1].push(...meta.settings.map((s) => s.key).filter((k) => !placed.has(k)));
    for (const [name, keys] of groups) {
      const fs = document.createElement("fieldset");
      const lg = document.createElement("legend"); lg.textContent = T(name); fs.append(lg);
      if (keys.includes("combo_order")) fs.id = "castBox";
      if (!keys.length) continue;
      for (const k of keys) fs.append(field(byKey.get(k)));
      grid.append(fs);
    }
    if (champ) renderCombo();
    renderEnemies();
    countAdvanced();
  }
  // Cast order when several abilities are ready; defaults to the champion's recommended combo.
  function renderCombo() {
    const box = $("castBox");
    if (!box || !champ) return;
    box.querySelectorAll(".combo-field").forEach((n) => n.remove());
    const wrap = document.createElement("div"); wrap.className = "field combo-field";
    const l = document.createElement("label"); l.htmlFor = "comboInput"; l.textContent = T("Combo (cast order), for example EQRW");
    const combo = document.createElement("input");
    combo.id = "comboInput"; combo.type = "text"; combo.maxLength = 4; combo.autocomplete = "off";
    combo.value = combos[champ.id] || defaultCombo();
    const mark = () => { wrap.classList.toggle("changed", combo.value !== defaultCombo()); countAdvanced(); };
    combo.addEventListener("input", () => {
      combo.value = combo.value.toUpperCase().replace(/[^QWER]/g, "");
      combos[champ.id] = combo.value;
      mark();
    });
    wrap.append(l, combo);
    box.prepend(wrap);
    box.prepend(box.querySelector("legend"));
    mark();
  }
  // "Advanced settings (2 changed)", so changes hidden in the closed section aren't forgotten.
  function countAdvanced() {
    const n = $("advGrid").querySelectorAll(".field.changed, .enemy.changed").length;
    $("advCount").textContent = n ? T("({n} changed)", { n }) : "";
  }

  // Advanced settings open in a dialog and only count once applied: Cancel (or Esc) puts back what was there.
  let advSnap = null;
  function openAdvanced() {
    if ($("advDialog").open) return;
    advSnap = { fields: { ...fieldValues }, combos: { ...combos }, picks: picks && JSON.parse(JSON.stringify(picks)), emode: enemyMode() };
    $("advDialog").showModal();
    // Focus the heading, not the first field: a focused champion menu opens by itself on some browsers.
    $("advTitle").focus();
  }
  function closeAdvanced(apply) {
    const snap = advSnap;
    advSnap = null;
    if (!apply && snap) {
      for (const k of Object.keys(fieldValues)) delete fieldValues[k];
      Object.assign(fieldValues, snap.fields);
      for (const k of Object.keys(combos)) delete combos[k];
      Object.assign(combos, snap.combos);
      picks = snap.picks;
      document.querySelector(`input[name="emode"][value="${snap.emode}"]`).checked = true;
      if (meta) buildFightForm();
    } else if (apply) status(T("Advanced settings applied. Simulate to see them."));
    countAdvanced();
    if ($("advDialog").open) $("advDialog").close();
    $("advBtn").focus();
  }
  $("advBtn").addEventListener("click", openAdvanced);
  $("advApply").addEventListener("click", () => closeAdvanced(true));
  $("advCancel").addEventListener("click", () => closeAdvanced(false));
  $("advDialog").addEventListener("cancel", (e) => { e.preventDefault(); closeAdvanced(false); });

  // ---------- running ----------
  function args(withBuild) {
    const a = ["--champ", champ.id, "--json", "--trace", "/trace.json", ...patchArgs()];
    if (mode !== "damage") a.push("--metric", mode);
    const set = Object.entries(fieldValues).filter(([k]) => !DUMMY_KEYS.includes(k) || enemyMode() === "dummy");
    if (enemyMode() === "dummy") set.push(["fixed_target", 1]);
    if (set.length) a.push("--set", set.map(([k, v]) => `${k}=${v}`).join(","));
    if (enemyMode() === "pick")
      a.push("--team", picks.slice(0, teamSize()).map((p) => {
        const c = changedBuild(p);  // a changed build replaces the enemy's own
        return [p.id, ...Object.entries(p.stats).map(([k, v]) => `${k}=${v}`),
          ...(c.items ? ["items=" + p.items.join("+")] : []), ...(c.augs ? ["augs=" + p.augs.join("+")] : [])].join(":");
      }).join(","));
    const combo = $("comboInput") ? $("comboInput").value : "";
    if (combo && combo !== defaultCombo()) {
      if (new Set(combo).size !== combo.length) throw new Error(T("Use each of Q, W, E and R at most once in the combo."));
      a.push("--combo", combo);
    }
    if (withBuild) {
      const b = chosenBuild();
      if (!b.items.length) throw new Error(T("Pick at least one item."));
      a.push("--items", b.items.join(","));
      if (b.augs.length) a.push("--augs", b.augs.join(","));
    }
    return a;
  }
  async function run(withBuild) {
    if (busy || !meta) return;
    let a;
    try { a = args(withBuild); } catch (e) { status(e.message, "err"); return; }
    busy = true;
    for (const b of ["runBuild", "findBest", "patchSel", "modeSel"]) $(b).disabled = true;
    status(withBuild ? T("Simulating 2,000 fights…") : T("Searching item and augment builds. This takes a few seconds…"), "busy");
    const t0 = performance.now();
    const r = await call(a);
    busy = false;
    for (const b of ["runBuild", "findBest", "patchSel", "modeSel"]) $(b).disabled = false;
    if (!r.ok || !r.trace) {
      status((r.stderr || T("The simulation failed.")).replace(/^error:\s*/, ""), "err");
      return;
    }
    const res = JSON.parse(r.stdout);
    const tr = JSON.parse(r.trace);
    tr.patch = patch;
    const best = res.builds[0].summary;
    const def = window.ReplayViewer.defaultTrace().summary.mean_dps;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const M = window.ReplayViewer.modes[mode], fmt = window.ReplayViewer.modeValue;
    const defSum = window.ReplayViewer.defaultTrace().summary;
    const defVal = mode === "damage" ? def : defSum[M.key];
    const where = (patch === "pbe" ? T("Done in {s} s on the PBE patch.", { s: secs }) : T("Done in {s} s.", { s: secs })) + " ";
    const after = T("The replay above now shows a typical fight with these settings.");
    const alive = best.time_alive.toFixed(1), dps = Math.round(best.mean_dps).toLocaleString();
    if (mode === "damage")
      status(where + T("Average DPS {dps} (±{ci}), alive for {alive} s on average.", { dps, ci: Math.round(best.ci95), alive }) + " " +
        T("The default setup averaged {v}.", { v: Math.round(def).toLocaleString() }) + " " + after);
    else
      status(where + T("{mode}: {v} per fight on average, alive for {alive} s (average DPS {dps}).", { mode: M.label, v: fmt(mode, best[M.key]), alive, dps }) + " " +
        (defVal !== undefined ? T("The default setup averaged {v}.", { v: fmt(mode, defVal) }) + " " : "") + after);
    // ▲/▼ against the default setup, coloured.
    const change = defVal !== undefined ? (best[M.key] - defVal) / Math.max(1, defVal) : 0;
    if (Math.abs(change) >= 0.005) {
      const d = document.createElement("span");
      d.className = change > 0 ? "up" : "down";
      d.textContent = ` ${change > 0 ? "▲" : "▼"} ` + T("{pct}% {what} vs default", { pct: Math.abs(change * 100).toFixed(1), what: mode === "damage" ? "DPS" : M.label });
      $("simStatus").append(d);
    }
    // Any live-patch build can go on the leaderboard: it's simulated again on our side against the Survival
    // enemy with the default settings, so every entry is comparable whatever this run used.
    offerSubmit({ champion: champ.id, items: res.builds[0].build.items, augments: res.builds[0].build.augments, dps: best.mean_dps }, patch === "live");
    offerKitchen({ champion: champ.id, items: res.builds[0].build.items, augments: res.builds[0].build.augments,
      sim: { mode, mean_dps: best.mean_dps, survival_rate: best.survival_rate, time_alive: best.time_alive } }, patch === "live");
    showAlternatives(withBuild ? [] : res.builds);
    window.ReplayViewer.showTrace(tr);
    trace = tr;
    fillFromTrace();
  }
  // ---------- leaderboard ----------
  let submission = null;
  function offerSubmit(build, plain) {
    submission = build && plain ? build : null;
    $("submitBox").hidden = !build;
    $("submitScore").hidden = !submission;
    $("submitScore").disabled = false;
    $("submitNote").textContent = !build ? "" : submission
      ? T("Put this build on the Leaderboard. There every build fights {enemy} with the default settings until your champion falls, simulated again on our side before it's listed.",
        { enemy: NAME("champions", survivalEnemy(build.champion), survivalEnemy(build.champion)) })
      : T("Only live-patch builds can go on the Leaderboard.");
  }
  // The site's bot check, when it's switched on: usually invisible, sometimes a box to tick under the button.
  let checkWidget = null;
  async function botCheck() {
    const cfg = await fetch("/api/bot-check").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    if (!cfg.siteKey) return "";
    if (!window.turnstile) {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = cfg.script; s.async = true; s.onload = ok;
        s.onerror = () => fail(new Error(T("The bot check couldn't load. Try again in a moment.")));
        document.head.append(s);
      });
    }
    let box = $("submitCheck");
    if (!box) { box = document.createElement("div"); box.id = "submitCheck"; $("submitBox").append(box); }
    if (checkWidget !== null) window.turnstile.remove(checkWidget);
    return new Promise((ok, fail) => {
      checkWidget = window.turnstile.render(box, {
        sitekey: cfg.siteKey, appearance: "interaction-only",
        callback: ok,
        "error-callback": () => fail(new Error(T("The bot check didn't pass. Try again."))),
      });
    });
  }
  $("submitScore").addEventListener("click", async () => {
    if (!submission) return;
    $("submitScore").disabled = true;
    $("submitNote").textContent = T("Submitting…");
    try {
      const check = await botCheck();
      const r = await fetch("/api/sim-scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(check ? { ...submission, check } : submission) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ? await kitchenText(b.error) : "");
      $("submitNote").textContent = b.status === "verified"
        ? T("This build is already on the Leaderboard at {dps} DPS.", { dps: Math.round(b.verified_dps).toLocaleString() })
        : b.status === "rejected" ? T("This build was already checked and can't go on the Leaderboard.")
        : T("Submitted. It shows on the Leaderboard once our simulator has re-run it.");
      $("submitScore").hidden = true;
    } catch (e) {
      $("submitScore").disabled = false;
      $("submitNote").textContent = e.message || T("The Leaderboard couldn't be reached. Try again in a moment.");
    }
  });

  // ---------- The Kitchen ----------
  // A simulated build can be sent to The Kitchen with a title and a few words, by a signed-in visitor.
  // It goes into The Kitchen's review queue (POST /api/kitchen/submissions) and shows there once accepted.
  let kitchen = null;
  const entry = (list, key) => (meta && meta[list].find((e) => e.key === key)) || null;
  function offerKitchen(build, live) {
    kitchen = build && live ? build : null;
    $("kitchenBtn").hidden = !kitchen;
    $("kitchenBtn").disabled = false;
    $("kitchenForm").hidden = true;
    $("kitchenNote").textContent = build && !live ? T("Only live-patch builds can go to The Kitchen.") : "";
  }
  // The Kitchen's own messages come in English and are translated from its dictionary (/i18n/kitchen/).
  let kitchenDict = null;
  async function kitchenText(s) {
    if (window.I18N.lang === "en") return s;
    if (!kitchenDict) kitchenDict = fetch(`/i18n/kitchen/${window.I18N.lang}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return (await kitchenDict)[s] || s;
  }
  function kitchenNote(text, link) {
    const n = $("kitchenNote");
    n.textContent = text;
    if (link) {
      const a = document.createElement("a");
      a.href = link.href; a.target = "_top"; a.textContent = link.text;
      n.append(" ", a);
    }
  }
  $("kitchenBtn").addEventListener("click", async () => {
    if (!kitchen) return;
    $("kitchenBtn").disabled = true;
    kitchenNote(T("Checking your account…"));
    const acct = await fetch("/api/account", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    $("kitchenBtn").disabled = false;
    if (!acct.signedIn) {
      kitchenNote(T("Sign in to send builds to The Kitchen."), { href: "/account", text: T("Sign in") });
      return;
    }
    kitchenNote("");
    $("kitchenBtn").hidden = true;
    $("kitchenForm").hidden = false;
    $("kitchenTitle").focus();
  });
  $("kitchenCancel").addEventListener("click", () => {
    $("kitchenForm").hidden = true;
    $("kitchenBtn").hidden = !kitchen;
    kitchenNote("");
  });
  $("kitchenForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!kitchen) return;
    const title = $("kitchenTitle").value.trim(), description = $("kitchenDesc").value.trim();
    if (title.length < 3) { kitchenNote(T("Give your build a title of at least 3 characters.")); $("kitchenTitle").focus(); return; }
    if (description.length < 20) { kitchenNote(T("Write at least 20 characters on why it works.")); $("kitchenDesc").focus(); return; }
    $("kitchenSend").disabled = true;
    kitchenNote(T("Sending…"));
    try {
      const check = await botCheck();
      const body = {
        ...kitchen, title, description, lang: window.I18N.lang,
        // Ids for the names in other languages, and the English names, both in build order.
        item_ids: kitchen.items.map((k) => entry("items", k)?.id).filter(Boolean),
        augment_ids: kitchen.augments.map((k) => entry("augments", k)?.id).filter(Boolean),
        item_names: kitchen.items.map((k) => entry("items", k)?.en).filter(Boolean),
        augment_names: kitchen.augments.map((k) => entry("augments", k)?.en).filter(Boolean),
      };
      if (check) body.check = check;
      const r = await fetch("/api/kitchen/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (r.status === 401) {
        kitchenNote(T("Sign in to send builds to The Kitchen."), { href: "/account", text: T("Sign in") });
        return;
      }
      if (r.status === 404) throw new Error(T("Submissions open soon."));
      if (!r.ok) throw new Error(b.error ? await kitchenText(b.error) : "");
      $("kitchenForm").hidden = true;
      $("kitchenTitle").value = ""; $("kitchenDesc").value = "";
      kitchen = null;
      kitchenNote(T("Sent! It shows in The Kitchen once it's approved."));
    } catch (err) {
      kitchenNote(err.message || T("The Kitchen couldn't be reached. Try again in a moment."));
    } finally {
      $("kitchenSend").disabled = false;
    }
  });

  function showAlternatives(builds) {
    const box = $("alts");
    box.textContent = "";
    box.hidden = builds.length < 2;
    if (builds.length < 2) return;
    const h = document.createElement("div"); h.className = "sub"; h.textContent = T("Other strong builds (click to load into the build slots)");
    box.append(h);
    const name = (k, list) => (list.find((x) => x.key === k) || { name: k }).name;
    builds.slice(1).forEach((b) => {
      const btn = document.createElement("button"); btn.type = "button";
      const M = window.ReplayViewer.modes[mode];
      const dps = document.createElement("b"); dps.textContent = window.ReplayViewer.modeValue(mode, b.summary[M.key]);
      const txt = document.createElement("span");
      txt.textContent = b.build.items.map((k) => name(k, meta.items)).join(", ") + " | " + b.build.augments.map((k) => name(k, meta.augments)).join(", ");
      btn.append(dps, txt);
      btn.addEventListener("click", () => {
        trace = { build: { items: b.build.items.map((key) => ({ key })), augments: b.build.augments.map((key) => ({ key })) }, fight: trace.fight };
        fillFromTrace();
        run(true);
      });
      box.append(btn);
    });
  }

  $("runBuild").addEventListener("click", () => run(true));
  $("findBest").addEventListener("click", () => run(false));
})();
