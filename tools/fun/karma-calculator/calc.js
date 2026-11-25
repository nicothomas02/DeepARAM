// Infinite Karma math. Pure functions, no DOM, so the page and tests share them.
//
// Gathering Fire: every enemy champion hit by one of Karma's damaging abilities takes 4 s off Mantra (R). Each damage
// instance counts. Inner Flame (Q) hits once and Soulflare (RQ) explodes again 1.5 s later. Focused Resolve (W) hits
// when cast and again when its 2 s tether ends. So a point-click W alone takes 8 s off Mantra.
//
// Archmage refunds 30% of the cast ability's base cooldown to another random ability on cooldown, Mantra included.
// Mystic Punch takes 1.25 s off every cooldown per on-hit (never below 0.5 s), and Ethereal Weapon makes ability hits
// apply on-hit once per target per 1.5 s. Ultimate Awakening resets the basic abilities with every Mantra.
//
// The loop is closed when every Inner Flame and Focused Resolve Karma casts is empowered by a Mantra.
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
  const KEYS = ["Q", "W", "E", "R"];
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

  // build: { qRank, wRank, eRank 1-5, rRank 1-4, haste, ultHaste, augments: [key...], qTargets 0-5, flareTargets 0-5,
  //          tetherHolds, castE, attackSpeed (attacks a second between casts, 0 = none), maxMana, regen5 }
  function setup(data, build) {
    const S = data.champion.spells;
    const C = data.champion;
    const has = (k) => build.augments.includes(k);
    const v = (k, name, def) => ((aug(data, k) || {}).values || {})[name] ?? def;
    const rank = (r, def, top = 5) => Math.min(top, Math.max(1, Math.round(+r || def))) - 1;
    const i = { Q: rank(build.qRank, 5), W: rank(build.wRank, 1), E: rank(build.eRank, 1), R: rank(build.rRank, 4, 4) };
    const base = {};
    for (const k of KEYS) base[k] = S[k].cooldown[i[k]];
    const awaken = has("UltimateAwakening");
    const ethereal = has("ARAM_EtherealWeapon");
    const punch = has("ARAM_MysticPunch");
    const m = baseMana(data);
    const targets = (n, def) => Math.min(5, Math.max(0, Math.round(n ?? def)));
    return {
      base,
      haste: Math.max(0, +build.haste || 0),
      bonus: {
        Q: has("ARAM_BreadAndButter") ? v("ARAM_BreadAndButter", "QAbilityHaste", 100) : 0,
        W: has("ARAM_BreadAndJam") ? v("ARAM_BreadAndJam", "WAbilityHaste", 100) : 0,
        E: has("ARAM_BreadAndCheese") ? v("ARAM_BreadAndCheese", "EAbilityHaste", 100) : 0,
        R: (+build.ultHaste || 0) + (awaken ? v("UltimateAwakening", "AH", 30) : 0)
          + (has("UltimateRecursion") ? v("UltimateRecursion", "UltimateHaste", 50) : 0),
      },
      purist: has("ARAM_Purist_Caster") ? v("ARAM_Purist_Caster", "CooldownReduction", 0.1) : 0,
      cast: { Q: S.Q.castTime ?? 0.25, W: S.W.castTime ?? 0.25, E: S.E.castTime ?? 0, R: S.R.castTime ?? 0 },
      cost: { Q: S.Q.mana[i.Q] || 0, W: S.W.mana[i.W] || 0, E: S.E.mana[i.E] || 0, R: 0 },
      passiveCut: C.passiveCut ?? 4,
      flareDelay: C.soulflareDelay ?? 1.5,
      tether: C.tether ?? 2,
      qTargets: targets(build.qTargets, 2),
      flareTargets: targets(build.flareTargets, build.qTargets ?? 2),
      tetherHolds: build.tetherHolds !== false,
      castE: !!build.castE,
      archmage: has("ARAM_Archmage") ? v("ARAM_Archmage", "RefundPercent", 0.3) : 0,
      awaken: awaken && { haste: v("UltimateAwakening", "AdditionalHaste", 300), buff: v("UltimateAwakening", "BuffDuration", 15), cd: v("UltimateAwakening", "Cooldown", 20) },
      revolution: has("ARAM_UltimateRevolution") ? v("ARAM_UltimateRevolution", "Cooldown", 75) : 0,
      punch: punch ? { cut: v("ARAM_MysticPunch", "CooldownRefund", 1.25), floor: v("ARAM_MysticPunch", "MinCDR", 0.5) } : null,
      ethereal: ethereal ? v("ARAM_EtherealWeapon", "Cooldown", 1.5) : 0,
      attackEvery: punch && build.attackSpeed > 0 ? 1 / build.attackSpeed : 0,
      maxMana: build.maxMana > 0 ? +build.maxMana : m.max,
      regen: (build.regen5 >= 0 && build.regen5 !== "" && build.regen5 != null ? +build.regen5 : m.regen5) / 5,
    };
  }

  // One fight of `seconds`. Karma casts Mantra when it is up and Inner Flame or Focused Resolve is ready, then Q, then
  // W, then (if set) E. Mantra empowers the next of those. Cooldowns are kept as the share of the full cooldown left
  // (1 = just cast), so Ultimate Awakening's haste speeds up what is left, as in game. Refunds are flat seconds.
  function fight(p, seconds, seed, mana = true) {
    const rand = rng(seed);
    let t = 0, free = 0, pool = p.maxMana, manaOut = Infinity;
    let buffUntil = -1, awakenAt = 0, revolutionAt = 0, empowered = false;
    let nextAttack = p.attackEvery || Infinity;
    const share = { Q: 0, W: 0, E: 0, R: 0 };
    const hits = [];                 // pending damage: { at, targets }
    const lastProc = [-99, -99, -99, -99, -99];
    const log = { Q: [], W: [], E: [], R: [], RQ: [], RW: [] };

    const len = (k) => hasted(p.base[k], p.haste + (k !== "R" && t < buffUntil ? p.awaken.haste : 0) + p.bonus[k], p.purist);
    const left = (k) => share[k] * len(k);
    function cut(k, sec, floor = 0) {
      const now = left(k);
      if (now <= 0) return;
      let after = Math.max(now - sec, Math.min(now, floor));
      if (after < 1e-6) after = 0;
      share[k] = len(k) > 0 ? after / len(k) : 0;
    }
    // Archmage: 30% of the cast ability's base cooldown off another random ability that is on cooldown.
    function archmage(k) {
      if (!p.archmage) return;
      const pool2 = KEYS.filter((x) => x !== k && left(x) > 0);
      if (!pool2.length) return;
      cut(pool2[Math.floor(rand() * pool2.length)], p.archmage * p.base[k]);
    }
    const punch = () => { for (const k of KEYS) cut(k, p.punch.cut, p.punch.floor); };
    function land(h) {
      for (let i = 0; i < h.targets; i++) {
        cut("R", p.passiveCut);
        if (p.punch && p.ethereal && h.at >= lastProc[i] + p.ethereal - 1e-9) { lastProc[i] = h.at; punch(); }
      }
    }
    const afford = (k) => !mana || pool >= p.cost[k] - 1e-9;
    function cast(k) {
      if (mana) pool -= p.cost[k];
      free = t + p.cast[k];
      // The cooldown starts when the cast ends: a share a little over 1 at the moment of casting.
      share[k] = len(k) > 0 ? 1 + p.cast[k] / len(k) : 0;
      log[k].push(t);
      archmage(k);
    }
    const ready = (k) => share[k] <= 1e-9;

    while (t < seconds) {
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i].at <= t + 1e-9) { land(hits[i]); hits.splice(i, 1); }
      if (p.attackEvery && t >= nextAttack - 1e-9) { punch(); nextAttack = t + p.attackEvery; }
      if (t >= free - 1e-9) {
        const qOk = ready("Q") && afford("Q"), wOk = ready("W") && afford("W");
        let did = true;
        if (!empowered && ready("R") && (qOk || wOk)) {
          cast("R"); empowered = true;
          if (p.awaken && t >= awakenAt) {
            share.Q = 0; share.W = 0; share.E = 0;
            buffUntil = t + p.awaken.buff; awakenAt = t + p.awaken.cd;
          }
          if (p.revolution && t >= revolutionAt) { share.R = 0; revolutionAt = t + p.revolution; }
        } else if (qOk) {
          const at = t + p.cast.Q;
          cast("Q");
          hits.push({ at, targets: p.qTargets });
          if (empowered) { log.RQ.push(t); empowered = false; hits.push({ at: at + p.flareDelay, targets: p.flareTargets }); }
        } else if (wOk) {
          const at = t + p.cast.W;
          cast("W");
          hits.push({ at, targets: 1 });
          if (p.tetherHolds) hits.push({ at: at + p.tether, targets: 1 });
          if (empowered) { log.RW.push(t); empowered = false; }
        } else if (p.castE && !empowered && ready("E") && afford("E")) {
          cast("E");
        } else did = false;
        if (did) continue;
        if (mana && manaOut === Infinity && ((ready("Q") && !qOk) || (ready("W") && !wOk))) manaOut = t;
      }
      // Jump to the next moment something changes.
      const need = (k) => (mana && pool < p.cost[k] ? t + (p.cost[k] - pool) / (p.regen || 1e-9) : Infinity);
      const next = Math.min(
        seconds,
        free > t ? free : Infinity,
        ...KEYS.map((k) => (share[k] > 0 ? t + left(k) : Infinity)),
        ...hits.map((h) => h.at),
        nextAttack,
        buffUntil > t ? buffUntil : Infinity,
        ready("Q") ? need("Q") : Infinity,
        ready("W") ? need("W") : Infinity,
      );
      const dt = Math.max(1e-6, next - t);
      for (const k of KEYS) { const l = len(k); share[k] = l > 0 ? Math.max(0, share[k] - dt / l) : 0; if (share[k] < 1e-9) share[k] = 0; }
      if (mana) pool = Math.min(p.maxMana, pool + p.regen * dt);
      t += dt;
    }
    return { ...log, manaOut };
  }

  // Averages over `runs` fights (Archmage's pick is random). Per-minute rates are the minutes after the first.
  function compute(data, build, opts = {}) {
    const p = setup(data, build);
    const runs = opts.runs ?? 40, minutes = opts.minutes ?? 4;
    const n = p.archmage ? runs : 1;
    const late = (arr) => arr.filter((x) => x >= 60).length;
    const sum = { Q: 0, W: 0, R: 0, RQ: 0, RW: 0, mEmp: 0, manaOut: 0 };
    for (let i = 0; i < n; i++) {
      const f = fight(p, minutes * 60, 1 + i * 7919, false);
      for (const k of ["Q", "W", "R", "RQ", "RW"]) sum[k] += late(f[k]);
      if (opts.mana !== false) {
        const g = fight(p, minutes * 60, 1 + i * 7919, true);
        sum.mEmp += late(g.RQ) + late(g.RW);
        sum.manaOut += Math.min(g.manaOut, minutes * 60);
      }
    }
    const per = (x) => x / n / (minutes - 1);
    const basics = per(sum.Q + sum.W);
    const empowered = per(sum.RQ + sum.RW);
    const len = (k, extra = 0) => hasted(p.base[k], p.haste + p.bonus[k] + extra, p.purist);
    return {
      perMinute: empowered,
      rqPerMinute: per(sum.RQ),
      rwPerMinute: per(sum.RW),
      basicsPerMinute: basics,
      mantrasPerMinute: per(sum.R),
      loop: basics > 0 ? Math.min(1, empowered / basics) : 0,
      cooldowns: { Q: len("Q"), W: len("W"), E: len("E"), R: len("R") },
      // Seconds Gathering Fire takes off Mantra per cast, with these targets.
      cutPerQ: p.passiveCut * p.qTargets,
      cutPerRQ: p.passiveCut * (p.qTargets + p.flareTargets),
      cutPerW: p.passiveCut * (p.tetherHolds ? 2 : 1),
      refundFromR: p.archmage * p.base.R,
      cost: p.cost,
      withMana: {
        perMinute: per(sum.mEmp),
        lastsFor: sum.manaOut / n,
        runsOut: sum.manaOut / n < minutes * 60,
      },
      maxMana: p.maxMana,
      regen5: p.regen * 5,
    };
  }

  // Empowered casts per minute across a range of haste, for the chart.
  function curve(data, build, { from = 0, to = 500, step = 10, runs = 6, minutes = 2 } = {}) {
    const out = [];
    for (let h = from; h <= to; h += step) {
      const r = compute(data, { ...build, haste: h }, { runs, minutes, mana: false });
      out.push({ haste: h, perMinute: r.perMinute, loop: r.loop });
    }
    return out;
  }

  // The lowest haste from which at least `share` of Karma's Q and W casts are empowered, up to `to`, or null.
  function threshold(data, build, { share = 0.9, to = 500, runs = 8, minutes = 3 } = {}) {
    const ok = (h) => compute(data, { ...build, haste: h }, { runs, minutes, mana: false }).loop >= share;
    // Binary search: the loop share rises with haste (random Archmage picks aside), so this needs ~9 fights, not 100.
    if (!ok(to)) return null;
    let lo = 0, hi = to;
    if (ok(lo)) return 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  const api = { compute, curve, threshold, setup, fight, hasted, baseMana, statAt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KarmaCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
