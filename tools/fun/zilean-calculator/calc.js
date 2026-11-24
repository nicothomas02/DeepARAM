// Infinite Zilean math. Pure functions, no DOM, so the page and tests share them.
//
// Rewind (W) takes 10 s off Time Bomb (Q), and Q's cooldown is never longer than 10 s, so every W brings Q straight
// back. With Archmage, every Q also takes 30% of Q's base cooldown (3 to 2.4 s) off another ability that is on
// cooldown. If Zilean only casts Q and W, that is always W. Once W's cooldown fits inside that refund plus Q's cast
// time, Q-W-Q-W never waits: a Time Bomb every quarter second, and a double-bomb stun with every second one.
//
// Mana is what stops it. The page plays the fight twice: once with endless mana (how fast the cooldowns allow) and
// once with your mana pool and regeneration.
(function (root) {
  "use strict";

  // Small seeded generator (mulberry32): the same seed gives the same fight.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const HASTE_CAP = 500;
  const BOMB_FUSE = 3; // seconds a Time Bomb waits before it goes off on its own
  const aug = (data, key) => data.augments.find((a) => a.key === key);

  // Seconds an ability's cooldown lasts: base x 100 / (100 + haste), less Purist's 10% of the base cooldown.
  // The game caps total haste at 500.
  const hasted = (base, haste, purist = 0) => Math.max(0, base * (100 / (100 + Math.min(HASTE_CAP, haste)) - purist));

  // League's per-level stat growth: base + growth * (n - 1) * (0.7025 + 0.0175 * (n - 1))
  function statAt(base, growth, level) {
    const n = level - 1;
    return base + growth * n * (0.7025 + 0.0175 * n);
  }

  // Level-18 mana and regeneration with no items, the page's starting values.
  function baseMana(data, level = 18) {
    const c = data.champion;
    return { max: statAt(c.baseMana, c.manaPerLevel, level), regen5: 5 * statAt(c.manaRegen, c.manaRegenPerLevel, level) };
  }

  // build: { qRank, wRank, eRank 1-5, haste, augments: [key...], castE, rOnCooldown, maxMana, regen5 }
  function setup(data, build) {
    const S = data.champion.spells;
    const has = (k) => build.augments.includes(k);
    const v = (k, name, def) => ((aug(data, k) || {}).values || {})[name] ?? def;
    const rank = (r, def) => Math.min(5, Math.max(1, Math.round(+r || def))) - 1;
    const q = rank(build.qRank, 5), w = rank(build.wRank, 5), e = rank(build.eRank, 1);
    const haste = Math.max(0, +build.haste || 0);
    const purist = has("ARAM_Purist_Caster") ? v("ARAM_Purist_Caster", "CooldownReduction", 0.1) : 0;
    const base = { Q: S.Q.cooldown[q], W: S.W.cooldown[w], E: S.E.cooldown[e] };
    const bonus = {
      Q: has("ARAM_BreadAndButter") ? v("ARAM_BreadAndButter", "QAbilityHaste", 100) : 0,
      W: has("ARAM_BreadAndJam") ? v("ARAM_BreadAndJam", "WAbilityHaste", 100) : 0,
      E: has("ARAM_BreadAndCheese") ? v("ARAM_BreadAndCheese", "EAbilityHaste", 100) : 0,
    };
    const cd = {};
    for (const k of ["Q", "W", "E"]) cd[k] = hasted(base[k], haste + bonus[k], purist);
    const m = baseMana(data);
    return {
      base, cd,
      cast: { Q: S.Q.castTime ?? 0.25, W: S.W.castTime ?? 0, E: S.E.castTime ?? 0 },
      cost: { Q: S.Q.mana[q], W: S.W.mana[w], E: S.E.mana[e] },
      rewind: S.W.reduction ?? 10,
      archmage: has("ARAM_Archmage") ? v("ARAM_Archmage", "RefundPercent", 0.3) : 0,
      castE: !!build.castE,
      rOnCooldown: !!build.rOnCooldown,
      maxMana: build.maxMana > 0 ? +build.maxMana : m.max,
      regen: (build.regen5 >= 0 && build.regen5 !== "" && build.regen5 != null ? +build.regen5 : m.regen5) / 5,
    };
  }

  // One fight of `seconds`. Zilean casts Q whenever it is up, then W while Q is on cooldown, then (if set) E.
  // Cooldowns start when a cast ends, as most abilities do. With `mana` false, mana is ignored.
  function fight(p, seconds, seed, mana = true) {
    const rand = rng(seed);
    let t = 0, free = 0, pool = p.maxMana, manaOut = Infinity;
    const left = { Q: 0, W: 0, E: 0 };
    const qCasts = [];
    const stuns = [];
    let bombUntil = -1;

    function cut(k, sec) { left[k] = Math.max(0, left[k] - sec); if (left[k] < 1e-6) left[k] = 0; }
    // Archmage: 30% of the cast ability's base cooldown comes off another random ability that is on cooldown.
    // Chronoshift (R) counts when it's on cooldown, but a refund on it does nothing for Q and W.
    function archmage(k) {
      if (!p.archmage) return;
      const targets = ["Q", "W", "E"].filter((x) => x !== k && left[x] > 0);
      if (p.rOnCooldown) targets.push("R");
      if (!targets.length) return;
      const pick = targets[Math.floor(rand() * targets.length)];
      if (pick !== "R") cut(pick, p.archmage * p.base[k]);
    }
    const afford = (k) => !mana || pool >= p.cost[k] - 1e-9;
    function cast(k) {
      if (mana) pool -= p.cost[k];
      free = t + p.cast[k];
      left[k] = p.cd[k] + p.cast[k];
      archmage(k);
    }

    while (t < seconds) {
      if (t >= free - 1e-9) {
        const wantW = left.Q > 0 || (p.castE && left.E > 0);
        let did = null;
        if (left.Q <= 0 && afford("Q")) {
          cast("Q"); did = "Q";
          qCasts.push(t);
          // A second bomb on a target that already has one sets both off and stuns.
          if (t <= bombUntil) { stuns.push(t); bombUntil = -1; } else bombUntil = t + BOMB_FUSE;
        } else if (left.W <= 0 && wantW && afford("W")) {
          cast("W"); did = "W";
          cut("Q", p.rewind); cut("E", p.rewind);
        } else if (p.castE && left.E <= 0 && afford("E")) {
          cast("E"); did = "E";
        }
        if (did) continue;
        // Nothing cast: if only mana is missing, that is when it ran out.
        if (mana && manaOut === Infinity && (left.Q <= 0 || (left.W <= 0 && wantW))) manaOut = t;
      }
      // Jump to the next moment something changes.
      const need = (k) => (mana && pool < p.cost[k] ? t + (p.cost[k] - pool) / (p.regen || 1e-9) : Infinity);
      const next = Math.min(
        seconds,
        free > t ? free : Infinity,
        ...["Q", "W", "E"].map((k) => (left[k] > 0 ? t + left[k] : Infinity)),
        left.Q <= 0 ? need("Q") : Infinity,
        left.W <= 0 ? need("W") : Infinity,
      );
      const dt = Math.max(1e-6, next - t);
      for (const k of ["Q", "W", "E"]) cut(k, dt);
      if (mana) pool = Math.min(p.maxMana, pool + p.regen * dt);
      t += dt;
    }
    return { qCasts, stuns, manaOut };
  }

  // Averages over `runs` fights (Archmage's pick is random only when more than one ability can be on cooldown).
  // The per-minute rates are the minutes after the first (the steady rate).
  function compute(data, build, opts = {}) {
    const p = setup(data, build);
    const runs = opts.runs ?? 60, minutes = opts.minutes ?? 4;
    const random = p.archmage && (p.castE || p.rOnCooldown);
    const n = random ? runs : 1;
    let first = 0, later = 0, stuns = 0, mLater = 0, mFirst = 0, manaOut = 0;
    for (let i = 0; i < n; i++) {
      const f = fight(p, minutes * 60, 1 + i * 7919, false);
      first += f.qCasts.filter((x) => x < 60).length;
      later += f.qCasts.filter((x) => x >= 60).length;
      stuns += f.stuns.filter((x) => x >= 60).length;
      if (opts.mana !== false) {
        const g = fight(p, minutes * 60, 1 + i * 7919, true);
        mFirst += g.qCasts.filter((x) => x < 60).length;
        mLater += g.qCasts.filter((x) => x >= 60).length;
        manaOut += Math.min(g.manaOut, minutes * 60);
      }
    }
    const perMinute = later / n / (minutes - 1);
    // Q can't come faster than its own cast time (Rewind has none), so that is a full loop.
    const maxPerMinute = 60 / Math.max(1e-3, p.cast.Q + p.cast.W);
    return {
      perMinute,
      firstMinute: first / n,
      every: perMinute > 0 ? 60 / perMinute : Infinity,
      stunsPerMinute: stuns / n / (minutes - 1),
      maxPerMinute,
      loop: Math.min(1, perMinute / maxPerMinute),
      cooldowns: p.cd,
      cost: p.cost,
      refundFromQ: p.archmage * p.base.Q,
      withMana: {
        firstMinute: mFirst / n,
        perMinute: mLater / n / (minutes - 1),
        // Seconds of nonstop casting before mana first holds a cast back (the fight's length if it never does).
        lastsFor: manaOut / n,
        runsOut: manaOut / n < minutes * 60,
      },
      maxMana: p.maxMana,
      regen5: p.regen * 5,
    };
  }

  // Q per minute across a range of haste, for the chart.
  function curve(data, build, { from = 0, to = 500, step = 10, runs = 20 } = {}) {
    const out = [];
    for (let h = from; h <= to; h += step) out.push({ haste: h, perMinute: compute(data, { ...build, haste: h }, { runs, mana: false }).perMinute });
    return out;
  }

  // The haste from which the loop is at least `share` full and stays that way up to `to`: steps of 5 down from `to`,
  // then single points below the last step that passed.
  function threshold(data, build, { share = 0.9, to = 500, runs = 20 } = {}) {
    const ok = (h) => compute(data, { ...build, haste: h }, { runs, mana: false }).loop >= share;
    let found = null;
    for (let h = to; h >= 0; h -= 5) {
      if (ok(h)) found = h;
      else break;
    }
    if (found === null) return null;
    for (let h = found - 1; h > found - 5 && h >= 0 && ok(h); h--) found = h;
    return found;
  }

  const api = { compute, curve, threshold, setup, fight, hasted, baseMana, statAt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZileanCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
