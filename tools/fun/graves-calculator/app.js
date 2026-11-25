LabI18n.ready(function () {
  "use strict";
  const data = window.GRAVES_DATA;
  const T = LabI18n.t;
  for (const a of data.augments) a.name = LabI18n.name("augments", a.id, a.name);
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (isFinite(n) ? LabI18n.num(n, { maximumFractionDigits: d }) : "∞");
  const pct = (n) => `${fmt(n * 100)}%`;
  const S = data.champion.spells;
  const base = GravesCalc.baseMana(data);

  const MAX_AUGS = 4;
  // What each augment does to the loop, in one line.
  const WHAT = {
    ARAM_MysticPunch: "Each shot takes 1.25 seconds off every cooldown per enemy it hits, down to 0.5 seconds.",
    ARAM_Archmage: "Each cast takes 30% of its base cooldown off another random ability on cooldown.",
    UltimateAwakening: "Collateral Damage resets Q, W and E and gives 300 basic haste for 15 seconds (20 second cooldown).",
    ARAM_BreadAndCheese: "Quickdraw gains 100 Ability Haste.",
    ARAM_Purist_Caster: "Bonus attack speed becomes Ability Haste (0.65 per 1%) and cooldowns are 10% shorter. Graves shoots and reloads at base speed.",
  };
  // Mystic Punch, Purist - Caster and Bread and Cheese: Quickdraw is back after every shot, a dash and a shot every
  // 0.4 seconds, from 1.5 attack speed and 50 Ability Haste (README).
  const PRESET = { qRank: 1, wRank: 1, eRank: 5, rRank: 3, haste: 50, attackSpeed: 1.5, crit: 0, pellets: 4, targets: 1, castQ: false, castW: false, castR: false, maxMana: 0, regen5: -1, augments: ["ARAM_MysticPunch", "ARAM_Purist_Caster", "ARAM_BreadAndCheese"] };
  const EMPTY = { qRank: 1, wRank: 1, eRank: 5, rRank: 3, haste: 50, attackSpeed: 1.2, crit: 0, pellets: 4, targets: 1, castQ: false, castW: false, castR: false, maxMana: 0, regen5: -1, augments: ["ARAM_MysticPunch"] };

  // Settings. maxMana 0 and regen5 -1 mean "level-18 base". crit is a share (0-1), shown as a percentage.
  const OPTIONS = [
    { key: "attackSpeed", label: "Attack speed (stats panel, before Purist - Caster)", type: "number", step: 0.05, max: 2.5 },
    { key: "crit", label: "Critical strike chance (%)", type: "number", step: 5, max: 100, scale: 100 },
    { key: "pellets", label: "Pellets that hit per shot (4 at point blank)", type: "number", step: 1, max: 4 },
    { key: "targets", label: "Enemies each shot hits (each one triggers Mystic Punch)", aug: "ARAM_MysticPunch", type: "number", step: 1, max: 4 },
    { key: "castQ", label: "Cast End of the Line (Q) on cooldown too", type: "check" },
    { key: "castW", label: "Cast Smoke Screen (W) on cooldown too", type: "check" },
    { key: "castR", label: "Cast Collateral Damage (R) on cooldown too", type: "check" },
    { key: "maxMana", label: "Max Mana", type: "number", step: 10, max: 20000, def: () => Math.round(base.max) },
    { key: "regen5", label: "Mana regeneration per 5 seconds", type: "number", step: 1, max: 2000, def: () => Math.round(base.regen5 * 10) / 10 },
  ];

  const augByKey = (k) => data.augments.find((a) => a.key === k);
  let build = load() || structuredClone(EMPTY);

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "on") e.addEventListener("click", v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) e.append(k);
    return e;
  }

  function renderRanks() {
    const row = (key, letter, spell, top) => el("div", { class: "rank-row" },
      el("img", { src: spell.icon, alt: "" }),
      el("span", { class: "name" }, `${letter} · ${T(spell.name)}`),
      el("span", { class: "seg", role: "group", "aria-label": T("{name} rank", { name: T(spell.name) }) },
        ...Array.from({ length: top }, (_, i) => i + 1).map((n) => el("button", {
          type: "button", "aria-pressed": build[key] === n ? "true" : "false",
          on: () => { build[key] = n; update(); },
        }, String(n)))));
    $("ranks").replaceChildren(row("qRank", "Q", S.Q, 5), row("wRank", "W", S.W, 5), row("eRank", "E", S.E, 5), row("rRank", "R", S.R, 3));
  }

  function renderAugments() {
    $("aug-slots").replaceChildren(...Array.from({ length: MAX_AUGS }, (_, i) => {
      const a = augByKey(build.augments[i]);
      return a
        ? el("button", { class: "slot filled", title: T("Remove {name}", { name: a.name }), "aria-label": T("Remove {name}", { name: a.name }), on: () => toggleAug(a.key) }, el("img", { src: a.icon, alt: "" }))
        : el("button", { class: "slot", disabled: true, "aria-label": T("Empty slot") });
    }));
    $("aug-picker").replaceChildren(...data.augments.map((a) => {
      const on = build.augments.includes(a.key);
      return el("button", {
        class: on ? "pick on" : "pick", "aria-pressed": on ? "true" : "false",
        disabled: !on && build.augments.length >= MAX_AUGS, on: () => toggleAug(a.key),
      }, el("img", { src: a.icon, alt: "", loading: "lazy" }),
      el("span", {}, a.name, el("span", { class: "tier" }, T(a.tier)), el("span", { class: "desc" }, T(WHAT[a.key] || ""))));
    }));
  }

  function toggleAug(key) {
    if (build.augments.includes(key)) build.augments = build.augments.filter((k) => k !== key);
    else if (build.augments.length < MAX_AUGS) build.augments.push(key);
    update();
  }

  function renderOptions() {
    const shown = OPTIONS.filter((o) => !o.aug || build.augments.includes(o.aug));
    $("options").replaceChildren(...shown.map((o) => {
      const val = o.def && (build[o.key] == null || build[o.key] < 0 || (o.key === "maxMana" && !build[o.key])) ? o.def() : build[o.key];
      const input = o.type === "check"
        ? el("input", { type: "checkbox", checked: !!build[o.key] })
        : el("input", { type: "number", min: 0, max: o.max, step: o.step, value: Math.round((val ?? 0) * (o.scale || 1) * 100) / 100, inputmode: "decimal" });
      input.addEventListener("input", () => {
        build[o.key] = o.type === "check" ? input.checked : Math.max(0, Math.min(o.max, +input.value || 0)) / (o.scale || 1);
        update(false);
      });
      return el("label", {}, T(o.label), input);
    }));
  }

  function renderResult() {
    const r = GravesCalc.compute(data, build, { runs: 20 });
    const full = r.loop >= 0.9;
    $("per-minute").textContent = fmt(r.perMinute, 1);
    $("per-minute").classList.toggle("infinite", full);
    $("loop").textContent = pct(r.loop);
    const bar = $("gain-bar");
    bar.style.width = `${r.loop * 100}%`;
    bar.classList.toggle("full", full);

    const curve = GravesCalc.curve(data, build, { step: 20 });
    const need = GravesCalc.threshold(data, build);
    $("loop-note").textContent = full
      ? T("Infinite: Quickdraw replaces {pct} of Graves' reloads, {n} shots a minute, as long as the mana lasts.", { pct: pct(r.loop), n: fmt(r.perMinute, 0) })
      : need !== null
        ? T("Quickdraw replaces {pct} of Graves' reloads. The loop closes at about {h} Ability Haste.", { pct: pct(r.loop), h: fmt(need) })
        : T("Quickdraw replaces {pct} of Graves' reloads. Even 500 Ability Haste doesn't close the loop with these settings.", { pct: pct(r.loop) });

    // Ceiling: a dash and a shot every Quickdraw cast time.
    drawChart(curve, 60 / Math.max(0.05, S.E.castTime || 0.4));
    const m = r.withMana;
    const stats = [
      ["Shots per minute without Quickdraw", fmt(r.plainShotsPerMinute, 1)],
      ["Quickdraws / reloads per minute", T("{e} / {r}", { e: fmt(r.quickdrawsPerMinute, 1), r: fmt(r.reloadsPerMinute, 1) })],
      ["Haste to close the loop", need === null ? T("Over 500") : fmt(need)],
      ["Mana lasts", m.runsOut ? T("{s} s of nonstop casting", { s: fmt(m.lastsFor, 1) }) : T("The whole fight")],
      ["Shots per minute after that", fmt(m.perMinute, 1)],
      ["Quickdraw cooldown / reload", T("{e} / {r} s", { e: fmt(r.cooldowns.E, 2), r: fmt(r.reload, 2) })],
      ["Seconds off Quickdraw per shot", fmt(r.cutPerShot, 2)],
      ["Mana per Quickdraw", fmt(r.cost.E)],
    ];
    $("stats").replaceChildren(...stats.map(([k, v]) => el("div", {}, el("dt", {}, T(k)), el("dd", {}, v))));
    renderGrid(r);
  }

  function drawChart(curve, cap) {
    const svg = $("chart");
    const top = Math.max(cap * 1.1, ...curve.map((p) => p.perMinute)) || 1;
    const x = (h) => (h / 500) * 300;
    const y = (v) => 78 - (v / top) * 72;
    const line = curve.map((p, i) => `${i ? "L" : "M"}${x(p.haste).toFixed(1)},${y(p.perMinute).toFixed(1)}`).join("");
    const ns = "http://www.w3.org/2000/svg";
    const mk = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const now = Math.min(500, build.haste);
    svg.replaceChildren(
      mk("line", { class: "cap", x1: 0, x2: 300, y1: y(cap), y2: y(cap) }),
      mk("path", { class: "area", d: `${line}L300,80L0,80Z` }),
      mk("path", { class: "line", d: line }),
      mk("line", { class: "now", x1: x(now), x2: x(now), y1: 0, y2: 80 }),
    );
    svg.setAttribute("aria-label", T("Shots per minute from 0 to 500 Ability Haste: {a} at 0, {b} at 500", { a: fmt(curve[0].perMinute, 1), b: fmt(curve[curve.length - 1].perMinute, 1) }));
  }

  // Attack speed against Ability Haste: Purist - Caster trades one for the other.
  function renderGrid(current) {
    const speeds = [0.8, 1.2, 1.6, 2.0, 2.5];
    const hastes = [0, 50, 100, 150, 200];
    const head = el("tr", {}, el("th", {}, T("Attack speed")), ...hastes.map((h) => el("th", {}, T("{h} haste", { h }))));
    const rows = speeds.map((as) => el("tr", {}, el("td", {}, fmt(as, 2)), ...hastes.map((h) => {
      const on = Math.abs(build.attackSpeed - as) < 1e-9 && build.haste === h;
      const r = on ? current : GravesCalc.compute(data, { ...build, attackSpeed: as, haste: h }, { runs: 6, minutes: 3, mana: false });
      return el("td", {}, el("button", {
        type: "button", class: [on ? "on" : "", r.loop >= 0.9 ? "full" : ""].join(" ").trim() || undefined,
        "aria-label": T("{as} attack speed, {h} Ability Haste: {n} shots per minute", { as: fmt(as, 2), h, n: fmt(r.perMinute, 1) }),
        on: () => { build.attackSpeed = as; build.haste = h; update(); },
      }, fmt(r.perMinute, 0)));
    })));
    $("grid").replaceChildren(head, ...rows);
  }

  let timer = 0;
  function update(rerenderControls = true) {
    if (rerenderControls) { renderRanks(); renderAugments(); renderOptions(); }
    $("haste").value = Math.min(500, build.haste);
    if (document.activeElement !== $("haste-num")) $("haste-num").value = build.haste;
    save();
    clearTimeout(timer);
    timer = setTimeout(renderResult, rerenderControls ? 0 : 120);
  }

  // The build lives in the URL hash, so a link shares it.
  const FIELDS = ["qRank", "wRank", "eRank", "rRank", "haste", "attackSpeed", "crit", "pellets", "targets", "castQ", "castW", "castR", "maxMana", "regen5"];
  function save() {
    const h = [...FIELDS.map((k) => (typeof build[k] === "boolean" ? (build[k] ? 1 : 0) : build[k] ?? "")), build.augments.join(".")].join("~");
    try { history.replaceState(null, "", `#${h}`); } catch { /* embedded pages may not own the URL */ }
  }

  function load() {
    try {
      const p = decodeURIComponent(location.hash.slice(1)).split("~");
      if (p.length < FIELDS.length + 1) return null;
      const num = (v, lo, hi, def) => (isFinite(+v) && v !== "" ? Math.min(hi, Math.max(lo, +v)) : def);
      const b = structuredClone(EMPTY);
      const range = { qRank: [1, 5], wRank: [1, 5], eRank: [1, 5], rRank: [1, 3], haste: [0, 1000], attackSpeed: [0.2, 2.5], crit: [0, 1], pellets: [1, 4], targets: [1, 4], maxMana: [0, 20000], regen5: [-1, 2000] };
      FIELDS.forEach((k, i) => {
        if (typeof EMPTY[k] === "boolean") b[k] = p[i] === "1";
        else b[k] = num(p[i], range[k][0], range[k][1], EMPTY[k]);
      });
      b.augments = (p[FIELDS.length] ? p[FIELDS.length].split(".") : []).filter((k) => augByKey(k)).slice(0, MAX_AUGS);
      return b;
    } catch {
      return null;
    }
  }

  $("graves-icon").src = data.champion.icon;
  const [major, minor] = data.patch.split(".").map(Number);
  $("patch").textContent = T("Patch {patch}.", { patch: `${major >= 10 && major < 20 ? major + 10 : major}.${minor}` });
  $("haste").addEventListener("input", (e) => { build.haste = +e.target.value; update(false); });
  $("haste-num").addEventListener("input", (e) => { build.haste = Math.max(0, Math.min(1000, +e.target.value || 0)); update(false); });
  $("preset").addEventListener("click", () => { build = structuredClone(PRESET); update(); });
  $("reset").addEventListener("click", () => { build = structuredClone(EMPTY); update(); });
  $("share").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = T("Link copied"); }
    catch { e.target.textContent = T("Copy the address bar"); }
    setTimeout(() => (e.target.textContent = T("Copy link")), 1500);
  });
  update();
});
