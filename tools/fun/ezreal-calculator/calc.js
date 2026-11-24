// Infinite Ezreal math. Pure functions, no DOM, so the page and tests share them.
//
// A Mystic Shot (Q) hit takes 1.5 s off all of Ezreal's cooldowns, Q's own included. Skilled Sniper takes another 80%
// of Q's full cooldown off when the hit lands from 600 or more units away. What is left of Q's cooldown at the hit,
// c - 0.8c - 1.5, is never above 0 (c is at most 5.5 s), so from long range Q is back the moment it lands: one Mystic
// Shot per cast time plus flight time, at any haste. Without Skilled Sniper, haste has to bring Q's cooldown down to
// the flight time plus 1.5 s.
//
// Mana is what stops it. The page plays the fight twice: once with endless mana and once with your pool.
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
  const MARK_TIME = 4;      // seconds Essence Flux's mark stays on its target
  const MARK_MANA = 60;     // mana a mark gives back when an ability sets it off, plus that ability's cost
  const aug = (data, key) => data.augments.find((a) => a.key === key);

  // Seconds an ability's cooldown lasts: base x 100 / (100 + haste), less Purist's 10% of the base cooldown.
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

  // build: { qRank 1-5, haste, distance, augments: [key...], castW, othersOnCooldown, punchOnQ, maxMana, regen5 }
  function setup(data, build) {
    const S = data.champion.spells;
    const has = (k) => build.augments.includes(k);
    const v = (k, name, def) => ((aug(data, k) || {}).values || {})[name] ?? def;
    const q = Math.min(5, Math.max(1, Math.round(+build.qRank || 5))) - 1;
    const haste = Math.max(0, +build.haste || 0);
    const purist = has("ARAM_Purist_Caster") ? v("ARAM_Purist_Caster", "CooldownReduction", 0.1) : 0;
    const qHaste = has("ARAM_BreadAndButter") ? v("ARAM_BreadAndButter", "QAbilityHaste", 100) : 0;
    const distance = Math.min(S.Q.range || 1200, Math.max(0, +build.distance || 0));
    const m = baseMana(data);
    return {
      base: { Q: S.Q.cooldown[q], W: S.W.cooldown[0] },
      cd: { Q: hasted(S.Q.cooldown[q], haste + qHaste, purist), W: hasted(S.W.cooldown[0], haste, purist) },
      cast: { Q: S.Q.castTime ?? 0.25, W: S.W.castTime ?? 0.25 },
      cost: { Q: S.Q.mana[q], W: S.W.mana[0] },
      flight: distance / (S.Q.speed || 2000),
      wFlight: distance / 1700,
      refund: S.Q.refund ?? 1.5,
      distance,
      sniper: has("ARAM_SkilledSniper") && distance >= v("ARAM_SkilledSniper", "SnipeDistance", 600)
        ? v("ARAM_SkilledSniper", "ReducedCooldownPercent", 0.8) : 0,
      punch: has("ARAM_MysticPunch") && build.punchOnQ !== false
        ? { cut: v("ARAM_MysticPunch", "CooldownRefund", 1.25), floor: v("ARAM_MysticPunch", "MinCDR", 0.5) } : null,
      archmage: has("ARAM_Archmage") ? v("ARAM_Archmage", "RefundPercent", 0.3) : 0,
      castW: !!build.castW,
      othersOnCooldown: !!build.othersOnCooldown,
      maxMana: build.maxMana > 0 ? +build.maxMana : m.max,
      regen: (build.regen5 != null && build.regen5 !== "" && build.regen5 >= 0 ? +build.regen5 : m.regen5) / 5,
    };
  }

  // One fight of `seconds`. Ezreal casts Q whenever it is up, then (if set) W. Every Q hits a champion `distance` away.
  // Cooldowns start when the cast ends. With `mana` false, mana is ignored.
  function fight(p, seconds, seed, mana = true) {
    const rand = rng(seed);
    let t = 0, free = 0, pool = p.maxMana, manaOut = Infinity, markUntil = -1;
    const left = { Q: 0, W: 0 };
    const hits = [];          // pending hits: { at, key }
    const qCasts = [];

    // Take `sec` off a cooldown; `floor` keeps that much of what's left (Mystic Punch).
    function cut(k, sec, floor = 0) {
      const now = left[k];
      if (now <= 0) return;
      let after = Math.max(now - sec, Math.min(now, floor));
      if (after < 1e-6) after = 0;
      left[k] = after;
    }
    // Archmage: 30% of the cast ability's base cooldown comes off another random ability that is on cooldown.
    // Arcane Shift and Trueshot Barrage count when the setting says they're on cooldown; a refund on them does nothing here.
    function archmage(k) {
      if (!p.archmage) return;
      const targets = ["Q", "W"].filter((x) => x !== k && left[x] > 0);
      if (p.othersOnCooldown) targets.push("E", "R");
      if (!targets.length) return;
      const pick = targets[Math.floor(rand() * targets.length)];
      if (pick === "Q" || pick === "W") cut(pick, p.archmage * p.base[k]);
    }
    const afford = (k) => !mana || pool >= p.cost[k] - 1e-9;
    function cast(k) {
      if (mana) pool -= p.cost[k];
      free = t + p.cast[k];
      left[k] = p.cd[k] + p.cast[k];
      archmage(k);
      hits.push({ at: t + p.cast[k] + (k === "Q" ? p.flight : p.wFlight), key: k });
    }
    function land(h) {
      if (h.key === "W") { markUntil = h.at + MARK_TIME; return; }
      for (const k of ["Q", "W"]) cut(k, p.refund);
      if (p.sniper) cut("Q", p.sniper * p.cd.Q);
      if (p.punch) for (const k of ["Q", "W"]) cut(k, p.punch.cut, p.punch.floor);
      if (h.at <= markUntil) {
        markUntil = -1;
        if (mana) pool = Math.min(p.maxMana, pool + MARK_MANA + p.cost.Q);
      }
    }

    while (t < seconds) {
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i].at <= t + 1e-9) { land(hits[i]); hits.splice(i, 1); }
      if (t >= free - 1e-9) {
        let did = false;
        if (left.Q <= 0 && afford("Q")) { cast("Q"); qCasts.push(t); did = true; }
        else if (p.castW && left.W <= 0 && afford("W")) { cast("W"); did = true; }
        if (did) continue;
        if (mana && manaOut === Infinity && left.Q <= 0) manaOut = t;
      }
      const need = (k) => (mana && pool < p.cost[k] ? t + (p.cost[k] - pool) / (p.regen || 1e-9) : Infinity);
      const next = Math.min(
        seconds,
        free > t ? free : Infinity,
        left.Q > 0 ? t + left.Q : Infinity,
        left.W > 0 ? t + left.W : Infinity,
        left.Q <= 0 ? need("Q") : Infinity,
        ...hits.map((h) => h.at),
      );
      const dt = Math.max(1e-6, next - t);
      for (const k of ["Q", "W"]) cut(k, dt);
      if (mana) pool = Math.min(p.maxMana, pool + p.regen * dt);
      t += dt;
    }
    return { qCasts, manaOut };
  }

  function compute(data, build, opts = {}) {
    const p = setup(data, build);
    const runs = opts.runs ?? 40, minutes = opts.minutes ?? 4;
    const random = p.archmage && (p.castW || p.othersOnCooldown);
    const n = random ? runs : 1;
    let first = 0, later = 0, mLater = 0, manaOut = 0;
    for (let i = 0; i < n; i++) {
      const f = fight(p, minutes * 60, 1 + i * 7919, false);
      first += f.qCasts.filter((x) => x < 60).length;
      later += f.qCasts.filter((x) => x >= 60).length;
      if (opts.mana !== false) {
        const g = fight(p, minutes * 60, 1 + i * 7919, true);
        mLater += g.qCasts.filter((x) => x >= 60).length;
        manaOut += Math.min(g.manaOut, minutes * 60);
      }
    }
    const perMinute = later / n / (minutes - 1);
    // A full loop: Q back the moment each shot lands, so one Q per cast time plus flight time.
    const maxPerMinute = 60 / Math.max(1e-3, p.cast.Q + p.flight);
    return {
      perMinute,
      firstMinute: first / n,
      every: perMinute > 0 ? 60 / perMinute : Infinity,
      maxPerMinute,
      loop: Math.min(1, perMinute / maxPerMinute),
      flight: p.flight,
      sniper: p.sniper > 0,
      cooldowns: p.cd,
      cost: p.cost,
      // Seconds of Q's cooldown left when a shot lands, before its own refunds (negative = already back).
      leftAtHit: p.cd.Q - p.flight,
      withMana: {
        perMinute: mLater / n / (minutes - 1),
        lastsFor: manaOut / n,
        runsOut: manaOut / n < minutes * 60,
      },
      maxMana: p.maxMana,
      regen5: p.regen * 5,
    };
  }

  function curve(data, build, { from = 0, to = 500, step = 10, runs = 10 } = {}) {
    const out = [];
    for (let h = from; h <= to; h += step) out.push({ haste: h, perMinute: compute(data, { ...build, haste: h }, { runs, mana: false }).perMinute });
    return out;
  }

  // The haste from which the loop is at least `share` full and stays that way up to `to`.
  function threshold(data, build, { share = 0.9, to = 500, runs = 10 } = {}) {
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
  else root.EzrealCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
