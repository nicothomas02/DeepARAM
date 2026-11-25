// Infinite Graves math. Pure functions, no DOM, so the page and tests share them.
//
// Quickdraw (E): every pellet that hits an enemy takes 0.5 s off its cooldown. A shot fires 4 pellets (6 on a crit).
// Quickdraw reloads a shell and resets Graves' attack, so he can dash and shoot again at once. Mystic Punch takes
// 1.25 s off every cooldown per enemy a shot hits (only the first pellet on each enemy applies on-hit), never leaving
// less than 0.5 s. Archmage refunds 30% of a cast's base cooldown to another random ability on cooldown, so casting
// End of the Line (Q) and Smoke Screen (W) feeds Quickdraw too.
//
// The loop is closed when Graves never reloads: Quickdraw is back before the clip runs dry, every time.
(function (root) {
  "use strict";

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
  const hasted = (base, haste, purist = 0) => Math.max(0, base * (100 / (100 + Math.min(HASTE_CAP, haste)) - purist));

  function statAt(base, growth, level) {
    const n = level - 1;
    return base + growth * n * (0.7025 + 0.0175 * n);
  }
  function baseMana(data, level = 18) {
    const c = data.champion;
    return { max: statAt(c.baseMana, c.manaPerLevel, level), regen5: 5 * statAt(c.manaRegen, c.manaRegenPerLevel, level) };
  }

  // Seconds to reload both shells at this attack speed. 2.08 s with no bonus attack speed, down to the level-18 cap
  // (1 / 0.891 s) at 150% bonus attack speed, in a straight line between (an estimate: the in-between isn't documented).
  function reloadTime(A, attackSpeed) {
    const bonus = Math.max(0, (attackSpeed - A.baseAS) / A.ratioAS);
    const share = Math.min(1, bonus / A.reloadCapBonusAS);
    const slow = A.reload2, fast = 1 / A.reloadCap;
    return slow - (slow - fast) * share;
  }

  // build: { qRank, wRank, eRank 1-5, rRank 1-3, haste, attackSpeed, crit (0-1), pellets (1-4 that hit), targets (1-4
  //          enemies per shot), castQ, castW, castR, maxMana, regen5, augments: [key...] }
  function setup(data, build) {
    const S = data.champion.spells;
    const A = data.champion.attack;
    const has = (k) => build.augments.includes(k);
    const v = (k, name, def) => ((aug(data, k) || {}).values || {})[name] ?? def;
    const rank = (r, def, top = 5) => Math.min(top, Math.max(1, Math.round(+r || def))) - 1;
    const i = { Q: rank(build.qRank, 1), W: rank(build.wRank, 1), E: rank(build.eRank, 5), R: rank(build.rRank, 3, 3) };
    const base = {};
    for (const k of KEYS) base[k] = S[k].cooldown[i[k]];
    const asked = Math.min(2.5, Math.max(0.2, +build.attackSpeed || A.baseAS));
    // Purist - Caster turns all bonus attack speed into ability haste (0.65 per 1%), so Graves shoots and reloads at
    // his base speed.
    const purist = has("ARAM_Purist_Caster");
    const bonusPct = Math.max(0, (asked - A.baseAS) / A.ratioAS) * 100;
    const converted = purist ? v("ARAM_Purist_Caster", "Haste_Per_AS", 0.65) * bonusPct : 0;
    const attackSpeed = purist ? Math.min(asked, A.baseAS) : asked;
    const awaken = has("UltimateAwakening");
    const m = baseMana(data);
    const clamp = (x, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(x ?? def)));
    return {
      base, i,
      haste: Math.max(0, +build.haste || 0) + converted,
      converted,
      bonus: { Q: 0, W: 0, E: has("ARAM_BreadAndCheese") ? v("ARAM_BreadAndCheese", "EAbilityHaste", 100) : 0, R: awaken ? v("UltimateAwakening", "AH", 30) : 0 },
      purist: purist ? v("ARAM_Purist_Caster", "CooldownReduction", 0.1) : 0,
      cast: { Q: S.Q.castTime ?? 0.25, W: S.W.castTime ?? 0.25, E: S.E.castTime ?? 0.4, R: S.R.castTime ?? 0.25 },
      cost: { Q: S.Q.mana[i.Q] || 0, W: S.W.mana[i.W] || 0, E: S.E.mana[i.E] || 0, R: S.R.mana[i.R] || 0 },
      attackEvery: 1 / attackSpeed,
      attackSpeed,
      reload: reloadTime(A, attackSpeed),
      crit: Math.min(1, Math.max(0, +build.crit || 0)),
      pellets: clamp(build.pellets, 1, A.pellets, A.pellets),
      critPellets: A.critPellets,
      targets: clamp(build.targets, 1, 4, 1),
      cutPerPellet: S.E.cutPerPellet ?? 0.5,
      armor: (S.E.armorPerStack || [])[i.E] * (S.E.maxStacks || 8),
      cast_: { Q: !!build.castQ, W: !!build.castW, R: !!build.castR },
      archmage: has("ARAM_Archmage") ? v("ARAM_Archmage", "RefundPercent", 0.3) : 0,
      awaken: awaken && { haste: v("UltimateAwakening", "AdditionalHaste", 300), buff: v("UltimateAwakening", "BuffDuration", 15), cd: v("UltimateAwakening", "Cooldown", 20) },
      punch: has("ARAM_MysticPunch") ? { cut: v("ARAM_MysticPunch", "CooldownRefund", 1.25), floor: v("ARAM_MysticPunch", "MinCDR", 0.5) } : null,
      maxMana: build.maxMana > 0 ? +build.maxMana : m.max,
      regen: (build.regen5 >= 0 && build.regen5 !== "" && build.regen5 != null ? +build.regen5 : m.regen5) / 5,
    };
  }

  // One fight of `seconds`. Graves shoots whenever a shell and his attack are ready, dashes with Quickdraw when it is
  // up and dashing is quicker than waiting (for the attack timer, or for the reload), and casts Q, W or R on cooldown
  // if set.
  function fight(p, seconds, seed, mana = true) {
    const rand = rng(seed);
    let t = 0, free = 0, pool = p.maxMana, manaOut = Infinity;
    let shells = 2, reloadAt = Infinity, attackAt = 0, buffUntil = -1, awakenAt = 0;
    const share = { Q: 0, W: 0, E: 0, R: 0 };
    const log = { shots: [], E: [], Q: [], W: [], R: [], reloads: [] };

    const len = (k) => hasted(p.base[k], p.haste + (k !== "R" && t < buffUntil ? p.awaken.haste : 0) + p.bonus[k], p.purist);
    const left = (k) => share[k] * len(k);
    function cut(k, sec, floor = 0) {
      const now = left(k);
      if (now <= 0) return;
      let after = Math.max(now - sec, Math.min(now, floor));
      if (after < 1e-6) after = 0;
      share[k] = len(k) > 0 ? after / len(k) : 0;
    }
    function archmage(k) {
      if (!p.archmage) return;
      const others = KEYS.filter((x) => x !== k && left(x) > 0);
      if (!others.length) return;
      cut(others[Math.floor(rand() * others.length)], p.archmage * p.base[k]);
    }
    const afford = (k) => !mana || pool >= p.cost[k] - 1e-9;
    const ready = (k) => share[k] <= 1e-9;
    function cast(k) {
      if (mana) pool -= p.cost[k];
      free = t + p.cast[k];
      share[k] = len(k) > 0 ? 1 + p.cast[k] / len(k) : 0;
      log[k].push(t);
      archmage(k);
    }
    function shoot() {
      shells--;
      if (shells === 0) reloadAt = t + p.reload;
      attackAt = t + p.attackEvery;
      log.shots.push(t);
      const pellets = rand() < p.crit ? Math.max(p.pellets, Math.round(p.pellets * p.critPellets / 4)) : p.pellets;
      cut("E", pellets * p.cutPerPellet);
      if (p.punch) for (let n = 0; n < p.targets; n++) for (const k of KEYS) cut(k, p.punch.cut, p.punch.floor);
    }

    while (t < seconds) {
      if (t >= reloadAt - 1e-9) { shells = 2; reloadAt = Infinity; log.reloads.push(t); }
      if (t >= free - 1e-9) {
        let did = true;
        const canShoot = shells > 0 && t >= attackAt - 1e-9;
        if (p.cast_.R && ready("R") && afford("R")) {
          cast("R");
          if (p.awaken && t >= awakenAt) { share.Q = 0; share.W = 0; share.E = 0; buffUntil = t + p.awaken.buff; awakenAt = t + p.awaken.cd; }
        } else if (canShoot) shoot();
        // Quickdraw only when dashing is quicker than waiting for the attack timer (or for the reload).
        else if (ready("E") && afford("E") && (shells > 0 ? attackAt : Math.max(attackAt, reloadAt)) - t > p.cast.E + 1e-9) {
          // Quickdraw: dash, reload one shell (a reload in progress is cancelled), and reset the attack.
          cast("E");
          shells = Math.min(2, shells + 1); reloadAt = Infinity; attackAt = free;
        } else if (p.cast_.Q && ready("Q") && afford("Q")) cast("Q");
        else if (p.cast_.W && ready("W") && afford("W")) cast("W");
        else did = false;
        if (did) continue;
        if (mana && manaOut === Infinity && ready("E") && !afford("E")) manaOut = t;
      }
      const need = mana && pool < p.cost.E && ready("E") ? t + (p.cost.E - pool) / (p.regen || 1e-9) : Infinity;
      const next = Math.min(
        seconds,
        free > t ? free : Infinity,
        ...KEYS.map((k) => (share[k] > 0 ? t + left(k) : Infinity)),
        attackAt > t ? attackAt : Infinity,
        reloadAt,
        buffUntil > t ? buffUntil : Infinity,
        need,
      );
      const dt = Math.max(1e-6, next - t);
      for (const k of KEYS) { const l = len(k); share[k] = l > 0 ? Math.max(0, share[k] - dt / l) : 0; if (share[k] < 1e-9) share[k] = 0; }
      if (mana) pool = Math.min(p.maxMana, pool + p.regen * dt);
      t += dt;
    }
    return { ...log, manaOut };
  }

  function compute(data, build, opts = {}) {
    const p = setup(data, build);
    const runs = opts.runs ?? 30, minutes = opts.minutes ?? 4;
    const n = p.archmage || p.crit > 0 ? runs : 1;
    const late = (arr) => arr.filter((x) => x >= 60).length;
    let shots = 0, es = 0, reloads = 0, mShots = 0, manaOut = 0;
    let plainShots = 0;
    for (let i = 0; i < n; i++) {
      const f = fight(p, minutes * 60, 1 + i * 7919, false);
      shots += late(f.shots); es += late(f.E); reloads += late(f.reloads);
      if (opts.mana !== false) {
        const g = fight(p, minutes * 60, 1 + i * 7919, true);
        mShots += late(g.shots);
        manaOut += Math.min(g.manaOut, minutes * 60);
      }
    }
    // Shots a minute with no Quickdraw at all: two shots, then a reload.
    plainShots = 60 * 2 / (p.attackEvery + Math.max(p.attackEvery, p.reload));
    const per = (x) => x / n / (minutes - 1);
    const len = (k) => hasted(p.base[k], p.haste + p.bonus[k], p.purist);
    const ePer = per(es), sPer = per(shots);
    return {
      // Shots a minute: the headline. Quickdraw's reload and attack reset push it past the plain rate.
      perMinute: sPer,
      quickdrawsPerMinute: ePer,
      reloadsPerMinute: per(reloads),
      plainShotsPerMinute: plainShots,
      // Share of reloads Quickdraw replaces: 0 = a full reload after every two shots, 1 = never reloads.
      loop: sPer > 0 ? Math.max(0, Math.min(1, 1 - per(reloads) / (sPer / 2))) : 0,
      cooldowns: { Q: len("Q"), W: len("W"), E: len("E"), R: len("R") },
      cutPerShot: p.pellets * p.cutPerPellet + (p.punch ? p.punch.cut * p.targets : 0),
      reload: p.reload,
      armor: p.armor,
      cost: p.cost,
      withMana: { perMinute: per(mShots), lastsFor: manaOut / n, runsOut: manaOut / n < minutes * 60 },
      maxMana: p.maxMana,
      regen5: p.regen * 5,
    };
  }

  function curve(data, build, { from = 0, to = 500, step = 10, runs = 6, minutes = 2 } = {}) {
    const out = [];
    for (let h = from; h <= to; h += step) {
      const r = compute(data, { ...build, haste: h }, { runs, minutes, mana: false });
      out.push({ haste: h, perMinute: r.perMinute, loop: r.loop });
    }
    return out;
  }

  // The lowest haste from which Quickdraw replaces at least `share` of reloads, up to `to`, or null.
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

  const api = { compute, curve, threshold, setup, fight, hasted, baseMana, statAt, reloadTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GravesCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
