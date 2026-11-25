LabI18n.ready(function () {
  "use strict";
  const data = window.KARMA_DATA;
  const T = LabI18n.t;
  for (const a of data.augments) a.name = LabI18n.name("augments", a.id, a.name);
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (isFinite(n) ? LabI18n.num(n, { maximumFractionDigits: d }) : "∞");
  const pct = (n) => `${fmt(n * 100)}%`;
  const S = data.champion.spells;
  const base = KarmaCalc.baseMana(data);

  const MAX_AUGS = 4;
  // What each augment does to the loop, in one line.
  const WHAT = {
    ARAM_Archmage: "Each cast takes 30% of its base cooldown off another random ability on cooldown, Mantra included.",
    UltimateAwakening: "Every Mantra resets Q, W and E and gives 300 basic haste for 15 seconds (20 second cooldown).",
    ARAM_UltimateRevolution: "Mantra comes straight back once after a cast (75 second cooldown).",
    UltimateRecursion: "Mantra gains 50 Ultimate Haste.",
    ARAM_MysticPunch: "Each on-hit takes 1.25 seconds off every cooldown. Needs Ethereal Weapon or basic attacks.",
    ARAM_EtherealWeapon: "Abilities apply on-hit, once per enemy every 1.5 seconds, so each hit can trigger Mystic Punch.",
    ARAM_BreadAndButter: "Inner Flame gains 100 Ability Haste.",
    ARAM_BreadAndJam: "Focused Resolve gains 100 Ability Haste.",
    ARAM_BreadAndCheese: "Inspire gains 100 Ability Haste.",
    ARAM_Purist_Caster: "Cooldowns 10% shorter (its attack speed to haste is already in your panel).",
  };
  const AUGS4 = ["ARAM_Archmage", "UltimateAwakening", "ARAM_MysticPunch", "ARAM_EtherealWeapon"];
  // Mystic Punch through Ethereal Weapon, Archmage and Ultimate Awakening, with Q hitting three enemies: every Q and W
  // empowered from about 80 Ability Haste (README).
  const PRESET = { qRank: 5, wRank: 1, eRank: 1, rRank: 4, haste: 100, ultHaste: 0, qTargets: 3, flareTargets: 3, tetherHolds: true, castE: false, attackSpeed: 0, maxMana: 0, regen5: -1, augments: AUGS4.slice() };
  const EMPTY = { qRank: 5, wRank: 1, eRank: 1, rRank: 4, haste: 100, ultHaste: 0, qTargets: 2, flareTargets: 2, tetherHolds: true, castE: false, attackSpeed: 0, maxMana: 0, regen5: -1, augments: ["ARAM_Archmage"] };

  // Settings. maxMana 0 and regen5 -1 mean "level-18 base".
  const OPTIONS = [
    { key: "qTargets", label: "Enemies hit by Inner Flame (Q)", type: "number", step: 1, max: 5 },
    { key: "flareTargets", label: "Enemies hit by Soulflare's second explosion", type: "number", step: 1, max: 5 },
    { key: "tetherHolds", label: "Focused Resolve's tether holds for 2 seconds (second hit)", type: "check" },
    { key: "ultHaste", label: "Ultimate Haste from items and runes", type: "number", step: 5, max: 300 },
    { key: "attackSpeed", label: "Attack speed (basic attacks also trigger Mystic Punch; 0 = none)", aug: "ARAM_MysticPunch", type: "number", step: 0.05, max: 2.5 },
    { key: "castE", label: "Cast Inspire (E) on cooldown too", type: "check" },
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
    $("ranks").replaceChildren(row("qRank", "Q", S.Q, 5), row("wRank", "W", S.W, 5), row("eRank", "E", S.E, 5), row("rRank", "R", S.R, 4));
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
        : el("input", { type: "number", min: 0, max: o.max, step: o.step, value: val ?? 0, inputmode: "decimal" });
      input.addEventListener("input", () => {
        build[o.key] = o.type === "check" ? input.checked : Math.max(0, Math.min(o.max, +input.value || 0));
        update(false);
      });
      return el("label", {}, T(o.label), input);
    }));
  }

  function renderResult() {
    const r = KarmaCalc.compute(data, build, { runs: 24 });
    const full = r.loop >= 0.9;
    $("per-minute").textContent = fmt(r.perMinute, 1);
    $("per-minute").classList.toggle("infinite", full);
    $("loop").textContent = pct(r.loop);
    const bar = $("gain-bar");
    bar.style.width = `${r.loop * 100}%`;
    bar.classList.toggle("full", full);

    const curve = KarmaCalc.curve(data, build, { step: 20 });
    const need = KarmaCalc.threshold(data, build);
    $("loop-note").textContent = full
      ? T("Infinite: Mantra is back for {pct} of Karma's Q and W casts, as long as the mana lasts.", { pct: pct(r.loop) })
      : need !== null
        ? T("Mantra empowers {pct} of Karma's Q and W casts. The loop closes at about {h} Ability Haste.", { pct: pct(r.loop), h: fmt(need) })
        : T("Mantra empowers {pct} of Karma's Q and W casts. Even 500 Ability Haste doesn't close the loop with these settings.", { pct: pct(r.loop) });

    // Ceiling: one empowered Q or W per cast time.
    drawChart(curve, 60 / Math.max(0.05, S.Q.castTime || 0.25));
    const m = r.withMana;
    const stats = [
      ["Soulflares (RQ) / Renewals (RW) per minute", T("{q} / {w}", { q: fmt(r.rqPerMinute, 1), w: fmt(r.rwPerMinute, 1) })],
      ["Haste to close the loop", need === null ? T("Over 500") : fmt(need)],
      ["Mana lasts", m.runsOut ? T("{s} s of nonstop casting", { s: fmt(m.lastsFor, 1) }) : T("The whole fight")],
      ["Empowered casts per minute after that", fmt(m.perMinute, 1)],
      ["Cooldowns Q / W / R", T("{q} / {w} / {r} s", { q: fmt(r.cooldowns.Q, 2), w: fmt(r.cooldowns.W, 2), r: fmt(r.cooldowns.R, 1) })],
      ["Gathering Fire per Q / RQ / W", T("{q} / {rq} / {w} s", { q: fmt(r.cutPerQ, 1), rq: fmt(r.cutPerRQ, 1), w: fmt(r.cutPerW, 1) })],
      ["Mana per Q and W", T("{q} + {w}", { q: fmt(r.cost.Q), w: fmt(r.cost.W) })],
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
    svg.setAttribute("aria-label", T("Empowered casts per minute from 0 to 500 Ability Haste: {a} at 0, {b} at 500", { a: fmt(curve[0].perMinute, 1), b: fmt(curve[curve.length - 1].perMinute, 1) }));
  }

  // Which ability to max: the three usual orders, each with the other two at rank 1.
  function renderGrid(current) {
    const orders = [["Q", { qRank: 5, wRank: 1, eRank: 1 }], ["W", { qRank: 1, wRank: 5, eRank: 1 }], ["E", { qRank: 1, wRank: 1, eRank: 5 }]];
    const targets = [1, 2, 3, 4, 5];
    const head = el("tr", {}, el("th", {}, T("Max first")), ...targets.map((n) => el("th", {}, T("{n} hit by Q", { n }))));
    const rows = orders.map(([k, ranks]) => el("tr", {}, el("td", {}, `${k} · ${T(S[k].name)}`), ...targets.map((n) => {
      const on = build.qRank === ranks.qRank && build.wRank === ranks.wRank && build.eRank === ranks.eRank && build.qTargets === n && build.flareTargets === n;
      const r = on ? current : KarmaCalc.compute(data, { ...build, ...ranks, qTargets: n, flareTargets: n }, { runs: 8, minutes: 3, mana: false });
      return el("td", {}, el("button", {
        type: "button", class: [on ? "on" : "", r.loop >= 0.9 ? "full" : ""].join(" ").trim() || undefined,
        "aria-label": T("Max {k}, {n} enemies hit: {v} empowered casts per minute", { k, n, v: fmt(r.perMinute, 1) }),
        on: () => { Object.assign(build, ranks, { qTargets: n, flareTargets: n }); update(); },
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
  const FIELDS = ["qRank", "wRank", "eRank", "rRank", "haste", "ultHaste", "qTargets", "flareTargets", "tetherHolds", "castE", "attackSpeed", "maxMana", "regen5"];
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
      const range = { qRank: [1, 5], wRank: [1, 5], eRank: [1, 5], rRank: [1, 4], haste: [0, 1000], ultHaste: [0, 300], qTargets: [0, 5], flareTargets: [0, 5], attackSpeed: [0, 2.5], maxMana: [0, 20000], regen5: [-1, 2000] };
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

  $("karma-icon").src = data.champion.icon;
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
