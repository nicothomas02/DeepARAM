// Picks the animation clips the fight replay plays from a champion model's clip names.
// Used by the model builder, which keeps only these clips in the built models.
//
// Names vary by champion (Spell4 vs Spell4_NoMove, Idle1 vs Idle_Base, Zed_idle1.anm,
// PunkGenius_Idle01.anm), so exact names are tried first, then the same words after a
// champion or skin prefix.
//
// Returns {clips, extra, after}:
//   clips: {idle, run, attack, crit, Q, W, E, R, stunned, death, dance, respawn, laugh, taunt, joke,
//          knockup, haste}, one name each (or null)
//   extra: {idle: [...], attack: [...], Q: [...], ...}, other versions of the same move,
//          played in turn (idle variations, Yasuo's three Q swings, Lux's other idles)
//   after: {Q: name, ...}, the clip that finishes an ability back into idle (Spell4_toIdle)
const TRANSITION = /_to_|to_?idle|to_?run|2idle|2run|_in\d*$|idle_?in|run_?in|lead_?in|leadout|intro|enter|exit|winddown|wndup|windup|_back$|_out$|_in_raw/;
const ANGLE = /_-?(0|45|90|135|180)$|_(north|south|east|west)$/;
const SKIP = /homeguard|haste|recall|dance|joke|taunt|laugh|respawn|channel|sheath|knockup|_ult|_idle$|_loop$/;

export function pickClips(names) {
  const clean = (n) => n.replace(/\.anm$/i, "").toLowerCase();
  const list = names.map((n) => ({ n, c: clean(n) }));
  const transition = (c) => TRANSITION.test(c);
  const find = (...patterns) => {
    for (const p of patterns) {
      const hit = list.find(({ c }) => (p instanceof RegExp ? p.test(c) : c === p) && !transition(c));
      if (hit) return hit.n;
    }
    return null;
  };
  const spell = (k) => find(`spell${k}`, `spell${k}_base`, `spell${k}_cast`, `spell${k}a`, `spell${k}_nomove`,
    new RegExp(`^spell${k}(_|$)`), new RegExp(`(^|_)spell${k}(_base|_cast)?$`), new RegExp(`spell${k}`));
  const clips = {
    idle: find("idle1", "idle_base", "idle1_base", "idle", /^idle/, /(^|_)idle0?1(_base|_raw)?$/, /(^|_)idle\d*(_base|v\d|_raw)?$/),
    run: find("run_base", "run", "run1", /^run(?!_homeguard|_slow)/, /(^|_)run(1|_base)?$/),
    attack: find("attack1", "attack_1", /^attack/, /(^|_)attack_?1$/, /(^|_)attack\d*$/),
    crit: find("crit1", "crit", /^crit/, /(^|_)crit(_base)?$/),
    Q: spell(1), W: spell(2), E: spell(3), R: spell(4),
    stunned: find("stunned", "stun", /stun/),
    death: find("death", /^death/, /(^|_)death/),
    dance: find("dance_loop", "dance_loop_base", "dance_base", "dance", /(^|_)dance(_loop)?(_base)?$/, /dance/),
    // Moves the fight has no ability for: a new enemy arriving, a kill celebrated, being knocked
    // into the air, running at a burst of speed.
    respawn: find("respawn", "respawn_base", /(^|_)respawn(_base)?$/),
    laugh: find("laugh", "laugh_base", /(^|_)laugh(_base|_loop)?$/, /laugh/),
    taunt: find("taunt", "taunt_base", "taunt_loop", /(^|_)taunt(_base|_loop)?$/, /taunt(?!_into)/),
    joke: find("joke", "joke_base", /(^|_)joke(_base|_loop)?$/, /joke/),
    knockup: find("knockup", "knock_up", /(^|_)knock_?up(_base)?$/, /knock_?up/),
    haste: find("run_haste", "run_haste_base", /(^|_)run_?haste(_base)?$/),
  };

  // Other versions of the same move, in name order: one idle and one attack variation, up to
  // two more versions of each ability (kept few so the built models stay small).
  // The same clip sometimes appears twice, with and without a champion prefix (riven_spell1a.anm).
  const bare = (c) => c.replace(/^[a-z0-9]+_(?=(idle|attack|spell|run|crit))/, "");
  const family = (re, main, max) => {
    const seen = new Set([main && bare(clean(main))]), out = [];
    for (const { n, c } of [...list].sort((a, b) => a.c.length - b.c.length || a.n.localeCompare(b.n))) {
      if (n === main || !re.test(c) || transition(c) || ANGLE.test(c) || SKIP.test(c) || seen.has(bare(c))) continue;
      seen.add(bare(c)); out.push(n);
    }
    return out.sort().slice(0, max);
  };
  const extra = {
    idle: family(/(^|_)idle_?(var)?\d/, clips.idle, 1),
    attack: family(/(^|_)attack_?\d$/, clips.attack, 1),
  };
  const after = {};
  for (const [slot, k] of [["Q", 1], ["W", 2], ["E", 3], ["R", 4]]) {
    if (!clips[slot]) continue;
    extra[slot] = family(new RegExp(`(^|_)spell${k}(_?[a-d]|_\\d|_dash|_2nd|_3rd)?$`), clips[slot], 2);
    const end = list.find(({ c }) => new RegExp(`(^|_)spell${k}(_base)?_?to_?idle(_\\d)?$`).test(c));
    if (end) after[slot] = end.n;
  }
  for (const k of Object.keys(extra)) if (!extra[k].length) delete extra[k];
  return { clips, extra, after };
}
