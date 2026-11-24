// Infinite Ryze math. Pure functions, no DOM, so the page and tests share them.
//
// Ryze's passive turns AP into max Mana, and Seraph's Embrace, Riftmaker (through Mind to Matter
// or Fimbulwinter health) turn Mana back into AP. Every stat here is linear in AP, so the loop is
//   AP = start + loopGain * AP
// and settles at start / (1 - loopGain). At loopGain >= 1 the loop never settles: infinite AP.
(function (root) {
  "use strict";

  // League's per-level stat growth: base + growth * (n - 1) * (0.7025 + 0.0175 * (n - 1))
  function statAt(base, growth, level) {
    const n = level - 1;
    return base + growth * n * (0.7025 + 0.0175 * n);
  }

  // Breakdown labels in the page's language when the translations are loaded (i18n.js), else English.
  const tr = (s, v) => (root.LabI18n ? root.LabI18n.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => v[k]));

  const HASTE_CAP = 500;

  function lerpLevel(calc, level) {
    return calc.lvl1 + (calc.lvl18 - calc.lvl1) * (level - 1) / 17;
  }

  // build: { level, items: [id...], augments: [key...], opts: {...}, extra: {ap, mana, hp} }
  function compute(data, build) {
    const champ = data.champion;
    const L = build.level;
    const opts = build.opts || {};
    const extra = build.extra || {};
    const items = build.items.map((id) => data.items.find((i) => i.id === id)).filter(Boolean);
    const augs = build.augments.map((k) => data.augments.find((a) => a.key === k)).filter(Boolean);
    const has = (key) => augs.some((a) => a.key === key);

    const baseMana = statAt(champ.baseMana, champ.manaPerLevel, L);
    const baseHP = statAt(champ.baseHP, champ.hpPerLevel, L);

    // Flat sources. sources[] feeds the breakdown table.
    const sources = [];
    let flatAP = 0, flatMana = 0, flatHP = 0, amp = 0, hpAmp = 0;
    let awe = 0, riftRatio = 0, hpPerBonusMana = 0, hpPerMana = 0, haste = 0, apToHaste = 0, mtmCap = Infinity;
    const addAP = (label, v) => { if (v) { flatAP += v; sources.push({ label, kind: "ap", value: v }); } };
    const addAmp = (label, v) => { if (v) { amp += v; sources.push({ label, kind: "amp", value: v }); } };

    for (const it of items) {
      addAP(it.name, it.ap);
      flatMana += it.mana;
      flatHP += it.hp;
      haste += it.haste || 0;
      const v = it.values;
      if (v.APFromMana) awe += v.APFromMana;                       // Seraph's / Archangel's Awe
      if (v.APAmp) addAmp(it.name, v.APAmp);                       // Rabadon's / Wooglet's Magical Opus
      if (v.HealthToAPConversionPercent) riftRatio += v.HealthToAPConversionPercent; // Riftmaker
      if (it.calcs.BonusHPFromMana) hpPerBonusMana += it.calcs.BonusHPFromMana.manaRatio; // Fimbulwinter
      if (it.id === 6657) {                                        // Rod of Ages stacks
        const s = clamp(opts.rodStacks ?? v.MaxStacks, 0, v.MaxStacks);
        addAP(tr("{name} stacks", { name: it.name }), s * v.APPerStack);
        flatMana += s * v.ManaPerStack;
        flatHP += s * v.HealthPerStack;
      }
      if (it.id === 3041) {                                        // Mejai's Glory
        const g = clamp(opts.glory ?? v.MaxGloryStacks, 0, v.MaxGloryStacks);
        addAP(tr("{name} Glory", { name: it.name }), g * v.APPerGlory);
      }
      if (it.id === 2503) {                                        // Blackfire Torch
        const n = clamp(opts.blackfireTargets ?? 3, 0, 7);
        addAmp(tr("{name} ({n} burning)", { name: it.name, n }), n * v.APPerStack);
      }
    }

    for (const a of augs) {
      const v = a.values, c = a.calcs;
      switch (a.key) {
        case "ARAM_WitchfulThinking": addAP(a.name, lerpLevel(c.AP, L)); break;
        case "OminousPact": addAP(a.name, lerpLevel(c.APPerLevel, L)); break;
        case "ARAM_Goliath": addAmp(a.name, v.AFAmp); hpAmp += v.HealthAmp; break;
        case "HandOfBaron": addAmp(a.name, v.AFAmp); break;
        case "ARAM_MadScientist":
          if (opts.madLarge !== false) { addAmp(tr("{name} (large)", { name: a.name }), v.APAmp); hpAmp += v.HealthAmp; }
          else haste += v.Haste || 0;
          break;
        // Lich Brain: 30 AP + 4% bonus Health as AP.
        case "LichBrain": addAP(a.name, v.FlatAP ?? 30); riftRatio += v.BonusHealthToAP ?? 0.04; break;
        case "ARAM_CelestialBody": flatHP += v.Health; break;
        case "DoubleTime": flatMana += Math.max(0, opts.doubleTimeStacks ?? 0) * (v.ManaGain ?? 25); break;
        case "ARAM_Eureka": apToHaste += v.APToHasteConversion; break;
        case "ARAM_ADAPt": addAmp(a.name, v.APAmp); break;
        case "ARAM_PhenomenalEvil": {
          const procs = Math.max(0, opts.evilStacks ?? 100);
          addAP(a.name, procs * v.APPerProc + (opts.evilSecond ? v.StartingAPIfSecondAugment : 0));
          break;
        }
        case "ARAM_MasterofDuality":
          addAP(a.name, Math.max(0, opts.dualityStacks ?? 5) * lerpLevel(c.APGained, L));
          break;
        case "ARAM_SlapAround": addAP(a.name, Math.max(0, opts.slapStacks ?? 10) * v.AdaptiveForce); break;
        case "MightyShield": if (opts.shielded !== false) addAP(tr("{name} (shielded)", { name: a.name }), lerpLevel(c.AdaptiveAmp, L)); break;
        case "ARAM_ImTheJuggernaut": if (opts.juggernaut !== false) addAP(tr("{name} (max stacks)", { name: a.name }), lerpLevel(c.Calc_AF, L)); break;
        case "ARAM_MindtoMatter": hpPerMana += c.ManaToHealthCalc.manaRatio; mtmCap = v.ConvertCap ?? 99999; break;
      }
    }

    addAP(tr("Stat anvils / other", {}), +extra.ap || 0);
    flatMana += +extra.mana || 0;
    flatHP += +extra.hp || 0;

    // Linear model in AP:
    //   maxMana  = M * (1 + p*AP)             M = base + flat mana, p = passive % per AP
    //   bonusMana = maxMana - baseMana
    //   maxHP    = (baseHP + flatHP + hpPerMana*maxMana + hpPerBonusMana*bonusMana) * (1 + hpAmp)
    //   bonusHP  = maxHP - baseHP
    //   AP       = (flatAP + awe*bonusMana + riftRatio*bonusHP) * (1 + amp)
    const p = champ.passiveManaPctPer100AP / champ.passiveAPStep;
    const M = baseMana + flatMana;
    const mult = 1 + amp;
    const hpMult = 1 + hpAmp;
    // Mana-to-AP rate per point of max Mana gained, through every route.
    const apPerMana = awe + riftRatio * hpMult * (hpPerMana + hpPerBonusMana);
    const loopGain = mult * apPerMana * M * p;

    // Mind to Matter's Health stops at its cap (99,999 in the game files), so past it the loop runs on the other routes
    // only. `capped` evaluates the build with that Health fixed at the cap.
    function apFrom(ap, capped = false) {
      const maxMana = M * (1 + p * ap);
      const bonusMana = maxMana - baseMana;
      const mtm = capped ? mtmCap : Math.min(mtmCap, hpPerMana * maxMana);
      const maxHP = (baseHP + flatHP + mtm + hpPerBonusMana * bonusMana) * hpMult;
      const bonusHP = maxHP - baseHP;
      return { ap: (flatAP + awe * bonusMana + riftRatio * bonusHP) * mult, maxMana, bonusMana, maxHP, bonusHP };
    }

    const start = apFrom(0).ap; // = intercept of the line
    // Past the cap: same loop without Mind to Matter's Mana-to-Health route.
    const cappedGain = mult * (awe + riftRatio * hpMult * hpPerBonusMana) * M * p;
    // AP where Mind to Matter reaches its cap.
    const capAP = hpPerMana > 0 && isFinite(mtmCap) ? Math.max(0, (mtmCap / (hpPerMana * M) - 1) / p) : Infinity;
    let infinite = false, finalAP, capped = false;
    if (loopGain < 1 && start / (1 - loopGain) <= capAP) finalAP = start / (1 - loopGain);
    else if (cappedGain >= 1) infinite = true;
    else {
      // Settles past the cap: AP = apFrom(AP, capped), a line with slope cappedGain.
      capped = true;
      finalAP = apFrom(0, true).ap / (1 - cappedGain);
    }
    if (infinite) finalAP = Infinity;

    // Loop rounds for the chart: AP after each pass of AP -> Mana -> AP.
    const rounds = [0];
    let ap = 0;
    for (let i = 0; i < 40; i++) {
      ap = apFrom(ap).ap;
      rounds.push(ap);
      if (!isFinite(ap) || ap > 1e9) break;
    }

    const at = infinite ? apFrom(rounds[rounds.length - 1]) : apFrom(finalAP);
    // Base + flat mana needed for loopGain to reach 1.
    const manaForInfinite = mult * apPerMana * p > 0 ? 1 / (mult * apPerMana * p) : Infinity;

    const overflow = has("ARAM_Overflow") ? effectiveness(data.augments.find((a) => a.key === "ARAM_Overflow").calcs.ManaCalc, at) : 0;
    const actualizerItem = items.find((i) => i.id === 2522);
    const actualizer = actualizerItem && opts.actualizerOn ? effectiveness(actualizerItem.calcs.ManaCalc, at) : 0;
    // Celestial Body: 10% less damage dealt.
    const celestial = augs.find((a) => a.key === "ARAM_CelestialBody");
    const dmgMult = (1 + overflow) * (1 + actualizer) * (celestial ? 1 - (celestial.values.DamageReduction ?? 0.1) : 1);

    const spells = {};
    for (const [k, s] of Object.entries(champ.spells)) {
      const ap5 = at.ap;
      spells[k] = (s.base[4] + s.apRatio * ap5 + s.bonusManaRatio * at.bonusMana) * dmgMult;
    }

    // Cooldown loop: W and E reset Q. Cooldowns start when the 0.25 s cast ends (the wiki: most abilities do), so
    // E-Q-E-Q never waits once E is back within Q's cast, and the full E-Q-W-Q rotation once W and E are back within
    // three casts. The game caps total Ability Haste at 500 (wiki: Haste), so E stays at 2.5 s / 6 at best.
    const totalHaste = haste + apToHaste * (infinite ? Infinity : finalAP);
    const usedHaste = Math.min(HASTE_CAP, totalHaste);
    const cooldowns = {};
    for (const [k, s] of Object.entries(champ.spells)) {
      if (s.cooldown) cooldowns[k] = s.cooldown[4] * 100 / (100 + usedHaste);
    }
    const cast = (champ.spells.Q && champ.spells.Q.castTime) || 0.25;
    const castLoop = cooldowns.E === undefined ? "none"
      : cooldowns.W <= 3 * cast && cooldowns.E <= 3 * cast ? "full" : cooldowns.E <= cast ? "eq" : "none";
    // Seconds E-Q-E-Q waits for E each time round.
    const eqWait = cooldowns.E === undefined ? Infinity : Math.max(0, cooldowns.E - cast);

    return {
      level: L, baseMana, baseHP, flatAP, flatMana, flatHP, amp, hpAmp, awe, riftRatio, hpPerMana, hpPerBonusMana,
      loopGain, infinite, start, finalAP, rounds, manaForInfinite, currentManaPool: M,
      maxMana: at.maxMana, bonusMana: at.bonusMana, maxHP: at.maxHP, bonusHP: at.bonusHP,
      passivePct: infinite ? Infinity : p * finalAP,
      aweAP: awe * at.bonusMana * mult, riftAP: riftRatio * at.bonusHP * mult,
      overflow, actualizer, spells, sources, haste: totalHaste, hasteCapped: totalHaste > HASTE_CAP, cooldowns, castLoop, eqWait,
      capped, capAP, cappedGain,
    };
  }

  // flat% + ratio% per point of (max or bonus) Mana, times the calc's multiplier: 0.10 means 10% stronger.
  function effectiveness(calc, at) {
    const mana = calc.bonusOnly ? at.bonusMana : at.maxMana;
    return (calc.flat + calc.manaRatio * mana) * calc.multiplier;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, +v || 0)); }

  const api = { compute, statAt, lerpLevel };
  if (typeof module !== "undefined") module.exports = api;
  else root.RyzeCalc = api;
})(this);
