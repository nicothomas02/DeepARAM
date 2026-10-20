I18N.ready.then(() => {
  const D = I18N.merge(window.GUIDE_DATA, I18N.data.guide);
  const { t } = I18N;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => I18N.num(n, 2);
  const img = (src, cls = "icon") => !src ? `<span class="${cls}"></span>` : `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  // ▲/▼ for a number going up or down; green when the change helps the player (lower cooldowns and costs help)
  const delta = (name, a, b) => {
    const mean = (v) => (Array.isArray(v) ? v.reduce((x, y) => x + y, 0) / v.length : v);
    const x = mean(a), y = mean(b);
    if (typeof x !== "number" || typeof y !== "number" || x === y) return "";
    const up = y > x, helps = /cooldown|cost|cd\b|delay|timer/i.test(name) ? !up : up;
    return ` <span class="${helps ? "up" : "down"}">${up ? "▲" : "▼"}</span>`;
  };
  const tierChip = (x) => (x ? `<span class="chip tier-${x.toLowerCase()}">${esc(t(x))}</span>` : "");
  const TIER_NAMES = { IRON: "Iron", BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold", PLATINUM: "Plat", DIAMOND: "Diamond", MASTER: "Master", GRANDMASTER: "GM", CHALLENGER: "Chall" };
  // "a, b and c" in the page's language
  const list = (xs) => (xs.length < 2 ? xs.join("") : t("{list} and {last}", { list: xs.slice(0, -1).join(t(", ")), last: xs[xs.length - 1] }));
  // internal value names ("BaseDamage") as words, translated when the page's language has them
  const words = (n) => t(n.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/_/g, " "));

  $("patch").textContent = t("Patch {v}", { v: D.patch.split(".").slice(0, 2).join(".") });

  // ---- Tabs (?tab= or #hash picks one, so other pages can link straight to it)
  const tabs = [...document.querySelectorAll("[data-tab]")];
  function show(id) {
    if (!tabs.some((x) => x.dataset.tab === id)) id = "overview";
    for (const x of tabs) x.setAttribute("aria-selected", String(x.dataset.tab === id));
    for (const x of tabs) $(`panel-${x.dataset.tab}`).hidden = x.dataset.tab !== id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", `#${id}`);
  }
  tabs.forEach((x) => x.addEventListener("click", () => show(x.dataset.tab)));
  show(location.hash.slice(1) || new URLSearchParams(location.search).get("tab"));
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ---- Overview
  const R = D.rules, B = R.balance, F = R.onFire.values;
  $("hero").src = D.hero;
  $("overview-intro").textContent = (R.augmentLevels.length
    ? t("ARAM: Mayhem is ARAM on the Howling Abyss with Arena-style augments. You pick an augment from a hand of Silver, Gold or Prismatic cards at levels {levels}, and you can reroll the hand.", { levels: list(R.augmentLevels.map(String)) })
    : t("ARAM: Mayhem is ARAM on the Howling Abyss with Arena-style augments. You pick an augment from a hand of Silver, Gold or Prismatic cards at set levels, and you can reroll the hand.")) +
    " " + t("Some augments are quests: hit a goal during the game and they turn into something bigger, including items you can't buy anywhere else.");
  const total = Object.values(D.augmentCounts).reduce((a, b) => a + b, 0);
  const facts = [
    ["Augments in the pool", total],
    ["Silver", D.augmentCounts.Silver],
    ["Gold", D.augmentCounts.Gold],
    ["Prismatic", D.augmentCounts.Prismatic],
    ["Quest augments", D.quests.length],
    ["ARAM challenges that count", D.challenges.filter((c) => c.mayhem).length],
  ];
  $("facts").innerHTML = facts.map(([l, v]) => `<div class="card fact"><span class="eyebrow">${esc(t(l))}</span><span class="value">${fmt(v)}</span></div>`).join("");

  $("story").innerHTML = (D.story || [])
    .map((e) => `<div class="row" style="align-items:flex-start"><span class="chip">${esc(t(e.date))}</span><p class="muted small" style="margin:0">${esc(t(e.text))}</p></div>`)
    .join("");

  // ---- Rules
  const pct = (x) => `${fmt(x * 100)}%`;
  const rules = [
    ["Augments", [
      t("One augment at levels {levels}.", { levels: R.augmentLevels.join(t(", ")) }),
      t("Everyone picks from the same rarity at each selection."),
      t("You choose augments while your champion is dead."),
      R.rerolls != null ? t(R.rerolls === 1
        ? "Each selection shows {cards} augments of one rarity, and each of the {cards} can be rerolled once, so you can see up to {max}."
        : "Each selection shows {cards} augments of one rarity, and each of the {cards} can be rerolled {n} times, so you can see up to {max}.",
      { cards: R.cards, n: fmt(R.rerolls), max: R.cards * (1 + R.rerolls) }) : "",
    ]],
    ["Attack speed and crits", [
      R.attackSpeedCap ? (R.aramAttackSpeedCap
        ? t("Attack speed can go up to {cap} attacks per second ({aram} in regular ARAM).", { cap: fmt(R.attackSpeedCap), aram: fmt(R.aramAttackSpeedCap) })
        : t("Attack speed can go up to {cap} attacks per second.", { cap: fmt(R.attackSpeedCap) })) : "",
      R.critOverflow === "adaptive" ? t("Critical Strike Chance over 100% turns into Adaptive Force, which becomes Attack Damage or Ability Power, whichever you have more of.") : "",
    ]],
    ["Combo Breaker", [t("A Mayhem buff worth {v} Tenacity.", { v: pct(R.comboBreakerTenacity) })]],
    ["Melee champions", [t("Bonus Health {v}, up to {max}.", { v: fmt(B.MeleeHealthBonus), max: fmt(B.MeleeHealthBonusMax) }),
      t("{v} flat Armor.", { v: fmt(B.MeleeFlatArmor) })]],
    ["Ranged champions", [t("Bonus Health {v}, up to {max}.", { v: fmt(B.RangeHealthBonus), max: fmt(B.RangeHealthBonusMax) }),
      t("Armor and Magic Resist {v}, up to {max}.", { v: fmt(B.RangeARMRBonus), max: fmt(B.RangeARMRBonusMax) })]],
    ["Everyone", [t("{v} Tenacity and Slow Resist.", { v: pct(B.TenacityAndSlowResBonus) }),
      t("{mana} Mana Regen, {energy} Energy Regen.", { mana: pct(B.ManaRegenBonus), energy: pct(B.EnergyRegenBonus) }),
      t("Passive XP {xp}, passive gold {gold}.", { xp: fmt(B.GeneralPassiveXP), gold: fmt(B.PassiveGold) })]],
    ["Catch-up XP", [t("Kicks in when a team falls {early} levels behind, or {late} after level {level}.",
      { early: fmt(B.LevelGapTrigger_EarlyGame), late: fmt(B.LevelGapTrigger_LateGame), level: fmt(B.LevelThreshold) })]],
    [R.onFire.name || "On Fire!", [R.onFire.text,
      t("Burns enemies within {radius} units, +{as} Attack Speed, +{ms} Move Speed (+{toward} toward enemies), +{mana} Mana Regen.",
        { radius: fmt(F.ImmolateRadius), as: pct(F.PercentAS), ms: pct(F.RegularMS), toward: pct(F.MoveTowardsEnemyMS), mana: pct(F.ManaRegen) }),
      t("The cost: {heal} less healing and shielding, {melee} more damage taken ({ranged} for ranged champions).",
        { heal: pct(-F.GrievousAmount), melee: pct(F.DamageTakenAmp_Melee - 1), ranged: pct(F.DamageTakenAmp_Range - 1) })]],
  ];
  const M = R.mechanics || {};
  const mins = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const crit = M.critConversion;
  if (crit) rules[1][1].push(t("Each 1% over 100% gives {ad} Attack Damage or {ap} Ability Power.", { ad: fmt(crit.adPerPercent), ap: fmt(crit.apPerPercent) }));
  if (M.longRange) rules.push(["Long-range damage", [
    t("Champions take {min} to {max} damage from enemy champions more than {range} units away, less the farther they are.",
      { min: pct(1 - M.longRange.reductionMin), max: pct(1 - M.longRange.reductionMax), range: fmt(M.longRange.range) }),
    t("Damage over time and ultimates aren't reduced.")]]);
  if (M.respawn) {
    const lv = Object.keys(M.respawn.byLevel);
    rules.push(["Levels and respawns", [
      t("Everyone starts at level {level}.", { level: M.startLevel }),
      t("Respawn takes {times} seconds at levels {from} to {to}.", { times: Object.values(M.respawn.byLevel).map(fmt).join(" / "), from: lv[0], to: lv[lv.length - 1] }),
      t("After {time}, timers grow {step} each minute, up to {cap} longer.", { time: mins(M.respawn.scaleFrom), step: pct(M.respawn.scalePerStep), cap: pct(M.respawn.scaleCap - 1) })]]);
  }
  if (M.relics) rules.push(["Health relics", [
    t("Taking a relic restores {v} of your missing health and mana.", { v: pct(M.relics.pickup) }),
    (M.relics.aramBeam !== M.relics.beam
      ? t("{delay} seconds later a beam hits everyone within {radius} units, either team, for {beam} of their missing health ({aram} in regular ARAM).",
        { delay: fmt(M.relics.delay), radius: fmt(M.relics.radius), beam: pct(M.relics.beam), aram: pct(M.relics.aramBeam) })
      : t("{delay} seconds later a beam hits everyone within {radius} units, either team, for {beam} of their missing health.",
        { delay: fmt(M.relics.delay), radius: fmt(M.relics.radius), beam: pct(M.relics.beam) })),
    t("Outer relics first appear at {outer} and inner ones at {inner}, then return {respawn} seconds after each beam.",
      { outer: mins(M.relics.firstOuter), inner: mins(M.relics.firstInner), respawn: fmt(M.relics.respawn) })]]);
  if (M.minions) rules.push(["Minions", [
    M.minions.aoeMultiplier ? t("Area damage deals {v} damage to minions.", { v: pct(M.minions.aoeMultiplier) }) : "",
    M.minions.blackout ? t("Siege and super minions have Blackout: they reveal hidden traps within {range} units for {seconds} seconds.",
      { range: fmt(M.minions.blackout.range), seconds: fmt(M.minions.blackout.revealSeconds) }) : ""]]);
  if (M.structures) rules.push(["Late-game sieges", [
    t("From {from} to {to}, champions' bonus damage to structures rises from 0 to {max}, and stays there.",
      { from: mins(M.structures.from), to: mins(M.structures.to), max: pct(M.structures.bonusMax) })]]);
  if (M.fastTravel?.length) rules.push(["Getting back to the fight", [
    ...M.fastTravel.map((f) => `${t(f.map)}, ${t(f.name)}: ${t(f.text)}`),
    M.portalSpeed ? t("Koeshin's Crossing portals also give {v} bonus Move Speed that fades over {seconds} seconds.", { v: pct(M.portalSpeed.bonus), seconds: fmt(M.portalSpeed.seconds) }) : ""]]);
  const E = R.economy;
  if (E) {
    const G = E.passiveGold, X = E.passiveXp, split = E.minionXpSplit || [];
    rules.push(["Gold and XP", [
      E.startingGold ? t("You start with {gold} gold.", { gold: fmt(E.startingGold) }) : "",
      G?.perMinute ? (G.aramPerMinute && G.aramPerMinute !== G.perMinute
        ? t("You earn {amount} gold every {every} seconds, {perMinute} a minute ({aram} in regular ARAM).", { amount: fmt(G.amount), every: fmt(G.every), perMinute: fmt(G.perMinute), aram: fmt(G.aramPerMinute) })
        : t("You earn {amount} gold every {every} seconds, {perMinute} a minute.", { amount: fmt(G.amount), every: fmt(G.every), perMinute: fmt(G.perMinute) })) : "",
      X?.perMinute ? (X.every === 1
        ? t("You earn {amount} XP every second, {perMinute} a minute.", { amount: fmt(X.amount), perMinute: fmt(X.perMinute) })
        : t("You earn {amount} XP every {every} seconds, {perMinute} a minute.", { amount: fmt(X.amount), every: fmt(X.every), perMinute: fmt(X.perMinute) })) : "",
      E.killGold ? t("A champion kill is worth {gold} gold, and First Blood {bonus} more.", { gold: fmt(E.killGold), bonus: fmt(E.firstBlood || 0) }) : "",
      E.assistSeconds ? t("Damaging a champion counts toward an assist for {seconds} seconds.", { seconds: fmt(E.assistSeconds) }) : "",
      split.length > 1 ? t("Minion XP is shared: with 1 to {n} champions nearby, each gets {shares}.", { n: split.length, shares: split.map(pct).join(" / ") }) : "",
      E.levelGapXp ? t("Kill XP changes by {v} for each level between you and the champion you kill.", { v: pct(E.levelGapXp) }) : "",
    ]]);
    if (E.levels?.length) {
      $("xp-rows").innerHTML = E.levels.map((l) => `<tr><td>${l.level}</td><td class="num">${fmt(l.xp)}</td><td class="num">${fmt(l.killXp)}</td></tr>`).join("");
      $("xp-card").hidden = false;
    }
  }
  const TU = R.turrets || [];
  if (TU.length) {
    const names = { outer: "Outer turret", inhibitor: "Inhibitor turret", nexus: "Nexus turret" };
    $("turret-rows").innerHTML = TU.map((x) => `<tr><td>${esc(t(names[x.key] || x.key))}</td><td class="num">${fmt(x.hp)}</td><td class="num">${fmt(x.damage)}</td>
      <td class="num">${fmt(x.armor)} / ${fmt(x.mr)}</td><td class="num">${fmt(x.range)}</td><td class="num">${fmt(x.attackSpeed)}</td><td class="num">${fmt(x.gold)}</td><td class="num">${fmt(x.xp)}</td></tr>`).join("");
    $("turret-note").textContent = TU.filter((x) => x.baseHp).map((x) => t("{turret}: {hp} health in Mayhem instead of {base}.", { turret: t(names[x.key] || x.key), hp: fmt(x.hp), base: fmt(x.baseHp) })).join(" ");
    $("turret-card").hidden = false;
  }
  const S = R.surrender;
  if (S) rules.push(["Surrender and remake", [
    S.voteSeconds ? t("A surrender vote lasts {seconds} seconds.", { seconds: fmt(S.voteSeconds) }) : "",
    S.opens ? (S.opensWithAfk && S.opensWithAfk !== S.opens
      ? t("You can start one from {time}, or from {afk} when a teammate is AFK.", { time: mins(S.opens), afk: mins(S.opensWithAfk) })
      : t("You can start one from {time}.", { time: mins(S.opens) })) : "",
    S.remakeFrom && S.remakeUntil ? t("A remake vote is possible from {from} to {to} when a teammate is AFK.", { from: mins(S.remakeFrom), to: mins(S.remakeUntil) }) : "",
  ]]);
  if (R.aura?.length) rules.push([R.auraName || "Mayhemic Magic", [t("Everyone has this Mayhem buff all game:"), ...R.aura.map((l) => `• ${l}`)]]);
  $("rule-list").innerHTML = rules
    .map(([title, lines]) => `<article class="card"><div class="title">${esc(t(title))}</div>${lines.filter(Boolean).map((l) => `<p class="muted small" style="margin-top:0.4rem">${esc(l)}</p>`).join("")}</article>`)
    .join("");
  const CS = D.champSelect;
  if (CS) {
    const n = CS.notInMayhem.length;
    const lines = [
      CS.runes ? "" : t("There's no rune page. Your keystones come only from augments."),
      n ? t(n > 1 ? "{spells} aren't allowed, though regular ARAM has them." : "{spells} isn't allowed, though regular ARAM has it.", { spells: list(CS.notInMayhem) }) : "",
    ].filter(Boolean);
    $("champ-select-intro").textContent = lines.join(" ");
    $("keystone-list").innerHTML = CS.keystoneAugments
      .map((a) => `<div class="row">${img(a.icon)}<div><div class="title">${esc(a.name)} ${tierChip(a.tier)}</div><div class="muted small">${esc(list(a.runes))}</div></div></div>`)
      .join("");
  }
  $("spell-augment-list").innerHTML = D.spellAugments
    .map((x) => `<div class="row" style="align-items:flex-start">${img(x.icon)}<div><div class="title">${esc(x.name)} ${tierChip(x.tier)}</div><div class="muted small" style="white-space:pre-line">${esc(x.text)}</div></div></div>`)
    .join("");

  // ---- Augment stages
  const AR = D.augmentRules;
  if (AR) {
    const n = AR.levels.length;
    $("stages-intro").textContent = t(AR.rerollsPerSlot === 1
      ? "You get {n} augments a game, one per stage. Each selection shows {cards} augments of one rarity, and you can reroll each of the {cards} slots once. You can still pick while you're dead."
      : "You get {n} augments a game, one per stage. Each selection shows {cards} augments of one rarity, and you can reroll each of the {cards} slots {rerolls} times. You can still pick while you're dead.",
    { n, cards: AR.cards, rerolls: AR.rerollsPerSlot });
    $("stage-list").innerHTML = AR.levels
      .map((lv, i) => `<div class="card fact"><span class="eyebrow">${esc(t("Stage {n}", { n: i + 1 }))}</span><span class="value">${esc(t("Level {n}", { n: lv }))}</span></div>`)
      .join("");
    $("odds-rows").innerHTML = ["Silver", "Gold", "Prismatic"]
      .filter((x) => AR.odds[x])
      .map((x) => {
        const o = AR.odds[x], game = 1 - (1 - o.offer) ** n;
        return `<tr><td>${tierChip(x)}</td><td class="num">${fmt(o.pool)}</td><td class="num"><b>${pct(o.offer)}</b></td><td class="num">${pct(o.withRerolls)}</td><td class="num">${pct(game)}</td></tr>`;
      })
      .join("");
    $("odds-note").textContent = t("The chance that one augment you want is among the {cards} cards when a selection of its rarity comes up, if every augment of that rarity is equally likely. \"Using every reroll\" counts each reroll as a fresh card. The last column is the chance it shows up at least once if all {n} selections were that rarity.", { cards: AR.cards, n });
    const extra = [...(AR.selectionAugments || []).map((a) => ({ ...a, how: a.tier })),
      ...(AR.goldenReroll?.name ? [{ name: AR.goldenReroll.name, icon: AR.goldenReroll.icon, text: `${AR.goldenReroll.text} ${t("A reward from the Mayhem progression track, not an augment.")}` }] : [])];
    $("selection-list").innerHTML = extra
      .map((a) => `<div class="row" style="align-items:flex-start">${img(a.icon)}<div><div class="title">${esc(a.name)} ${tierChip(a.tier)}</div><div class="muted small">${esc(a.text)}</div></div></div>`)
      .join("");
    const T = D.track;
    if (T) {
      const day = (d) => I18N.date(`${d}T12:00:00Z`, { month: "short", day: "numeric", year: "numeric" });
      const augs = T.levels.filter((r) => r.kind === "Augment").length;
      const PER = { minute: "{xp} XP per minute", day: "{xp} XP per day", week: "{xp} XP per week", once: "{xp} XP (once)" };
      $("track-card").hidden = false;
      $("track-title").textContent = T.name;
      $("track-dates").textContent = t("{start} to {end}", { start: day(T.start), end: day(T.end) });
      $("track-intro").textContent =
        t("Playing Mayhem fills a {size}-level track. {augs} levels unlock a new augment, which can then show up in your selections; the rest give emotes, icons, a title and other rewards.", { size: T.size, augs }) +
        (T.totalXp ? ` ${t("The track is free and takes {xp} Mayhem XP in all.", { xp: fmt(T.totalXp) })} ${T.guaranteed ? t(T.guaranteed) : ""}` : "");
      $("track-xp").innerHTML = (T.objectives || [])
        .map((o) => `<span class="chip">${esc(t(o.text))}: ${esc(t(PER[o.per] || "{xp} XP", { xp: fmt(o.xp) }))}</span>`).join("");
      $("track-list").innerHTML = T.levels
        .map((r) => `<div class="row">${r.icon ? img(r.icon) : ""}<div><div class="eyebrow">${esc(t("Level {n}", { n: r.level }))} · ${esc(t(r.kind))}${r.xp ? ` · ${esc(t("{xp} XP", { xp: fmt(r.xp) }))}` : ""}</div><div class="title">${esc(t(r.name))} ${tierChip(r.tier)}</div>${r.note ? `<div class="muted small">${esc(t(r.note))}</div>` : ""}</div></div>`)
        .join("");
    }
    const gi = AR.grantedItems.filter((g, i, all) => all.findIndex((x) => x.name === g.name) === i);
    $("granted-intro").textContent = t("Rewards can't be bought, so build stats on the champion pages leave them out. Free items are handed over at once, but you can also buy them.");
    $("granted-list").innerHTML = gi
      .map((g) => `<div class="row">${img(g.icon)}<div><div class="title">${esc(g.name)} <span class="chip">${esc(t(g.how === "reward" ? "Reward" : "Free"))}</span></div>
        <div class="muted small">${esc(t("From {augment}", { augment: g.augment }))} ${tierChip(g.augmentTier)}</div></div></div>`)
      .join("");
  }

  // When a rarity runs out of augments to offer, the game fills the selection from a fixed list
  if (D.fallbackAugments?.length) {
    $("fallback-intro").textContent = t("Each selection shows {cards} augments. When too few augments of that rarity are left to offer, the game fills the selection from this list, so these show up more often than their pick rate suggests.", { cards: R.cards });
    $("fallback-list").innerHTML = D.fallbackAugments
      .map((f) => `<div class="eyebrow" style="margin:0.75rem 0 0.5rem">${esc(t(f.tier))}</div>
        <div class="grid tight">${f.augments.map((a) => `<div class="row">${img(a.icon)}<div class="title">${esc(a.name)}</div></div>`).join("")}</div>`)
      .join("");
    $("fallback-card").hidden = false;
  }

  // ---- Items
  const exact = (n) => I18N.num(n, 4);
  $("items-intro").textContent = t("{n} items have their own values in Mayhem. Each row is one value that changes.", { n: D.itemChanges.length });
  $("item-changes").innerHTML = D.itemChanges
    .flatMap((it) => it.changes.map((c, i) => `<tr>${i === 0 ? `<td rowspan="${it.changes.length}"><div class="row">${img(it.icon)}<span class="title">${esc(it.name)}</span></div></td>` : ""}
      <td>${esc(words(c.name))}</td><td class="num">${c.rift == null ? "–" : exact(c.rift)}</td><td class="num"><b>${c.mayhem == null ? "–" : exact(c.mayhem)}</b>${delta(c.name, c.rift, c.mayhem)}</td></tr>`))
    .join("");

  // ---- Quests
  $("quest-list").innerHTML = D.quests
    .map((q) => `
      <article class="card">
        <div class="row">${img(q.icon)}<div><div class="title">${esc(q.name)}</div>
          <div class="chips">${tierChip(q.tier)}${q.milestones.length > 1 ? `<span class="chip">${esc(t("{n} steps", { n: q.milestones.length }))}</span>` : ""}${q.inPool ? "" : `<span class="chip">${esc(t("Not in the pool"))}</span>`}</div></div></div>
        <ol class="steps">${q.milestones
          .map((m) => `<li><span class="need">${fmt(m.need)}</span><span>${esc(m.quest)}${m.reward ? `<br><span class="reward">→ ${esc(m.reward)}</span>` : ""}</span></li>`)
          .join("")}</ol>
        ${q.notes.map((x) => `<p class="note">${esc(x)}</p>`).join("")}
      </article>`)
    .join("");

  if (D.rivalQuests?.length) {
    $("rival-list").innerHTML = D.rivalQuests
      .map((q) => `<article class="card"><div class="title">${esc(q.name)}</div>
        ${q.champions.map((c) => `<div class="row" style="margin-top:0.5rem;align-items:flex-start">${img(c.icon, "icon round")}<div><div class="title">${esc(c.name)}</div><div class="muted small">${esc(c.text)}</div></div></div>`).join("")}
      </article>`)
      .join("");
    $("rival-card").hidden = false;
  }

  // ---- Challenges
  const counted = D.challenges.filter((c) => c.mayhem).length;
  $("ch-intro").textContent = t("{counted} of the {total} ARAM challenges list ARAM: Mayhem among the queues they track, so your Mayhem games move them forward. Each one shows the value needed for every tier.",
    { counted, total: D.challenges.length });
  const groups = [...new Set(D.challenges.map((c) => c.group))];
  $("challenge-groups").innerHTML = groups
    .map((g) => `
      <div><h2 class="section" style="margin:0.25rem 0 0.75rem">${esc(t(g))}</h2>
      <div class="grid">${D.challenges
        .filter((c) => c.group === g)
        .map((c) => {
          const tiers = c.tiers.map((x) => `<span>${esc(t(TIER_NAMES[x.tier] || x.tier))} <b>${fmt(x.value)}</b></span>`).join("");
          return `<article class="card"><div class="row">${img(c.icon)}<div><div class="title">${esc(c.name)}</div>
            <div class="muted small">${esc(c.text)}</div></div></div>
            <div class="tiers">${tiers}</div>${c.mayhem ? "" : `<p class="note">${esc(t("Doesn't count Mayhem games."))}</p>`}</article>`;
        })
        .join("")}</div></div>`)
    .join("");

  // ---- Extras
  $("item-list").innerHTML = D.items
    .map((i) => `<div class="row">${img(i.icon)}<div><div class="title">${esc(i.name)}</div>${i.text ? `<div class="muted small">${esc(i.text.split("\n").slice(0, 3).join(" · "))}</div>` : ""}</div></div>`)
    .join("");
  $("summon-list").innerHTML = D.summons
    .map((s) => `<div class="row">${img(s.icon, "icon round")}<div><div class="title">${esc(t(s.name))}</div><div class="muted small">${esc(t(s.text))}</div></div></div>`)
    .join("");
});
