LabI18n.ready(function () {
  "use strict";
  const data = window.RYZE_DATA;
  const T = LabI18n.t;
  // Official item and augment names in the visitor's language; their long tooltips stay English where untranslated.
  for (const it of data.items) it.name = LabI18n.name("items", it.id, it.name);
  for (const a of data.augments) a.name = LabI18n.name("augments", a.id, a.name);
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (isFinite(n) ? LabI18n.num(n, { maximumFractionDigits: d }) : "∞");
  const pct = (n, d = 0) => (isFinite(n) ? `${fmt(n * 100, d)}%` : "∞");

  const MAX_ITEMS = 6, MAX_AUGS = 4;
  const WOOGLET_ITEM = 228002, WOOGLET_QUEST = "ARAM_Quest_WoogletsWitchcap";
  // Highest level-18 AP found by trying every combination of the loop items and augments (see README).
  const PRESET = {
    level: 18,
    items: [3040, 228002, 6657, 2503, 4633, 3121],
    augments: ["ARAM_Goliath", "ARAM_MadScientist", "ARAM_MindtoMatter", WOOGLET_QUEST],
    opts: {}, extra: {},
  };

  // Stack / toggle controls, shown only when their item or augment is picked.
  const OPTIONS = [
    { key: "rodStacks", label: "Rod of Ages stacks", item: 6657, type: "number", def: 10, max: 10 },
    { key: "glory", label: "Mejai's Glory", item: 3041, type: "number", def: 25, max: 25 },
    { key: "blackfireTargets", label: "Enemies burning (Blackfire)", item: 2503, type: "number", def: 3, max: 7 },
    { key: "actualizerOn", label: "Actualizer active", item: 2522, type: "check", def: false },
    { key: "madLarge", label: "Mad Scientist: large form", aug: "ARAM_MadScientist", type: "check", def: true },
    { key: "evilStacks", label: "Phenomenal Evil stacks", aug: "ARAM_PhenomenalEvil", type: "number", def: 100 },
    { key: "evilSecond", label: "Phenomenal Evil as 2nd augment", aug: "ARAM_PhenomenalEvil", type: "check", def: false },
    { key: "dualityStacks", label: "Master of Duality stacks", aug: "ARAM_MasterofDuality", type: "number", def: 5 },
    { key: "slapStacks", label: "Slap Around stacks", aug: "ARAM_SlapAround", type: "number", def: 10 },
    { key: "shielded", label: "Mighty Shield: shielded", aug: "MightyShield", type: "check", def: true },
    { key: "juggernaut", label: "Titan's Resolve: max stacks", aug: "ARAM_ImTheJuggernaut", type: "check", def: true },
  ];
  const EXTRAS = [
    { key: "ap", label: "Extra AP (stat anvils, etc.)" },
    { key: "mana", label: "Extra Mana" },
    { key: "hp", label: "Extra Health" },
  ];


  const itemById = (id) => data.items.find((i) => i.id === id);
  const augByKey = (k) => data.augments.find((a) => a.key === k);
  let build = load() || { level: 18, items: [3040], augments: [], opts: {}, extra: {} };

  function canAddItem(it) {
    if (build.items.length >= MAX_ITEMS) return false;
    if (it.id === WOOGLET_ITEM && !build.augments.includes(WOOGLET_QUEST)) return false;
    const owned = build.items.map(itemById);
    if (owned.some((o) => o.id === it.id) && it.price >= 1500) return false; // legendaries are one each
    return !owned.some((o) => o.limitGroups.some((g) => it.limitGroups.includes(g)));
  }

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "on") e.addEventListener("click", v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) e.append(k);
    return e;
  }

  function renderPickers() {
    const slots = (list, max, toThing, remove) => {
      const out = [];
      for (let i = 0; i < max; i++) {
        const t = list[i] !== undefined ? toThing(list[i]) : null;
        out.push(t
          ? el("button", { class: "slot filled", title: T("Remove {name}", { name: t.name }), "aria-label": T("Remove {name}", { name: t.name }), on: () => remove(i) }, el("img", { src: t.icon, alt: "" }))
          : el("button", { class: "slot", disabled: true, "aria-label": T("Empty slot") }));
      }
      return out;
    };
    $("item-slots").replaceChildren(...slots(build.items, MAX_ITEMS, itemById, (i) => { build.items.splice(i, 1); update(); }));
    $("aug-slots").replaceChildren(...slots(build.augments, MAX_AUGS, augByKey, (i) => removeAug(build.augments[i])));
    $("aug-slots").classList.add("augs");

    $("item-picker").replaceChildren(...data.items.map((it) => el("button", {
      class: build.items.includes(it.id) ? "pick on" : "pick", title: T(it.text), disabled: !canAddItem(it),
      on: () => { if (canAddItem(it)) { build.items.push(it.id); update(); } },
    }, el("img", { src: it.icon, alt: "", loading: "lazy" }), el("span", {}, it.name, el("span", { class: "tier" }, statLine(it))))));

    $("aug-picker").classList.add("augs");
    $("aug-picker").replaceChildren(...data.augments.map((a) => {
      const on = build.augments.includes(a.key);
      return el("button", {
        class: on ? "pick on" : "pick", title: T(a.text), "aria-pressed": on ? "true" : "false",
        disabled: !on && build.augments.length >= MAX_AUGS,
        on: () => (on ? removeAug(a.key) : addAug(a.key)),
      }, el("img", { src: a.icon, alt: "", loading: "lazy" }), el("span", {}, a.name, el("span", { class: "tier" }, T(a.tier))));
    }));
  }

  function statLine(it) {
    const parts = [];
    if (it.ap) parts.push(T("{n} AP", { n: it.ap }));
    if (it.mana) parts.push(T("{n} Mana", { n: it.mana }));
    if (it.hp) parts.push(T("{n} HP", { n: it.hp }));
    return parts.join(" · ") || T("Component");
  }

  function addAug(key) {
    if (build.augments.length >= MAX_AUGS) return;
    build.augments.push(key);
    if (key === WOOGLET_QUEST) {
      // The quest hands out Wooglet's in place of Rabadon's and Zhonya's.
      build.items = build.items.filter((id) => id !== 3089 && id !== 3157);
      if (build.items.length < MAX_ITEMS) build.items.push(WOOGLET_ITEM);
    }
    update();
  }

  function removeAug(key) {
    build.augments = build.augments.filter((k) => k !== key);
    if (key === WOOGLET_QUEST) build.items = build.items.filter((id) => id !== WOOGLET_ITEM);
    update();
  }

  function renderOptions() {
    const shown = OPTIONS.filter((o) => (o.item && build.items.includes(o.item)) || (o.aug && build.augments.includes(o.aug)));
    const rows = shown.map((o) => {
      const val = build.opts[o.key] ?? o.def;
      const input = o.type === "check"
        ? el("input", { type: "checkbox", checked: !!val })
        : el("input", { type: "number", min: 0, max: o.max, step: 1, value: val, inputmode: "numeric" });
      input.addEventListener("input", () => {
        build.opts[o.key] = o.type === "check" ? input.checked : Math.max(0, Math.min(o.max ?? 1e6, +input.value || 0));
        update(false);
      });
      return el("label", {}, T(o.label), input);
    });
    for (const x of EXTRAS) {
      const input = el("input", { type: "number", min: 0, step: 10, value: build.extra[x.key] || 0, inputmode: "numeric" });
      input.addEventListener("input", () => { build.extra[x.key] = Math.max(0, +input.value || 0); update(false); });
      rows.push(el("label", {}, T(x.label), input));
    }
    $("options").replaceChildren(...rows);
  }

  function renderResult(r) {
    const apEl = $("ap");
    apEl.textContent = fmt(r.finalAP);
    apEl.classList.toggle("infinite", r.infinite);

    $("gain").textContent = pct(r.loopGain, 1);
    const bar = $("gain-bar");
    bar.style.width = `${Math.min(100, r.loopGain * 100)}%`;
    bar.classList.toggle("full", r.infinite);
    const need = r.manaForInfinite - r.currentManaPool;
    $("gain-note").textContent = r.infinite
      ? T("Infinite: every loop gives back more AP than it started with.")
      : r.loopGain === 0
        ? T("No loop yet. Seraph's Embrace, or Riftmaker with Mind to Matter or Fimbulwinter, turns Mana back into AP.")
        : T("Each loop gives back {pct} of the AP that went in. About {mana} more base Mana would make it infinite.", { pct: pct(r.loopGain, 1), mana: fmt(need) });

    drawChart(r);

    const stats = [
      ["Max Mana", fmt(r.maxMana)], ["Bonus Mana", fmt(r.bonusMana)], ["Max Health", fmt(r.maxHP)],
      ["Passive Mana bonus", pct(r.passivePct)], ["AP multiplier", `×${fmt(1 + r.amp, 2)}`],
      ["AP before the loop", fmt(r.start)],
    ];
    if (r.overflow) stats.push(["Overflow bonus", pct(r.overflow)]);
    if (r.actualizer) stats.push(["Actualizer bonus", pct(r.actualizer)]);
    $("stats").replaceChildren(...stats.map(([k, v]) => el("div", {}, el("dt", {}, T(k)), el("dd", {}, v))));

    const S = data.champion.spells;
    $("spells").replaceChildren(
      el("tr", {}, el("th", {}, T("Ability")), el("th", {}, T("Scaling")), el("th", {}, T("Damage"))),
      ...[["Q", "Overload"], ["W", "Rune Prison"], ["E", "Spell Flux"]].map(([k, n]) => el("tr", {},
        el("td", {}, `${k} · ${T(n)}`),
        el("td", { class: "muted" }, T("{base} + {ap}% AP + {mana}% bonus Mana", { base: S[k].base[4], ap: fmt(S[k].apRatio * 100), mana: fmt(S[k].bonusManaRatio * 100) })),
        el("td", {}, fmt(r.spells[k])))));

    const rows = r.sources.map((s) => el("tr", {}, el("td", {}, s.label),
      el("td", {}, s.kind === "amp" ? `+${pct(s.value)} AP` : `+${fmt(s.value)} AP`)));
    if (r.awe) rows.push(el("tr", {}, el("td", {}, T("Awe ({pct} of bonus Mana), after multipliers", { pct: pct(r.awe) })), el("td", {}, `+${fmt(r.aweAP)} AP`)));
    if (r.riftRatio && r.bonusHP) rows.push(el("tr", {}, el("td", {}, T("{name} ({pct} of bonus Health), after multipliers", { name: LabI18n.name("items", 4633, "Riftmaker"), pct: pct(r.riftRatio) })), el("td", {}, `+${fmt(r.riftAP)} AP`)));
    $("breakdown").replaceChildren(el("tr", {}, el("th", {}, T("Source")), el("th", {}, "AP")), ...rows);
  }

  function drawChart(r) {
    const svg = $("chart");
    const pts = r.rounds.slice(0, 25);
    const cap = r.infinite ? Math.max(...pts.filter(isFinite)) : r.finalAP;
    if (!cap) { svg.replaceChildren(); return; }
    const x = (i) => (i / (pts.length - 1)) * 300;
    const y = (v) => 78 - (Math.min(v, cap) / cap) * 72;
    const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const ns = "http://www.w3.org/2000/svg";
    const mk = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
    svg.replaceChildren(
      mk("line", { class: "cap", x1: 0, x2: 300, y1: y(cap), y2: y(cap) }),
      mk("path", { class: "area", d: `${line}L300,80L0,80Z` }),
      mk("path", { class: "line", d: line }),
    );
    svg.setAttribute("aria-label", T("AP after each of {n} loops, settling at {ap}", { n: pts.length - 1, ap: fmt(r.finalAP) }));
  }

  function update(rerenderControls = true) {
    if (rerenderControls) { renderPickers(); renderOptions(); }
    $("level-out").textContent = build.level;
    $("level").value = build.level;
    renderResult(RyzeCalc.compute(data, build));
    save();
  }

  // The build lives in the URL hash, so a link shares it.
  function save() {
    const h = [build.level, build.items.join("."), build.augments.join("."),
      encodeURIComponent(JSON.stringify({ o: build.opts, x: build.extra }))].join("~");
    try { history.replaceState(null, "", `#${h}`); } catch { /* embedded pages may not own the URL */ }
  }

  function load() {
    try {
      const [lvl, items, augs, rest] = decodeURIComponent(location.hash.slice(1)).split("~");
      if (!lvl) return null;
      const { o, x } = rest ? JSON.parse(rest) : {};
      return {
        level: Math.min(18, Math.max(1, +lvl || 18)),
        items: (items ? items.split(".").map(Number) : []).filter((id) => itemById(id)).slice(0, MAX_ITEMS),
        augments: (augs ? augs.split(".") : []).filter((k) => augByKey(k)).slice(0, MAX_AUGS),
        opts: o || {}, extra: x || {},
      };
    } catch {
      return null;
    }
  }

  $("ryze-icon").src = data.champion.icon;
  $("patch").textContent = T("Patch {patch}.", { patch: data.patch.split(".").slice(0, 2).join(".") });
  $("level").addEventListener("input", (e) => { build.level = +e.target.value; update(false); });
  $("preset").addEventListener("click", () => { build = structuredClone(PRESET); update(); });
  $("reset").addEventListener("click", () => { build = { level: 18, items: [], augments: [], opts: {}, extra: {} }; update(); });
  $("share").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = T("Link copied"); }
    catch { e.target.textContent = T("Copy the address bar"); }
    setTimeout(() => (e.target.textContent = T("Copy link")), 1500);
  });
  update();
});
