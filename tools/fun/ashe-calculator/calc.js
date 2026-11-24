// Infinite Ashe math. Pure functions, no DOM, so the page and tests share them.
//
// With Archmage, every cast takes 30% of the cast ability's base cooldown off another ability. Hawkshot (E) has a
// long recharge (90 to 50 s), so an E cast takes a big bite out of R's cooldown, and an R cast takes a big bite out
// of E's recharge. With enough haste the two keep bringing each other back: an R after every Hawkshot.
//
// Archmage picks its target at random, so the page plays the fight out many times (a seeded random generator, so
// the same build always shows the same numbers) and averages the casts.
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

  const aug = (data, key) => data.augments.find((a) => a.key === key);

  // The fixed numbers for one build: base cooldowns at these ranks and the haste on each ability.
  // build: { rRank 1-3, eRank 1-5, wRank 0-5, haste, ultHaste, augments: [key...], attackSpeed, castW, onlyOnCooldown }
  function setup(data, build) {
    const S = data.champion.spells;
    const has = (k) => build.augments.includes(k);
    const v = (k, name, def) => ((aug(data, k) || {}).values || {})[name] ?? def;
    const awaken = has("UltimateAwakening");
    const ultHaste = (+build.ultHaste || 0)
      + (awaken ? v("UltimateAwakening", "AH", 30) : 0)
      + (has("UltimateRecursion") ? v("UltimateRecursion", "UltimateHaste", 50) : 0);
    const purist = has("ARAM_Purist_Caster") ? v("ARAM_Purist_Caster", "CooldownReduction", 0.1) : 0;
    return {
      R: S.R.cooldown[build.rRank - 1],
      E: S.E.recharge[build.eRank - 1],
      eGap: S.E.cooldown[build.eRank - 1],
      charges: S.E.charges || 2,
      W: build.wRank > 0 ? S.W.cooldown[build.wRank - 1] : 0,
      cast: Math.max(0, build.castTime ?? S.R.castTime ?? 0.25),
      haste: Math.max(0, +build.haste || 0),
      ultHaste,
      eHaste: has("ARAM_BreadAndCheese") ? v("ARAM_BreadAndCheese", "EAbilityHaste", 100) : 0,
      purist,
      archmage: has("ARAM_Archmage") ? v("ARAM_Archmage", "RefundPercent", 0.3) : 0,
      awaken: awaken && { haste: v("UltimateAwakening", "AdditionalHaste", 300), buff: v("UltimateAwakening", "BuffDuration", 15), cd: v("UltimateAwakening", "Cooldown", 20) },
      revolution: has("ARAM_UltimateRevolution") ? v("ARAM_UltimateRevolution", "Cooldown", 75) : 0,
      punch: has("ARAM_MysticPunch") && build.attackSpeed > 0
        ? { every: 1 / build.attackSpeed, cut: v("ARAM_MysticPunch", "CooldownRefund", 1.25), floor: v("ARAM_MysticPunch", "MinCDR", 0.5) }
        : null,
      castW: build.castW !== false && build.wRank > 0,
      onlyOnCooldown: !!build.onlyOnCooldown,
      afterCast: build.cdAfterCast !== false,
      carry: build.carryRefund !== false,
    };
  }

  // Seconds an ability's cooldown lasts with this much haste: base x 100 / (100 + haste), less Purist's 10% of the
  // base cooldown. The game caps total haste at 500.
  const hasted = (base, haste, purist = 0) => Math.max(0, base * (100 / (100 + Math.min(500, haste)) - purist));

  // Shortest time between two Hawkshots at this basic haste: the gap (5 s, shortened by haste), which starts when the
  // cast ends, and never less than two cast times (an R and a Hawkshot).
  const period = (p, haste) => Math.max(hasted(p.eGap, haste + p.eHaste, p.purist) + (p.afterCast ? p.cast : 0), 2 * p.cast);

  // One fight of `seconds`, casting R whenever it is up, then Hawkshot, then Volley. Cooldowns are kept as the
  // share of the full cooldown still left (1 = just cast), so a change in haste mid-fight (Ultimate Awakening)
  // speeds up what is left, as in game. Refunds are flat seconds: haste doesn't shrink them.
  function fight(p, seconds, seed) {
    const rand = rng(seed);
    let t = 0, free = 0;
    let r = 0, w = 0;                       // share of R's and W's cooldown left
    let charges = p.charges, e = 0;          // E charges and share of the recharge left (only while not full)
    let eGapUntil = 0, buffUntil = -1, awakenAt = 0, revolutionAt = 0;
    let nextHit = p.punch ? p.punch.every : Infinity;
    const rCasts = [], eCasts = [];
    let most = 0;                            // Hawkshots the gap alone would allow after the first minute

    const basicHaste = () => p.haste + (t < buffUntil ? p.awaken.haste : 0);
    const len = {
      R: () => hasted(p.R, p.haste + p.ultHaste, p.purist),
      E: () => hasted(p.E, basicHaste() + p.eHaste, p.purist),
      W: () => hasted(p.W, basicHaste(), p.purist),
    };
    // Cooldowns start when the cast ends (the game's rule for most abilities), unless the setting says on press:
    // the cooldown's share is then a little over 1 at the moment of casting.
    const after = (full) => (p.afterCast ? p.cast / full : 0);
    const left = { R: () => r * len.R(), E: () => (charges < p.charges ? e * len.E() : 0), W: () => w * len.W() };
    // Take `sec` seconds off an ability's cooldown; `floor` keeps that much of what's left (Mystic Punch).
    function cut(key, sec, floor = 0) {
      const now = left[key]();
      if (now <= 0) return;
      // A refund bigger than what is left of Hawkshot's recharge gives a charge and the rest goes into the next one.
      if (key === "E" && p.carry && !floor && sec > now) {
        let rest = sec - now;
        gainCharge();
        while (charges < p.charges && rest > 0) {
          const full = len.E();
          if (rest < full - 1e-6) { e = 1 - rest / full; rest = 0; } else { rest -= full; gainCharge(); }
        }
        return;
      }
      let after = Math.max(now - sec, Math.min(now, floor));
      if (after < 1e-6) after = 0;
      if (key === "R") r = after / len.R();
      else if (key === "W") w = after / len.W();
      else if (after <= 0) gainCharge();
      else e = after / len.E();
    }
    function gainCharge() {
      charges++;
      e = charges < p.charges ? 1 : 0;
    }
    function archmage(cast, base) {
      if (!p.archmage) return;
      // Ashe's Q has no cooldown, so a refund landing on it does nothing.
      let pool = ["Q", "W", "E", "R"].filter((k) => k !== cast);
      if (p.onlyOnCooldown) pool = pool.filter((k) => k !== "Q" && left[k]() > 0);
      if (!pool.length) return;
      const pick = pool[Math.floor(rand() * pool.length)];
      if (pick !== "Q") cut(pick, p.archmage * base);
    }

    while (t < seconds) {
      if (t >= free - 1e-9) {
        if (r <= 1e-9) {
          rCasts.push(t);
          free = t + p.cast;
          r = 1 + after(len.R());
          if (p.awaken && t >= awakenAt) {
            charges = p.charges; e = 0; eGapUntil = t; w = 0;
            buffUntil = t + p.awaken.buff; awakenAt = t + p.awaken.cd;
          }
          if (p.revolution && t >= revolutionAt) { r = 0; revolutionAt = t + p.revolution; }
          archmage("R", p.R);
          continue;
        }
        if (charges > 0 && t >= eGapUntil - 1e-9) {
          eCasts.push(t);
          free = t + p.cast;
          if (charges === p.charges) e = 1 + after(len.E());
          charges--;
          // The 5 s between Hawkshot casts is an ammo cooldown, which ability haste shortens like any other.
          eGapUntil = t + (p.afterCast ? p.cast : 0) + hasted(p.eGap, basicHaste() + p.eHaste, p.purist);
          archmage("E", p.E);
          continue;
        }
        if (p.castW && w <= 1e-9) {
          free = t + p.cast;
          w = 1 + after(len.W() || 1);
          archmage("W", p.W);
          continue;
        }
      }
      // Jump to the next moment something changes.
      const next = Math.min(
        seconds,
        free > t ? free : Infinity,
        r > 0 ? t + left.R() : Infinity,
        charges < p.charges ? t + left.E() : Infinity,
        charges > 0 && eGapUntil > t ? eGapUntil : Infinity,
        p.castW && w > 0 ? t + left.W() : Infinity,
        buffUntil > t ? buffUntil : Infinity,
        nextHit,
      );
      const dt = Math.max(0, next - t);
      if (t >= 60) most += dt / period(p, basicHaste());
      // Cooldowns run at the current haste until `next`.
      const lr = len.R(), le = len.E(), lw = len.W() || 1;
      // Anything within a microsecond of ready is ready (keeps rounding from stalling the clock).
      r = Math.max(0, r - dt / lr);
      if (r * lr < 1e-6) r = 0;
      if (p.castW || w > 0) w = Math.max(0, w - dt / lw);
      if (w * lw < 1e-6) w = 0;
      if (charges < p.charges) {
        e -= dt / le;
        if (e * le < 1e-6) gainCharge();
      }
      t = next;
      if (t >= nextHit - 1e-9) {
        // A basic attack lands between casts (attacks wait while a spell is being cast).
        if (t >= free - 1e-9) {
          for (const k of ["R", "E", "W"]) cut(k, p.punch.cut, p.punch.floor);
          nextHit = t + p.punch.every;
        } else nextHit = free;
      }
    }
    return { rCasts, eCasts, most };
  }

  // Average over `runs` fights. Counts the first minute and the minutes after it (the steady rate).
  function compute(data, build, opts = {}) {
    const p = setup(data, build);
    const runs = opts.runs ?? 120, minutes = opts.minutes ?? 6;
    const random = p.archmage && !(p.onlyOnCooldown && !p.castW);
    const n = random ? runs : 1;
    let first = 0, later = 0, eLater = 0, most = 0;
    for (let i = 0; i < n; i++) {
      const f = fight(p, minutes * 60, 1 + i * 7919);
      first += f.rCasts.filter((x) => x < 60).length;
      most += f.most;
      later += f.rCasts.filter((x) => x >= 60).length;
      eLater += f.eCasts.filter((x) => x >= 60).length;
    }
    const perMinute = later / n / (minutes - 1);
    const ePerMinute = eLater / n / (minutes - 1);
    return {
      perMinute,
      firstMinute: first / n,
      every: perMinute > 0 ? 60 / perMinute : Infinity,
      ePerMinute,
      // Hawkshot can't be cast more often than once per gap (5 s, shortened by haste), so that many R per minute
      // is a full loop: R comes back for every Hawkshot and the loop never stops on its own.
      // (Ultimate Awakening's 300 haste shortens the gap while it lasts.)
      maxPerMinute: most / n / (minutes - 1),
      loop: most > 0 ? Math.min(1, later / most) : 0,
      cooldowns: {
        R: hasted(p.R, p.haste + p.ultHaste, p.purist),
        E: hasted(p.E, p.haste + p.eHaste, p.purist),
        W: p.W ? hasted(p.W, p.haste, p.purist) : 0,
      },
      refunds: { fromE: p.archmage * p.E, fromR: p.archmage * p.R, fromW: p.archmage * p.W },
    };
  }

  // R per minute across a range of haste, for the chart.
  function curve(data, build, { from = 0, to = 500, step = 10, runs = 40 } = {}) {
    const out = [];
    for (let h = from; h <= to; h += step) out.push({ haste: h, perMinute: compute(data, { ...build, haste: h }, { runs }).perMinute });
    return out;
  }

  // The haste from which the loop is at least `share` full (R back for nearly every Hawkshot) and stays that way up to `to`.
  function threshold(data, build, { share = 0.9, to = 500, step = 5, runs = 40 } = {}) {
    let found = null;
    for (let h = to; h >= 0; h -= step) {
      if (compute(data, { ...build, haste: h }, { runs }).loop >= share) found = h;
      else break;
    }
    return found;
  }

  const api = { compute, curve, threshold, setup, fight, hasted };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AsheCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
