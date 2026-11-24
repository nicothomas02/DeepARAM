LabI18n.ready(function () {
  "use strict";
  const data = window.ASHE_DATA;
  const T = LabI18n.t;
  for (const a of data.augments) a.name = LabI18n.name("augments", a.id, a.name);
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => (isFinite(n) ? LabI18n.num(n, { maximumFractionDigits: d }) : "∞");
  const pct = (n) => `${fmt(n * 100)}%`;
  const S = data.champion.spells;

  const MAX_AUGS = 4;
  // What each augment does to the loop, in one line.
  const WHAT = {
    ARAM_Archmage: "Each cast takes 30% of its base cooldown off another random ability. The loop.",
    UltimateAwakening: "30 Ultimate Haste. Each R (20 s cooldown) refills Hawkshot and gives 300 basic ability haste for 15 s.",
    UltimateRecursion: "50 Ultimate Haste.",
    ARAM_UltimateRevolution: "Your R comes back right after you cast it, once every 75 s.",
    ARAM_MysticPunch: "Each basic attack takes 1.25 s off every cooldown.",
    ARAM_BreadAndCheese: "Hawkshot gains 100 Ability Haste, so it recharges faster.",
    ARAM_Purist_Caster: "Cooldowns 10% shorter (its attack speed to haste is already in your panel).",
  };
  // Archmage, Ultimate Awakening, Ultimate Recursion and Mystic Punch at 150 haste and 1.5 attacks per second, with
  // Hawkshot at rank 1: its longer recharge gives R the biggest refund (README).
  const PRESET = {
    rRank: 3, eRank: 1, wRank: 5, haste: 150, ultHaste: 0, attackSpeed: 1.5, castW: false, onlyOnCooldown: true,
    augments: ["ARAM_Archmage", "UltimateAwakening", "UltimateRecursion", "ARAM_MysticPunch"],
  };
  const EMPTY = { rRank: 3, eRank: 5, wRank: 5, haste: 100, ultHaste: 0, attackSpeed: 1.5, castW: false, onlyOnCooldown: true, augments: ["ARAM_Archmage"] };

  // Settings, shown when they matter.
  const OPTIONS = [
    { key: "attackSpeed", label: "Attacks per second between casts", aug: "ARAM_MysticPunch", type: "number", step: 0.1, max: 3.5 },
    { key: "ultHaste", label: "Ultimate Haste from items", type: "number", step: 5, max: 200 },
    { key: "castW", label: "Cast Volley (W) on cooldown too", type: "check" },
    { key: "onlyOnCooldown", label: "Archmage only picks abilities on cooldown", aug: "ARAM_Archmage", type: "check" },
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
    const row = (key, spell, from, to) => el("div", { class: "rank-row" },
      el("img", { src: spell.icon, alt: "" }),
      el("span", { class: "name" }, `${key[0].toUpperCase()} · ${T(spell.name)}`),
      el("span", { class: "seg", role: "group", "aria-label": T("{name} rank", { name: T(spell.name) }) },
        ...Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => el("button", {
          type: "button", "aria-pressed": build[key] === n ? "true" : "false",
          on: () => { build[key] = n; update(); },
        }, String(n)))));
    $("ranks").replaceChildren(row("rRank", S.R, 1, 3), row("eRank", S.E, 1, 5), row("wRank", S.W, 0, 5));
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
      const input = o.type === "check"
        ? el("input", { type: "checkbox", checked: !!build[o.key] })
        : el("input", { type: "number", min: 0, max: o.max, step: o.step, value: build[o.key] ?? 0, inputmode: "decimal" });
      input.addEventListener("input", () => {
        build[o.key] = o.type === "check" ? input.checked : Math.max(0, Math.min(o.max, +input.value || 0));
        update(false);
      });
      return el("label", {}, T(o.label), input);
    }));
  }

  function renderResult() {
    const r = AsheCalc.compute(data, build);
    $("per-minute").textContent = fmt(r.perMinute, 1);
    $("per-minute").classList.toggle("infinite", r.loop >= 0.9);
    $("loop").textContent = pct(r.loop);
    const bar = $("gain-bar");
    bar.style.width = `${r.loop * 100}%`;
    bar.classList.toggle("full", r.loop >= 0.9);

    const curve = AsheCalc.curve(data, build, { step: 10, runs: 24 });
    const at500 = curve[curve.length - 1].perMinute;
    const need = AsheCalc.threshold(data, build, { runs: 24 });
    $("loop-note").textContent = !build.augments.includes("ARAM_Archmage")
      ? T("No loop without Archmage: R only comes back on its own cooldown.")
      : r.loop >= 0.9
        ? T("Infinite: R is back for every Hawkshot, about every {s} seconds.", { s: fmt(r.every, 1) })
        : need !== null
          ? T("R is back for {pct} of the Hawkshots you could cast. The loop closes at about {h} Ability Haste.", { pct: pct(r.loop), h: fmt(need) })
          : T("R is back for {pct} of the Hawkshots you could cast. Even 500 Ability Haste doesn't close the loop with these augments.", { pct: pct(r.loop) });

    drawChart(curve, r.maxPerMinute);
    const stats = [
      ["R in the first minute", fmt(r.firstMinute, 1)],
      ["Seconds per R", fmt(r.every, 1)],
      ["R at 500 Ability Haste", T("{n} per minute", { n: fmt(at500, 1) })],
      ["Haste to close the loop", need === null ? T("Over 500") : fmt(need)],
      ["R cooldown", T("{s} s", { s: fmt(r.cooldowns.R, 1) })],
      ["Hawkshot recharge", T("{s} s", { s: fmt(r.cooldowns.E, 1) })],
    ];
    if (r.refunds.fromE) {
      stats.push(["Each Hawkshot refunds", T("{s} s", { s: fmt(r.refunds.fromE, 1) })]);
      stats.push(["Each R refunds", T("{s} s", { s: fmt(r.refunds.fromR, 1) })]);
    }
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
    svg.setAttribute("aria-label", T("R casts per minute from 0 to 500 Ability Haste: {a} at 0, {b} at 500", { a: fmt(curve[0].perMinute, 1), b: fmt(curve[curve.length - 1].perMinute, 1) }));
  }

  function renderGrid(current) {
    const head = el("tr", {}, el("th", {}, T("Hawkshot (E) rank")), ...[1, 2, 3].map((n) => el("th", {}, T("R rank {n}", { n }))));
    const rows = [1, 2, 3, 4, 5].map((e) => el("tr", {}, el("td", {}, `E ${e}`), ...[1, 2, 3].map((rr) => {
      const on = build.eRank === e && build.rRank === rr;
      // The current build shows the same number as the result above.
      const r = on ? current : AsheCalc.compute(data, { ...build, eRank: e, rRank: rr }, { runs: 30 });
      return el("td", {}, el("button", {
        type: "button", class: [on ? "on" : "", r.loop >= 0.9 ? "full" : ""].join(" ").trim() || undefined,
        "aria-label": T("E rank {e}, R rank {r}: {n} R per minute", { e, r: rr, n: fmt(r.perMinute, 1) }),
        on: () => { build.eRank = e; build.rRank = rr; update(); },
      }, fmt(r.perMinute, 1)));
    })));
    $("grid").replaceChildren(head, ...rows);
  }

  let timer = 0;
  function update(rerenderControls = true) {
    if (rerenderControls) { renderRanks(); renderAugments(); renderOptions(); }
    $("haste").value = Math.min(500, build.haste);
    if (document.activeElement !== $("haste-num")) $("haste-num").value = build.haste;
    save();
    // The many simulated fights take a moment; wait until the slider stops.
    clearTimeout(timer);
    timer = setTimeout(renderResult, rerenderControls ? 0 : 60);
  }

  // The build lives in the URL hash, so a link shares it.
  function save() {
    const b = build;
    const h = [b.rRank, b.eRank, b.wRank, b.haste, b.ultHaste, b.attackSpeed, b.castW ? 1 : 0, b.onlyOnCooldown ? 1 : 0, b.augments.join(".")].join("~");
    try { history.replaceState(null, "", `#${h}`); } catch { /* embedded pages may not own the URL */ }
  }

  function load() {
    try {
      const p = decodeURIComponent(location.hash.slice(1)).split("~");
      if (p.length < 9) return null;
      const num = (v, lo, hi, def) => (isFinite(+v) && v !== "" ? Math.min(hi, Math.max(lo, +v)) : def);
      return {
        rRank: num(p[0], 1, 3, 3), eRank: num(p[1], 1, 5, 5), wRank: num(p[2], 0, 5, 5),
        haste: num(p[3], 0, 1000, 100), ultHaste: num(p[4], 0, 200, 0), attackSpeed: num(p[5], 0, 3.5, 1.5),
        castW: p[6] !== "0", onlyOnCooldown: p[7] === "1",
        augments: (p[8] ? p[8].split(".") : []).filter((k) => augByKey(k)).slice(0, MAX_AUGS),
      };
    } catch {
      return null;
    }
  }

  $("ashe-icon").src = data.champion.icon;
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
