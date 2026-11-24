LabI18n.ready(function () {
  "use strict";
  const data = window.EZREAL_DATA;
  const T = LabI18n.t;
  for (const a of data.augments) a.name = LabI18n.name("augments", a.id, a.name);
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (isFinite(n) ? LabI18n.num(n, { maximumFractionDigits: d }) : "∞");
  const pct = (n) => `${fmt(n * 100)}%`;
  const S = data.champion.spells;
  const base = EzrealCalc.baseMana(data);

  const MAX_AUGS = 4;
  const DISTANCES = [400, 600, 800, 1000, 1200];
  // What each augment does to the loop, in one line.
  const WHAT = {
    ARAM_SkilledSniper: "A hit from 600+ units takes 80% of Q's full cooldown off. With Q's own 1.5 s, Q is back as it lands.",
    ARAM_Archmage: "Each cast takes 30% of its base cooldown off another random ability on cooldown.",
    ARAM_MysticPunch: "Each on-hit takes 1.25 s off every cooldown. Mystic Shot applies on-hit effects.",
    ARAM_BreadAndButter: "Mystic Shot gains 100 Ability Haste.",
    ARAM_Purist_Caster: "Cooldowns 10% shorter (its attack speed to haste is already in your panel).",
  };
  // Skilled Sniper from 1,000 units: Q is back the moment each shot lands, at any haste (README).
  const PRESET = { qRank: 5, haste: 0, distance: 1000, castW: false, othersOnCooldown: false, punchOnQ: true, maxMana: 0, regen5: -1, augments: ["ARAM_SkilledSniper"] };
  const EMPTY = { qRank: 5, haste: 100, distance: 1000, castW: false, othersOnCooldown: false, punchOnQ: true, maxMana: 0, regen5: -1, augments: [] };

  // Settings. maxMana 0 and regen5 -1 mean "level-18 base".
  const OPTIONS = [
    { key: "maxMana", label: "Max Mana", type: "number", step: 10, max: 20000, def: () => Math.round(base.max) },
    { key: "regen5", label: "Mana regeneration per 5 seconds", type: "number", step: 1, max: 2000, def: () => Math.round(base.regen5 * 10) / 10 },
    { key: "castW", label: "Cast Essence Flux (W) on cooldown too (its mark gives mana back)", type: "check" },
    { key: "othersOnCooldown", label: "Arcane Shift (E) and Trueshot Barrage (R) are on cooldown", aug: "ARAM_Archmage", type: "check" },
    { key: "punchOnQ", label: "Mystic Shot hits trigger Mystic Punch (not confirmed in game)", aug: "ARAM_MysticPunch", type: "check" },
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
    $("ranks").replaceChildren(el("div", { class: "rank-row" },
      el("img", { src: S.Q.icon, alt: "" }),
      el("span", { class: "name" }, `Q · ${T(S.Q.name)}`),
      el("span", { class: "seg", role: "group", "aria-label": T("{name} rank", { name: T(S.Q.name) }) },
        ...[1, 2, 3, 4, 5].map((n) => el("button", {
          type: "button", "aria-pressed": build.qRank === n ? "true" : "false",
          on: () => { build.qRank = n; update(); },
        }, String(n))))));
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
    const r = EzrealCalc.compute(data, build);
    const full = r.loop >= 0.9;
    $("per-minute").textContent = fmt(r.perMinute, 1);
    $("per-minute").classList.toggle("infinite", full);
    $("loop").textContent = pct(r.loop);
    const bar = $("gain-bar");
    bar.style.width = `${r.loop * 100}%`;
    bar.classList.toggle("full", full);

    const curve = EzrealCalc.curve(data, build, { step: 10 });
    const need = EzrealCalc.threshold(data, build);
    $("loop-note").textContent = full
      ? (r.sniper
        ? T("Infinite: Skilled Sniper brings Q back the moment each shot lands, a Mystic Shot every {s} seconds, as long as the mana lasts.", { s: fmt(r.every, 2) })
        : T("Infinite: Q is back the moment each shot lands, a Mystic Shot every {s} seconds, as long as the mana lasts.", { s: fmt(r.every, 2) }))
      : need !== null
        ? T("Q is back as it lands for {pct} of the shots it could fire. The loop closes at about {h} Ability Haste.", { pct: pct(r.loop), h: fmt(need) })
        : T("Q is back as it lands for {pct} of the shots it could fire. Even 500 Ability Haste doesn't close the loop with these settings.", { pct: pct(r.loop) });

    drawChart(curve, r.maxPerMinute);
    const m = r.withMana;
    const stats = [
      ["Haste to close the loop", need === null ? T("Over 500") : fmt(need)],
      ["Flight time", T("{s} s", { s: fmt(r.flight, 2) })],
      ["Mana lasts", m.runsOut ? T("{s} s of nonstop casting", { s: fmt(m.lastsFor, 1) }) : T("The whole fight")],
      ["Mystic Shots per minute after that", fmt(m.perMinute, 1)],
      ["Q cooldown", T("{s} s", { s: fmt(r.cooldowns.Q, 2) })],
      ["Mana per Q", fmt(r.cost.Q)],
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
    svg.setAttribute("aria-label", T("Mystic Shots per minute from 0 to 500 Ability Haste: {a} at 0, {b} at 500", { a: fmt(curve[0].perMinute, 1), b: fmt(curve[curve.length - 1].perMinute, 1) }));
  }

  function renderGrid(current) {
    const head = el("tr", {}, el("th", {}, T("Mystic Shot (Q) rank")), ...DISTANCES.map((d) => el("th", {}, T("{n} units", { n: fmt(d) }))));
    const rows = [1, 2, 3, 4, 5].map((q) => el("tr", {}, el("td", {}, `Q ${q}`), ...DISTANCES.map((d) => {
      const on = build.qRank === q && build.distance === d;
      const r = on ? current : EzrealCalc.compute(data, { ...build, qRank: q, distance: d }, { runs: 10, mana: false });
      return el("td", {}, el("button", {
        type: "button", class: [on ? "on" : "", r.loop >= 0.9 ? "full" : ""].join(" ").trim() || undefined,
        "aria-label": T("Q rank {q}, {d} units: {n} Mystic Shots per minute", { q, d: fmt(d), n: fmt(r.perMinute, 1) }),
        on: () => { build.qRank = q; build.distance = d; update(); },
      }, fmt(r.perMinute, 1)));
    })));
    $("grid").replaceChildren(head, ...rows);
  }

  let timer = 0;
  function update(rerenderControls = true) {
    if (rerenderControls) { renderRanks(); renderAugments(); renderOptions(); }
    $("haste").value = Math.min(500, build.haste);
    if (document.activeElement !== $("haste-num")) $("haste-num").value = build.haste;
    $("distance").value = build.distance;
    $("distance-out").textContent = fmt(build.distance);
    save();
    clearTimeout(timer);
    timer = setTimeout(renderResult, rerenderControls ? 0 : 60);
  }

  // The build lives in the URL hash, so a link shares it.
  function save() {
    const b = build;
    const h = [b.qRank, b.haste, b.distance, b.castW ? 1 : 0, b.othersOnCooldown ? 1 : 0, b.punchOnQ ? 1 : 0, b.maxMana || 0, b.regen5 ?? -1, b.augments.join(".")].join("~");
    try { history.replaceState(null, "", `#${h}`); } catch { /* embedded pages may not own the URL */ }
  }

  function load() {
    try {
      const p = decodeURIComponent(location.hash.slice(1)).split("~");
      if (p.length < 9) return null;
      const num = (v, lo, hi, def) => (isFinite(+v) && v !== "" ? Math.min(hi, Math.max(lo, +v)) : def);
      return {
        qRank: num(p[0], 1, 5, 5), haste: num(p[1], 0, 1000, 100), distance: num(p[2], 100, 1200, 1000),
        castW: p[3] === "1", othersOnCooldown: p[4] === "1", punchOnQ: p[5] !== "0",
        maxMana: num(p[6], 0, 20000, 0), regen5: num(p[7], -1, 2000, -1),
        augments: (p[8] ? p[8].split(".") : []).filter((k) => augByKey(k)).slice(0, MAX_AUGS),
      };
    } catch {
      return null;
    }
  }

  $("ezreal-icon").src = data.champion.icon;
  const [major, minor] = data.patch.split(".").map(Number);
  $("patch").textContent = T("Patch {patch}.", { patch: `${major >= 10 && major < 20 ? major + 10 : major}.${minor}` });
  $("haste").addEventListener("input", (e) => { build.haste = +e.target.value; update(false); });
  $("haste-num").addEventListener("input", (e) => { build.haste = Math.max(0, Math.min(1000, +e.target.value || 0)); update(false); });
  $("distance").addEventListener("input", (e) => { build.distance = +e.target.value; update(false); });
  $("preset").addEventListener("click", () => { build = structuredClone(PRESET); update(); });
  $("reset").addEventListener("click", () => { build = structuredClone(EMPTY); update(); });
  $("share").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = T("Link copied"); }
    catch { e.target.textContent = T("Copy the address bar"); }
    setTimeout(() => (e.target.textContent = T("Copy link")), 1500);
  });
  update();
});
