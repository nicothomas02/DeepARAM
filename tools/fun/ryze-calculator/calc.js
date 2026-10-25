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
    let awe = 0, riftRatio = 0, hpPerBonusMana = 0, hpPerMana = 0;
    const addAP = (label, v) => { if (v) { flatAP += v; sources.push({ label, kind: "ap", value: v }); } };
    const addAmp = (label, v) => { if (v) { amp += v; sources.push({ label, kind: "amp", value: v }); } };

    for (const it of items) {
      addAP(it.name, it.ap);
      flatMana += it.mana;
      flatHP += it.hp;
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
          break;
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
        case "ARAM_MindtoMatter": hpPerMana += c.ManaToHealthCalc.manaRatio; break;
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

    // AP when the loop contributes nothing beyond AP = 0's mana (the starting point).
    function apFrom(ap) {
      const maxMana = M * (1 + p * ap);
      const bonusMana = maxMana - baseMana;
      const maxHP = (baseHP + flatHP + hpPerMana * maxMana + hpPerBonusMana * bonusMana) * hpMult;
      const bonusHP = maxHP - baseHP;
      return { ap: (flatAP + awe * bonusMana + riftRatio * bonusHP) * mult, maxMana, bonusMana, maxHP, bonusHP };
    }

    const start = apFrom(0).ap; // = intercept of the line
    const infinite = loopGain >= 1;
    const finalAP = infinite ? Infinity : start / (1 - loopGain);

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
    const dmgMult = (1 + overflow) * (1 + actualizer);

    const spells = {};
    for (const [k, s] of Object.entries(champ.spells)) {
      const ap5 = at.ap;
      spells[k] = (s.base[4] + s.apRatio * ap5 + s.bonusManaRatio * at.bonusMana) * dmgMult;
    }

    return {
      level: L, baseMana, baseHP, flatAP, flatMana, flatHP, amp, hpAmp, awe, riftRatio, hpPerMana, hpPerBonusMana,
      loopGain, infinite, start, finalAP, rounds, manaForInfinite, currentManaPool: M,
      maxMana: at.maxMana, bonusMana: at.bonusMana, maxHP: at.maxHP, bonusHP: at.bonusHP,
      passivePct: infinite ? Infinity : p * finalAP,
      aweAP: awe * at.bonusMana * mult, riftAP: riftRatio * at.bonusHP * mult,
      overflow, actualizer, spells, sources,
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
