// The list is the default view; #Alias opens one champion's page.
I18N.ready.then(() => {
  const D = window.CHAMPS_DATA;
  // crowd control labels for the abilities
  const CC = { stun: "Stun", root: "Root", slow: "Slow", knockup: "Knock-up", knockback: "Knockback", pull: "Pull",
    silence: "Silence", fear: "Fear", taunt: "Taunt", suppression: "Suppression", polymorph: "Polymorph", blind: "Blind" };
  const { t } = I18N;
  localize(D, I18N.data);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const num = (n, d = 2) => I18N.num(n, d);
  const pct = (x, d = 1) => `${num(x * 100, d)}%`;
  const img = (src, cls = "icon", alt = "") => (src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : "");
  const words = (n) => t(n.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/_/g, " "));
  const ROLE = { assassin: "Assassin", fighter: "Fighter", mage: "Mage", marksman: "Marksman", support: "Support", tank: "Tank" };
  const byAlias = Object.fromEntries(D.champions.map((c) => [c.alias.toLowerCase(), c]));

  const patch = D.patch.split(".").slice(0, 2).join(".");
  $("patch").textContent = t("Patch {v}", { v: patch });
  const changed = D.champions.filter((c) => c.mayhem.length).length;
  $("list-intro").textContent =
    t("{n} champions. {changed} of them have abilities that Mayhem changes.", { n: D.champions.length, changed }) + " " +
    t("Pick one to see its Mayhem builds by style, augments, skill order, best teammates and ability changes.");

  // ---- List
  const filters = [["all", "All"], ["changed", "Mayhem changes"], ...Object.entries(ROLE)];
  let filter = "all";
  $("filters").innerHTML = filters.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${k === filter}">${esc(t(l))}</button>`).join("");
  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    for (const x of $("filters").children) x.setAttribute("aria-pressed", String(x === b));
    renderList();
  });
  $("search").addEventListener("input", renderList);

  function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const shown = D.champions.filter((c) =>
      (!q || c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "changed" ? c.mayhem.length : c.roles.includes(filter))));
    $("roster").innerHTML = shown
      .map((c) => `<a class="champ" href="#${esc(c.alias)}">${img(c.icon)}<div><div class="title">${esc(c.name)}</div>
        <div class="chips">${c.tier ? `<span class="chip">#${c.tier.rank}</span>` : ""}${c.mayhem.length ? `<span class="chip tier-gold">${esc(t(c.mayhem.length > 1 ? "{n} changes" : "{n} change", { n: c.mayhem.length }))}</span>` : ""}</div></div></a>`)
      .join("");
    $("empty").hidden = shown.length > 0;
  }

  // ---- One champion
  // Ratios and percentages are stored as fractions (0.6 = 60%). Match whole words: "Duration" contains "ratio".
  const PCT_WORDS = new Set(["ratio", "percent", "pct", "amp", "mod", "multiplier"]);
  const isPct = (name, vals) => words(name).toLowerCase().split(/\s+/).some((w) => PCT_WORDS.has(w)) && vals.every((v) => Math.abs(v) <= 5);
  function values(name, vals) {
    const f = (v) => (isPct(name, vals) ? pct(v, Math.abs(v) < 0.01 ? 3 : 1) : num(v));
    const uniq = [...new Set(vals)];
    return uniq.length === 1 ? f(uniq[0]) : vals.map(f).join(" / ");
  }
  // Win rates: green at 52% or more, red at 48% or less
  const wr = (x, d = 1) => `<span class="${x >= 0.52 ? "wr-high" : x <= 0.48 ? "wr-low" : ""}">${pct(x, d)}</span>`;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const itemImg = (id) => {
    const it = D.items[id];
    return it ? `<img src="${esc(it.icon)}" alt="${esc(it.name)}" title="${esc(it.name)}" loading="lazy">` : "";
  };

  // Base stats at level 1 and 18. Growth per level follows the game's curve, so 17 levels add 17 times the growth.
  const STATS = [["hp", "Health"], ["hp5", "Health regen (per 5s)"], ["resource"], ["ad", "Attack damage"], ["as", "Attack speed"],
    ["armor", "Armor"], ["mr", "Magic resist"]];
  function statsCard(s) {
    if (!s) return "";
    const rows = [];
    for (const [k, label] of STATS) {
      if (k === "resource") {
        if (s.resource) {
          const r = s.resource;
          rows.push([t(r.kind), r.base[0], r.base[1], r.base[0] + 17 * r.base[1]]);
          rows.push([t(`${r.kind} regen (per 5s)`), r.regen[0], r.regen[1], r.regen[0] + 17 * r.regen[1]]);
        }
        continue;
      }
      const [base, per] = s[k];
      if (k === "as") rows.push([t(label), base, `${num(per, 2)}%`, base * (1 + (17 * per) / 100), 3]);
      else rows.push([t(label), base, per, base + 17 * per]);
    }
    rows.push([t("Attack range"), s.range, "", s.range], [t("Move speed"), s.ms, "", s.ms]);
    const cell = (v, d) => (typeof v === "number" ? num(v, d) : esc(v));
    return `<div class="card"><div class="card-head"><h2>${esc(t("Base stats"))}</h2><span class="muted small">${esc(t("Before items, augments and Mayhem's bonuses"))}</span></div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(t("Base stats"))}"><table class="stats"><thead><tr><th>${esc(t("Stat"))}</th><th class="num">${esc(t("Level {n}", { n: 1 }))}</th><th class="num">${esc(t("Per level"))}</th><th class="num">${esc(t("Level {n}", { n: 18 }))}</th></tr></thead>
      <tbody>${rows.map(([l, a, b, z, d = 1]) => `<tr><td>${esc(l)}</td><td class="num">${cell(a, 3)}</td><td class="num">${b === "" ? "–" : cell(b, 3)}</td><td class="num"><b>${cell(z, d)}</b></td></tr>`).join("")}</tbody></table></div></div>`;
  }

  // Mayhem's per-champion adjustments live in modifiers.js, loaded once
  const MOD_NAMES = { damage_dealt: "Damage dealt", damage_taken: "Damage taken", healing: "Healing done", shielding: "Shielding done",
    tenacity: "Tenacity", ability_haste: "Ability haste", attack_speed: "Total attack speed", energy_regen: "Energy regen" };
  function loadMods(c) {
    const show = () => {
      const el = $("mods");
      if (!el) return;
      const m = (window.CHAMPS_MODIFIERS || {})[c.alias] || {};
      const keys = Object.keys(m);
      // taking more damage is bad for the champion; everything else is good when it goes up
      const good = (k, v) => (k === "damage_taken" ? v < 0 : v > 0);
      el.innerHTML = keys.length
        ? `<p class="muted small" style="margin:0.75rem 0 0.5rem">${esc(t("Mode-wide adjustments for {name}:", { name: c.name }))}</p><div class="chips">${keys
            .map((k) => { const v = m[k], n = k === "ability_haste" ? num(v) : `${num(v * 100)}%`;
              return `<span class="chip ${good(k, m[k]) ? "mod-up" : "mod-down"}">${esc(t(MOD_NAMES[k] || k))} ${v > 0 ? "+" : ""}${n}</span>`; })
            .join("")}</div>`
        : `<p class="note">${esc(t("No mode-wide damage, healing or shielding adjustments for {name}.", { name: c.name }))}</p>`;
    };
    if (window.CHAMPS_MODIFIERS) return show();
    const sc = document.createElement("script");
    sc.src = "modifiers.js";
    sc.onload = show;
    document.head.appendChild(sc);
  }

  // Home region and official difficulty, from profile.js
  function loadProfile(c) {
    const show = () => {
      const el = $("profile"), p = (window.CHAMPS_PROFILE || {})[c.alias];
      if (el && p) el.textContent = [p.region && t(p.region), p.difficulty && t("Difficulty: {level}", { level: t(p.difficulty) })].filter(Boolean).join(" · ");
    };
    if (window.CHAMPS_PROFILE) return show();
    const sc = document.createElement("script");
    sc.src = "profile.js";
    sc.onload = show;
    document.head.appendChild(sc);
  }

  function renderPage(c) {
    const ab = Object.fromEntries(c.abilities.map((a) => [a.slot, a]));
    const facts = c.tier
      ? [["Tier List rank", esc(t("#{rank} of {of}", { rank: c.tier.rank, of: c.tier.of }))], ["Win rate", wr(c.tier.winRate)], ["Pick rate", pct(c.tier.pickRate)],
         ["Damage share", pct(c.tier.damage)], ["Damage taken share", pct(c.tier.tank)]]
      : [];
    const changes = c.mayhem.length
      ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(t("Mayhem changes"))}"><table class="changes">
          <thead><tr><th>${esc(t("Ability"))}</th><th>${esc(t("Value"))}</th><th class="num">${esc(t("Rift"))}</th><th class="num">${esc(t("Mayhem"))}</th></tr></thead>
          <tbody>${c.mayhem.map((m) => {
            const a = ab[m.slot] || {};
            const up = avg(m.mayhem) > avg(m.rift);
            const helps = /cooldown|cost/i.test(m.name) ? !up : up;
            return `<tr><td><div class="row">${img(a.icon, "icon")}<div><span class="slot">${m.slot}</span> <span class="ability-name">${esc(a.name || "")}</span></div></div></td>
              <td>${esc(words(m.name))}</td><td class="num" data-label="${esc(t("Rift"))}">${values(m.name, m.rift)}</td>
              <td class="num" data-label="${esc(t("Mayhem"))}"><b>${values(m.name, m.mayhem)}</b> <span class="${helps ? "up" : "down"}">${up ? "▲" : "▼"}</span></td></tr>`;
          }).join("")}</tbody></table></div>
          <p class="muted small">${esc(t("Ranks run left to right."))}</p>`
      : `<p class="muted">${esc(t("Mayhem doesn't change any of {name}'s ability numbers.", { name: c.name }))}</p>`;
    const B = c.builds;
    const rate = (r) => `<span class="rates"><span>${t("{rate} win", { rate: `<b>${wr(r.win)}</b>` })}</span><span>${esc(t("{rate} pick", { rate: pct(r.pick) }))}</span></span>`;
    const itemRow = (r, sep = "") => `<div class="build-row"><div class="items">${r.items.map(itemImg).join(sep)}</div>${rate(r)}</div>`;
    const block = (title, rows, sep, hint = "") => (rows && rows.length
      ? `<div class="card"><div class="card-head"><h2>${esc(t(title))}</h2>${hint ? `<span class="muted small">${esc(t(hint))}</span>` : ""}</div>
          <div class="build-list">${rows.map((r) => itemRow(r, sep)).join("")}</div></div>`
      : "");
    const TIERS = [["prismatic", "Prismatic"], ["gold", "Gold"], ["silver", "Silver"]];
    const augs = B && B.augments
      ? `<div class="card"><div class="card-head"><h2>${esc(t("Augments"))}</h2><span class="muted small">${esc(t("Most picked by {name} players", { name: c.name }))}</span></div>
          <div class="aug-cols">${TIERS.filter(([k]) => (B.augments[k] || []).length).map(([k, l]) => `<div>
            <div class="eyebrow tier-label-${k}" style="margin-bottom:0.5rem">${esc(t(l))}</div>
            ${B.augments[k].map((x) => {
              const a = D.augments[x.id] || { name: `#${x.id}` };
              return `<div class="aug-row">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ""}<span class="name">${esc(a.name)}</span>
                ${x.grade ? `<span class="chip grade-${esc(x.grade.toLowerCase())}">${esc(x.grade)}</span>` : ""}<span class="muted mono">${pct(x.pick)}</span></div>`;
            }).join("")}</div>`).join("")}</div></div>`
      : "";
    const icon = (slot) => (ab[slot] ? img(ab[slot].icon, "skill-icon", slot) : "");
    const skills = B && B.skills.length
      ? `<div class="card"><div class="card-head"><h2>${esc(t("Skill order"))}</h2></div><div class="build-list">${B.skills.map((s) => {
          const o = s.orders[0];
          return `<div class="skill"><div class="build-row"><div class="max">${[...s.max].map((k) => `${icon(k)}<b>${k}</b>`).join('<span class="muted">›</span>')}</div>${rate(s)}</div>
            ${o ? `<div class="levels">${[...o.levels].map((k, i) => `<span class="lv k-${k}" title="${esc(t("Level {n}", { n: i + 1 }))}">${k}</span>`).join("")}</div>` : ""}</div>`;
        }).join("")}</div><p class="muted small">${esc(t("Max order first, then the most common level-by-level order for it."))}</p></div>`
      : "";
    const byId = Object.fromEntries(D.champions.map((x) => [x.id, x]));
    const mates = B && B.mates.length
      ? `<div class="card"><div class="card-head"><h2>${esc(t("Best teammates"))}</h2></div><div class="mates">${B.mates.map((m) => {
          const x = byId[m.id];
          return x ? `<a class="champ" href="#${esc(x.alias)}">${img(x.icon)}<div><div class="title">${esc(x.name)}</div><div class="muted small">${t("{rate} win together", { rate: wr(m.win) })}</div></div></a>` : "";
        }).join("")}</div></div>`
      : "";
    const arrow = '<span class="arrow">›</span>';
    const augChip = (id) => {
      const a = D.augments[id] || { name: `#${id}` };
      return `<span class="aug-chip">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ""}${esc(a.name)}</span>`;
    };
    const styles = B && B.styles && B.styles.length
      ? `<div class="card"><div class="card-head"><h2>${esc(t("Builds by style"))}</h2><span class="muted small">${esc(t("Share of the most common builds"))}</span></div>
          <div class="styles">${B.styles.map((st) => `<section class="style">
            <div class="style-head"><h3>${esc(t(st.label))}</h3><span class="rates"><span>${t("{rate} win", { rate: `<b>${wr(st.win)}</b>` })}</span><span>${esc(t("{share} of builds", { share: pct(st.share, 0) }))}</span></span></div>
            <div class="eyebrow">${esc(t("Core items, in order"))}</div>
            <div class="build-list">${st.core.map((r) => itemRow(r, arrow)).join("")}</div>
            ${st.full.length ? `<div class="eyebrow">${esc(t("Full build"))}</div><div class="build-list">${st.full.map((r) => itemRow(r)).join("")}</div>` : ""}
            ${st.items.length ? `<div class="eyebrow">${esc(t("Also fits"))}</div><div class="items">${st.items.map(itemImg).join("")}</div>` : ""}
            ${st.augments.length ? `<div class="eyebrow">${esc(t("Augments that fit"))}</div><div class="aug-chips">${st.augments.map(augChip).join("")}</div>` : ""}
          </section>`).join("")}</div></div>`
      : `${block("Core items", B && B.core, arrow, "First three items, in order")}${block("Full builds", B && B.full, "")}`;
    const builds = B
      ? `${augs}
        ${styles}
        <div class="grid">${block("Starting items", B.start, "")}${block("Boots", B.boots, "")}</div>
        ${block("Most-built items", B.first, "", "Share of games with the item")}
        <p class="muted small">${esc(t("Items that only augments give, like quest rewards, are left out of these builds."))}</p>
        <div class="grid">${skills}${mates}</div>`
      : `<p class="muted">${esc(t("No build stats for this champion yet."))}</p>`;

    $("page").innerHTML = `
      <a class="back" href="#">← ${esc(t("All champions"))}</a>
      <div class="banner" style="background-image:url('${esc(c.splash)}')"><div>
        <span class="eyebrow">${esc(c.roles.map((r) => t(ROLE[r] || r)).join(" · "))}</span>
        <h1>${esc(c.name)}</h1>
        <span>${esc(c.title)}</span>
        <span class="eyebrow" id="profile" style="margin-top:0.4rem"></span>
      </div></div>
      ${facts.length ? `<div class="facts">${facts.map(([l, v]) => `<div class="card fact"><span class="eyebrow">${esc(t(l))}</span><span class="value">${v}</span></div>`).join("")}</div>` : ""}
      ${builds}
      <div class="card">
        <div class="card-head"><h2>${esc(t("Mayhem changes"))}</h2></div>
        ${changes}
        <div id="mods"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${esc(t("Abilities"))}</h2></div>
        <div class="grid">${c.abilities.map((a) => `<div class="ability">${img(a.icon)}<div><div class="title"><span class="slot">${a.slot}</span> ${esc(a.name)}
          ${a.cc ? `<span class="chip">${esc(t(CC[a.cc] || a.cc))}</span>` : ""}
          ${a.cooldown && a.cooldown.some((x) => x) ? `<span class="muted small">${esc(t("{n}s", { n: values("Cooldown", a.cooldown) }))}</span>` : ""}</div>
          <div class="muted small" style="white-space:pre-line;margin-top:0.2rem">${esc(a.text)}</div></div></div>`).join("")}</div>
      </div>
      ${statsCard(c.stats)}
      ${c.tier ? `<p class="small"><a href="/tier-list" target="_top">${esc(t("See the full Tier List →"))}</a></p>` : ""}`;
    loadProfile(c);
    loadMods(c);
    document.title = `${c.name} · ${t("Mayhem Champions")}`;
  }

  function route() {
    const c = byAlias[decodeURIComponent(location.hash.slice(1)).toLowerCase()];
    $("list").hidden = !!c;
    $("page").hidden = !c;
    if (c) {
      renderPage(c);
      scrollTo(0, 0);
    } else {
      document.title = t("Mayhem Champions");
    }
  }
  renderList();
  route();
  addEventListener("hashchange", route);
});

// Game text in the page's language: names, titles and ability text by champion, item and augment names by id
function localize(D, L) {
  if (!L || !L.champions) return;
  for (const c of D.champions) {
    const x = L.champions[c.alias];
    if (!x) continue;
    if (x.name) c.name = x.name;
    if (x.title) c.title = x.title;
    for (const a of c.abilities) Object.assign(a, (x.abilities || {})[a.slot] || {});
  }
  for (const [kind, names] of [["items", L.items], ["augments", L.augments]]) {
    for (const [id, name] of Object.entries(names || {})) if (D[kind][id]) D[kind][id].name = name;
  }
  D.champions.sort((a, b) => a.name.localeCompare(b.name, I18N.lang));
}
