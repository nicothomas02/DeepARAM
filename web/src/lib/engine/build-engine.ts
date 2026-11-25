// The one build engine (Nico 2026-11-23: "build ONE shared build engine ... so they can't drift"): augment ranking,
// reroll advice, the full item path, situational and augment swaps, and the re-plan when a taken augment changes the
// build. Used by the public desktop app (apps/desktop/ui/engine.js, bundled by scripts/build-engine.mjs), Nico's PC
// app (same bundle, served at /engine/build-engine.js) and the site. Pure: no DOM, no storage, no fetch. Inputs are
// the site's public data files (augment-picks.json, overlay.json, damage-types.json, team-fit.json) plus what the
// app reads from the game.
//
// Ported from the PC companion 1.22.0 (DeepARAM-PC 30735d3), then:
// - item limits (game data) and role substitutes (public builds + archive): a path never holds two items of one limit
//   group, and a swap replaces the item it clashes with or substitutes for;
// - augments already shown can't come back that game (League Wiki, ARAM: Mayhem): reroll odds and combo potential
//   leave them out; each card can be rerolled once, so cards already rerolled are never named again;
// - counters that passed the mechanism test (research/counter-items) are real swaps; other lit situational items stay
//   pointers;
// - Weapon of Destiny: the champion's best Weapon item (AramHex real games) goes first.
//
// Every rule carries where it comes from (RULES below). Nico 2026-11-23: no rule ships on an assumption without data
// or his approval. His call the same day ("apply defaults, then test", aramhex/assumptions-audit-2026-11-23.md):
// rules with no evidence are off and come back only when a test passes; design choices (reroll threshold, which slot a
// swap replaces, shop convenience tips) stay as they are until he picks.

import augmentItemsData from "../../data/augment-items.json";
import augmentShiftData from "../../data/augment-item-shift.json";
import augmentConvertersData from "../../data/augment-converters.json";
import augmentLeanInData from "../../data/augment-lean-in.json";
import breakpointData from "../../data/breakpoints.json";
import coreStrictnessData from "../../data/core-strictness.json";

export const ENGINE_VERSION = "1.4.4";
/** Tier-1 boots (Boots, Slightly Magical Boots): owning them doesn't fill the build's boots slot. */
const TIER1_BOOTS = new Set([1001, 2422]);
/** Mayhem's Stat Bonus anvil (750 gold, permanent stat, level 9+). */
const STAT_BONUS = 220000;
/** ADAPt: converts bonus AD into AP, so AD items can fit an AP build. */
const ADAPT = 1205;

// ---------------------------------------------------------------------------------------------------------------
// Rules and where they come from

export type RuleSource = "data" | "game data" | "kit rule" | "inherited" | "assumption";
export type Rule = { source: RuleSource; on: boolean; why: string };
export const RULES: Record<string, Rule> = {
  // Backed by data or the game's own rules: on.
  itemLimits: { source: "game data", on: true, why: "The game's own-only-one groups; never broken in 1,730 public full builds or 1,245 archived games (Immolate and Hydras excepted)." },
  substitutes: { source: "data", on: true, why: "Pairs rarely built together in 101's full builds, confirmed in the archive (data/item-substitutes.json)." },
  seenAugments: { source: "game data", on: true, why: "Wiki: an augment shown once is never offered again that game." },
  rerollOnce: { source: "game data", on: true, why: "Wiki: each card can be rerolled once." },
  provenCounters: { source: "data", on: true, why: "Mechanism tests: MR items, Kaenic, Spirit Visage, Mercury's vs magic-heavy teams (the effect is clearly larger from 60-65% magic up, so 65% holds); armor vs 2+ marksmen." },
  augmentItems: { source: "data", on: true, why: "The 30 augment -> item follow patterns confirmed in the archive (data/augment-items.json; 4 added 2026-11-24 from tested outside synergy leads); payoff words only for the two with a measured gain. Nico approved 2026-11-23." },
  whyBest: { source: "data", on: true, why: "One line per item, only from tested reasons: augment trigger, most players build it, kit match (10 items with held-out R2 > 0.2), what it does (estimated). Otherwise none. Nico approved 2026-11-23." },
  luckyTilt: { source: "assumption", on: true, why: "Feeling lucky: among options whose 95% ranges overlap the leader's, rarer picks get up to +0.3 points; never past a clearly better one. Nico approved 2026-11-23." },
  nicheBuilds: { source: "data", on: true, why: "A niche build (few players build that style on the champion, but at least 2 of its items with 1,000+ games each win clearly more: above the champion's average by 1.96 standard errors, AramHex 16.22-16.23; tank left out) becomes the plan once you take an augment after which players build that style clearly more than the same champion's players without it (archive, all lobbies, z >= 4). Estimated: win rates are correlational. Nico asked 2026-11-24 (enchanter Orianna)." },
  measuredReplan: { source: "data", on: true, why: "Ethereal Weapon switches to the champion's own on-hit build (+25.9 pts on-hit build share). Only measured switches." },
  destinyFirst: { source: "data", on: true, why: "AramHex: the champion's best Weapon of Destiny item, made the first legendary." },
  upgradeLabel: { source: "game data", on: true, why: "An 'Upgrade X' augment upgrades X: said on X's line, the order doesn't change." },
  archmageRoute: { source: "kit rule", on: true, why: "AP Ashe with Archmage: Hawkshot and R refresh each other from enough Ability Haste (AramHex's guide; refunds land on abilities on cooldown, Nico chose 2026-11-24). The build reaches that haste first with the fewest of AP Ashe's own items, then the rest by DeepScore; Hawkshot stays at the rank that needs the least haste. Nico asked for it 2026-11-24." },
  critCap: { source: "game data", on: true, why: "At 100% crit or more (live crit chance), a later slot's crit item gives way to a near-tied option (inside its 95% win-rate band) with better synergy: an item a taken augment pulls in, then a kit match, then a non-crit item, whose stats and passive keep full value (Mayhem turns crit over 100% into 0.75 adaptive force per 1%, wiki). Not Yasuo or Yone: their passive also turns extra crit into AD. Archive: overcap is noise on win rate (-1.7 +- 3.7 pts). Nico approved 2026-11-24 as a tiebreak." },
  skillSplits: { source: "assumption", on: true, why: "Katarina and Kayn put 3 points in Q before maxing E (Katarina) or W (Kayn). Nico approved 2026-11-24 (his pick) after a one-time regular ARAM cross-check: the only two intentional splits that beat the champion's best standard order at levels 10 and 15 (800+ games each). Azir and Soraka (Q to 3, then max W) added by Nico the same day as weaker evidence: they lead at both levels but within luck. Dr. Mundo (Q to 3, then E), Ashe (W to 3, then Q) and Rumble (E to 3, then Q) added by Nico for their kit logic; about even on win rate. Kha'Zix and Sona (Q to 3, then W), Vayne and Smolder (W to 3, then Q) chosen by Nico too: about even, with a kit reason. Shown as estimated; no stats of its own." },
  splitAugments: { source: "assumption", on: true, why: "For the weaker-evidence splits (close to the standard order), an augment that favors one of the two abilities tips it: Bread and Butter/Jam/Cheese (+100 haste) or Pentakill HEAVY/POWER/THRASH (+20 haste, +10%) on the split's 3-point ability maxes that ability first; on the maxed ability, it's maxed from the start (no split). Kit logic, estimated: no data splits skill orders by augment. Nico approved 2026-11-24 (he asked for it)." },
  augmentSkills: { source: "assumption", on: true, why: "A few champions max another ability first once they take an augment (Gwen: E>Q>W with Ethereal Weapon). Nico approved 2026-11-24 (he asked for it); no source splits skill orders by augment, so it's estimated." },
  styleSkills: { source: "data", on: true, why: "When the build switches to another style (an augment, your items or a niche build), the skill max order switches to that build's own, from the same players' games the site's build toggle shows (15 champions differ, e.g. Miss Fortune AP E>W>Q vs crit Q>W>E). An augment's own order and the Archmage route still come first." },
  augmentStart: { source: "data", on: true, why: "The starting items follow the first augment when its first-screen pickers mostly start something else and it at least doubles that start for the champion (Upgrade Stormsurge: Hextech Alternator; Wooglet's Witchcap: Needlessly Large Rod). From the archive's other players against the same champions' players, estimated. Nico asked for it 2026-11-24." },
  richStart: { source: "data", on: true, why: "With more than the 1,400 starting gold before your first buy (the Debonair headliner pays gold for each augment pick; seen in 16 of 251 archive games since 16.21), the best start above 1,400 that you can afford, by DeepScore. Starts above 1,400 are never the default. Nico asked for it 2026-11-24." },
  goldFill: { source: "assumption", on: true, why: "Gold left after the start (Debonair, Upgrade augments) goes on the parts of the first item, biggest part that fits first; with an augment start, on the item that augment leads to (Upgrade X: X; Wooglet's Witchcap: Rabadon's Deathcap). Real Debonair players mostly keep the gold (137 of 160 in the archive), so no data says which is best. Nico approved it 2026-11-24." },
  extraAugments: { source: "data", on: true, why: "Headliners that add augment picks count them as picks left for combo potential: K/DA +0.93 (it gives a 5th augment, never a 6th (Nico); in 21 archive games that look like K/DA, 196 of 210 players had a 5th. Pentakill's empowerments are recorded as augments (3176 at the start; HEAVY, POWER or THRASH at 18), so they don't count), Superfans +0.29 (its 5th augment comes at level 21, which 29% of players reached in the 33 games above level 18). Used once the app knows the headliner; Nico asked 2026-11-24." },
  screenTiers: { source: "game data", on: true, why: "Wiki (ARAM: Mayhem): every player gets the same tier on a screen, and the first two screens are never both Silver. Archive since 16.21: after a Silver first screen the second was Gold 15 times, Prismatic 15, Silver 0. So when the first screen is Silver, a Silver partner has one screen fewer to come." },
  headlinerScreens: { source: "game data", on: true, why: "Used once the app knows the headliner (wiki + Nico 2026-11-24). Maestro: 4 cards a screen, each rerollable once, so 8 chances to see a partner instead of 6. Command Line: screens are only Silver or Gold, so a Prismatic partner only comes from a reroll; the first reroll on a screen draws one tier higher (Silver to Gold, Gold to Prismatic). Debonair: the gold on a card only breaks a tie." },
  heartsteelStickers: { source: "assumption", on: true, why: "HEARTSTEEL stickers add their estimated value to the augment they're on: stats the champion uses, priced at basic-item gold, 0.45 win-rate points per 1,000 gold (Deft/Recursion on builders vs non-builders). Nico approved estimates 2026-11-24." },
  transmuteDraw: { source: "assumption", on: true, why: "Transmute: Gold/Prismatic/Chaos and Pandora's Box draw at random, so their score moves with what is left to draw: the card's own DeepScore on the champion, plus how far the champion's augments still drawable at that tier (minus the ones taken or already shown) sit above or below the full list, times how much a pool's strength moves the card across champions (AramHex 16.21-16.23, 173 champions: Gold 0.34, Prismatic 0.61, Chaos 0.54 on every tier; Pandora's per draw as Prismatic). Pandora's also swaps every augment you hold for a random Prismatic: that draw minus each held augment's score, and held synergy bonuses are lost. The draw is from the champion's own augments: the game files keep per-champion augment pools with a fallback pool per tier, and in Nico's archive 66% of augments held after Pandora's Box sit in that champion's pool (normal picks 72%, a draw from all 314 augments ~21%); a pool's strength also predicts the card (r 0.69). Still estimated: whether the draw skips augments already shown, and that held augments' values add up. Nico approved 2026-11-24 (he asked for it)." },
  tierOdds: { source: "data", on: true, why: "Combo potential uses the chance each later screen comes at the partner's tier (archive since 16.21, all players, 225 games: e.g. after a Prismatic screen the next is Prismatic only 18% of the time, Gold 43%) and the chance the partner is among the 6 cards a screen can show from the champion's augments left at that tier, instead of a flat 4% per pick. Split-half backtest: predicts the next screen's tier better than tier-blind odds (log loss 1.05-1.07 vs 1.10). Nico approved 2026-11-24." },
  nearTies: { source: "data", on: true, why: "Cards on offer within the 95% noise band of the best (1.96 x their combined standard error) are shown as 'either is fine'. Engine scorecard on 9,399 archive picks since 16.21 (other players, game state at pick time controlled): a gap outside the band predicts wins (+0.043 log-odds per point, z 5.0); inside it, which side you're on doesn't (above -2.7 vs below -1.3 pts, se 1.7). Nico approved trying it 2026-11-24." },
  augmentConflicts: { source: "game data", on: true, why: "An augment that can't work with one you took goes last, with the reason (wiki augment text): Back to Basics seals your ultimate, so augments that need your ultimate cast are dead with it; ADAPt and EscAPADe convert opposite ways; you have two summoner spell slots, so Mark augments, Flash augments and augments that replace a spell can't all fit. Nico asked 2026-11-24; the longer list of possible anti-synergies is in research/augment-conflicts for his review." },
  slotFirst: { source: "game data", on: true, why: "Weapon of Destiny (when you take it), King Me (when you first enter the enemy gate) and Ornn's Masterwork (his own item at level 13; an ally's when he forges for them at levels 14-17) each upgrade the first eligible Legendary in slots 1-6 (wiki). The cue says which item to move to slot 1: for Weapon of Destiny the champion's best Weapon item (AramHex); for King Me and Ornn, estimated, the earliest item of your build path you own (+1,000 gold of stats goes on your most important item). Weapon of Destiny is only offered on the first two regular screens (archive: 136 of 136 picks outside random draws; never seen on K/DA's or Superfans' extra picks, estimated), so its cue only shows while it is on offer. Nico chose 2026-11-24." },
  hasteMath: { source: "game data", on: true, why: "Cooldowns shorten by haste / (100 + haste): a note, not advice." },
  ownedOffPath: { source: "game data", on: true, why: "A finished item you bought that isn't in the path takes the first open later slot, so the path shows what you own." },
  ownedReplan: { source: "data", on: true, why: "Buying off the path re-plans what's left, like a build-changing augment (Nico approved 2026-11-24, replay QA: 'Next' stuck on Malignance for 19 minutes). Owning n finished items means the path's first n should be bought: one of those you skipped (for an item later in the path or off it) moves behind the rest, so Next moves on after the first buy that skips it (replay audit: Next stuck 8+ min with 3,500+ gold in 103 moments); boots too once bought past without starting them; two off-path items of the other damage type (one gets the sellMismatch tip: doubling down after one off-type buy lowers team damage share, archive) switch the rest of the build to the class-wide style build (AramHex, all champions) holding most of what you own, e.g. AP Zeri." },
  augmentRush: { source: "data", on: true, why: "An augment whose holders build one item far more and earlier (real lobbies, augment-item-shift: build z >= 3, early z >= 2, +15 pts build share, of the build's damage type unless ADAPt; 21 pairs, e.g. Upgrade Stormsurge -> Stormsurge +52 pts, Wooglet's -> Zhonya's, Ultra Hydra -> a Hydra) puts it in the core and makes it Next. Nico 2026-11-24: the core should change when an augment calls for rushing an item; small augments don't churn it." },
  pathOnce: { source: "game data", on: true, why: "An item shows once in the path: a later slot that repeats an earlier item takes its next option." },
  converterItems: { source: "kit rule", on: true, why: "Converter augments change what a stat is worth (augment text, wiki): ADAPt turns bonus AD into AP, EscAPADe AP into AD, Jeweled Gauntlet lets abilities crit, Ethereal Weapon and Double Tap apply on-hit, Purist - Caster turns attack speed into haste, No Mana, No Problem turns item mana into AP... The item of the re-priced kind its holders build most (augment-item-shift, pull >= 0.05, z >= 3) that fits the champion's damage type (or a taken ADAPt/EscAPADe converts it) joins the core. Nico 2026-11-24: kit rules go on unless data contradicts; archive check (data/estimates/augment_converters.py, within champion, difference in differences): damage share +1.7 +- 0.6 pts pooled, win rate within noise, none worse." },
  sellMismatch: { source: "data", on: true, why: "One finished item of the other damage type (pure AD on an AP build or the reverse, no ADAPt/EscAPADe): sell it when its 70% sell value plus your gold buys the next path item now. Archive, within champion: one such item in the first three legendaries goes with -2.0 +- 0.3 pts of team damage share (two: -4.3, three: -5.4), win rate flat (+0.1 +- 3.1). Nico 2026-11-24 asked for sell pushback when it's worth it; the 'buys it now' line is estimated." },
  leanIn: { source: "kit rule", on: true, why: "Augments whose own number grows with a stat (Lich Brain: AP from bonus health; Armored Impact, Porcupine, Courage of the Colossus, Ravenous Bind, Rejuvenation, Sap Magic) put the item their holders build most that gives that stat into the core, preferring one that also gives the champion's damage type (Lich Brain on a mage: Riftmaker). Pairs where archive players following an augment's pull did clearly worse (damage share or win below zero by 3 SE: tested only on champions that normally build the item, so it isn't forcing it on champions that can't use it: Dual Wield -> Blade of the Ruined King, Magic Missile -> Shadowflame; a loss on win rate alone needs 20+ matched holders, which cleared Critical Healing -> Moonstone) lose the augment's push, only vs 0-1 enemy frontliners where the loss isn't seen vs 2+ (BotRK is best vs high health, Nico 2026-11-24); the item stays wherever the champion's own build has it. Nico 2026-11-24 (kit rules on unless data contradicts); data/estimates/augment_lean_in.py, 645 pair tests: only All For You -> Moonstone Renewer passes 3 SE as a measured gain." },
  ccCounters: { source: "kit rule", on: true, why: "3+ enemies built to lock you down (Catcher/Vanguard) light up tenacity and cleanse items (Mercury's Treads, Quicksilver Sash, Mercurial Scimitar, Silvermere Dawn) as a swap. Nico 2026-11-20: Mayhem has more CC than SR; 2026-11-24 approved enemy-aware swaps when damage mix or CC clearly calls for it. Untestable so far (match data has no CC-received stat; 3+ engage -> QSS had 5 buyers), so estimated." },
  vowPartner: { source: "kit rule", on: true, why: "Knight's Vow heals its owner for 12% of the damage the pledged (Worthy) ally deals to champions (item text, Data Dragon 16.23), so on a frontliner or enchanter, with 2+ enemy frontliners (Warden/Vanguard/Juggernaut) and an ally whose kit hits max health (Vayne, Kog'Maw, Varus...) or a marksman, it lights up as a swap: pledge to that ally. Archive, within champion: each enemy frontliner adds +1.1 +- 0.3 pts of team damage share for max-health kits and +0.7 +- 0.2 for marksmen (assassins -0.8, artillery -0.7), so the heal grows with exactly that matchup. The heal itself isn't measured (estimated). Nico 2026-11-24 asked for unconventional mechanism ideas; his example (Knight's Vow on the max-health champion itself) doesn't work: the item heals its owner from the ally's damage, not the damage dealer." },
  headlinerItems: { source: "kit rule", on: true, why: "La Ilusion (a dying ally drops a candle that shields whoever picks it up) lights the champion's own 'Vs shields' item; Cafe Cuties (health relics heal 20% more missing health) lights its 'Vs healing' item. Pointers only (hover), never a swap: anti-heal and anti-shield items showed no clear effect in normal games, and these headliners leave no trace in match data to test (research/headliners). Nico's ideas 2026-11-24; estimated, used once the app knows the headliner." },
  mustCore: { source: "data", on: true, why: "A core item most of the champion's players still hold at game end (50%+, AramHex 16.22-16.23, the same bar as 'built by most players') is a must-have: augment rushes, converters and lean-in items take a flexible core place instead, or go right after the core when every core item is a must-have (Aphelios: Collector, Infinity Edge, LDR; Irelia: Blade of the Ruined King and Death's Dance). Nico 2026-11-25: some champions need one item, others a demanding core. Hold rates are behavior, not proof of value." },
  breakpoints: { source: "kit rule", on: true, why: "Penetration and %-health items and augments (Thread the Needle, Lord Dominik's, Mortal Reminder, Serylda's, Black Cleaver, Void Staff, Cryptbloom; Blade of the Ruined King, Liandry's, Demonic Embrace) light up when this game's enemies are unusually tanky: their armor, magic resist or health (champion base stats at their level plus their items, Data Dragon) is above a typical team's with the same item counts by more than the archive's mean + 1 SD at game end (about the top 16% of games: armor x1.17, MR x1.20, health x1.10). Only items the champion's data lists and the damage type fits; Thread the Needle when it's in the champion's pool. Plain resist/health math (simulator rule: simple calculations only), never changes rankings. Nico 2026-11-25 asked for it; estimated (enemy stat augments aren't seen)." },
  allyAugments: { source: "kit rule", on: true, why: "Augments that act through teammates (wiki text: Empowered By The Faithful and Searing Dawn trigger on allies' hits; Sonic Boom, Windspeaker's Blessing, Empyrean Promise, Spirit Bomb and Wee Woo Wee Woo fire around allies in the fight) break a near-tie when 2+ allies fit (damage dealers, or melee fighters and tanks). Tiebreak only, never past a clearly better card. Archive, within champion: holders' win with vs without such a team -16 to +26 pts, all within noise (8 augments, 10-148 holders), so nothing contradicts it and nothing confirms it (estimated). Nico 2026-11-24 approved ally-aware augments." },
  fullBuildShop: { source: "kit rule", on: true, why: "With six finished items and the build done: Stat Bonus (750 gold, permanent stat, level 9+) when you can afford it, else the elixir of your damage type (Sorcery for AP, Wrath for AD, Iron for tanks: 500 gold, 3 minutes) when 500-749 gold sits unspent. Permanent beats temporary for 250 more gold; the elixir only spends gold that would idle. Item text (Data Dragon 16.23); estimated, no archive data on consumables. Nico 2026-11-24 asked for elixir and anvil advice." },
  pathOrder: { source: "game data", on: true, why: "The shown path follows the same order as Next for the items you haven't bought (augment pulls, rushes, timing), so the core is a starting point that moves with your augments, not a fixed list. Nico 2026-11-24: the core is only a default baseline." },
  // Design choices Nico hasn't picked yet: kept as they were.
  rerollMinGain: { source: "assumption", on: true, why: "Reroll advice needs +0.25 DeepScore points of expected gain. Nico approved 2026-11-23." },
  swapLastSlot: { source: "assumption", on: true, why: "A swap that clashes or substitutes with nothing replaces the last open slot. Display rule, Nico approved 2026-11-23." },
  shopTips: { source: "assumption", on: true, why: "Sell tip at 6 full slots; buy-now names the priciest affordable part. Nico approved 2026-11-23." },
  // No evidence either way: off until a test passes (Nico 2026-11-23, apply defaults).
  upgradeNext: { source: "assumption", on: false, why: "'Upgrade X' means buy X next. Off: augmentShift moves items by how much earlier holders really buy them." },
  augmentShift: { source: "data", on: true, why: "Every augment pulls items earlier/later and in/out of the build by how players who took it really build, vs the same champion's players without it (10-player archive lobbies, EB-shrunk so thin pairs barely move; data/augment-item-shift.json). Nico 2026-11-24: all augments change build and order." },
  augmentReplan: { source: "assumption", on: false, why: "Other augments switch the build style (style tags, the other 3-vote build changers, the class-wide fallback build). Off until measured like Draw Your Sword -> Death's Dance." },
  countTriggers: { source: "assumption", on: false, why: "'2+ enemies' counts (tanks, burst, crit, healers, enchanters), 3+ Catcher/Vanguard, physical or mixed damage lean. Tested: no effect in the counter tests; stays off." },
  stackingFirst: { source: "assumption", on: false, why: "Stacking items first while no legendary is finished. Tested: +1.2 ± 1.7 pts, not shown; stays off." },
  attackSpeedNudge: { source: "assumption", on: false, why: "Attack-speed items move back from 4.5 attack speed. Off: 451 archive frames show attack speed above 5.0 (up to 11.7); Nico: the cap may be 99." },
  selfHealWeight: { source: "assumption", on: false, why: "Count self-healers more for Vs healing. Off until tested." },
  wikiModifiers: { source: "assumption", on: false, why: "Weight enemies by the wiki's Mayhem healing/shielding modifiers. Off until tested." },
  itemDamageMix: { source: "assumption", on: false, why: "Enemy damage lean pulled toward their AP/AD items. Off until tested: the lean is the champions' own." },
  resistAugmentSwaps: { source: "kit rule", on: true, why: "Fortified (+25% bonus armor), Mystic Guard (+25% bonus MR) and Steadfaster Presence (+16-32% bonus resists) multiply resist items (26.23 patch notes), so a lit armor/MR swap of that kind comes first. Nico 2026-11-24: kit rules on unless data contradicts (no archive data on these 26.23 augments yet)." },
  // Removed: % penetration when 2+ enemies stack the resist failed its test (the gain is smaller when they stack).
};

// ---------------------------------------------------------------------------------------------------------------
// Data shapes (the site's public files)

export type Named = {
  name: string;
  icon: string | null;
  deepScore?: number | null;
  /** Later-slot items: inside the 95% win-rate band of the slot's best item (a near-tie, site lib/quick-build.ts). */
  tie?: boolean;
};
export type Situational = Named & { when?: string; why?: string; augments?: number[]; replaces?: Named };
export type OverlayChamp = {
  id: string;
  name?: string;
  skills?: string[];
  items?: Named[];
  rest?: Named[];
  full?: Named[];
  later?: Named[];
  laterSlots?: { slot: number; items: Named[] }[];
  situational?: Situational[];
  swaps?: { augment: Named; item: Named }[];
  destiny?: Named | null;
  /** AP Ashe with Archmage (site lib/archmage-route.ts): the haste route per set of loop augments taken with it. */
  archmage?: {
    augment: number;
    style: string;
    skills: string[];
    routes: { with: number[]; eRank: number; need: number | null; reach: boolean; items: Named[]; routeLen: number }[];
  };
  /** Skill max orders once an augment is taken (site lib/augment-skills.ts). */
  augmentSkills?: { augment: number; skills: string[] }[];
  /** Points into one ability before following `skills` (site lib/augment-skills.ts CHAMPION_SPLITS, Nico's pick). */
  skillSplit?: { first: string; points: number; weak?: boolean };
  /** The start once an augment is taken first (site lib/quick-build.ts augmentStarts), estimated. */
  augmentStarts?: { augment: number; start: Named[]; toward?: number }[];
  /** Starts above the starting gold, best first, with their cost (site lib/quick-build.ts richStarts). */
  richStarts?: { start: Named[]; cost: number }[];
  start?: Named[];
  /** Build styles, best DeepScore first; nearBest: its win rate's 95% range overlaps the best's (Feeling lucky). */
  builds?: (Partial<OverlayChamp> & { style: string; share: number; deepScore?: number; nearBest?: boolean })[];
};
/** why-best.json (lib/why-best.ts) */
export type WhyData = {
  /** alias -> item id -> share of the champion's games ending with it (only items at 50% or more) */
  follow: Record<string, Record<string, number>>;
  /** item id -> the kit trait that explains its fit */
  kit: Record<string, "physical" | "carry" | "tank" | "melee">;
  /** alias -> which side of each trait the champion is on */
  traits: Record<string, { physical: boolean; tank: boolean; melee: boolean }>;
};
/** mechanism-profiles.json: per item, the change per metric and its z score (estimated). */
export type Profiles = { items: Record<string, Record<string, { change: number; z: number }>> };
/** augment-picks.json */
export type Picks = {
  augments: Record<string, [string, string]>;
  /** alias -> [id, ranking score, DeepScore, estimated?, standard error of the score in win-rate points (-1 when
   *  unknown), pick rate on the champion] */
  champions: Record<string, [number, number, number?, number?, number?, number?][]>;
  pairs: Record<string, [number, number, number][]>;
  styles: Record<string, string[]>;
  /** alias -> builds by style: [style, share, boots, core, later, augments that switch to it (niche builds only)] */
  builds?: Record<string, [string, number, number[], number[], number[], number[]?][]>;
};
/** damage-types.json */
export type Kinds = {
  champions: Record<string, number>;
  items: Record<string, string[]>;
  boots: number[];
  recipes: Record<string, [string, number, number[]]>;
  limits?: number[][];
  substitutes?: number[][];
};
/** team-fit.json */
export type Fit = { champions: Record<string, [number, string[]]> };
export type Enemy = { champ: string; items: number[]; /** Champion level, when the app reads it (breakpoints). */ level?: number };
export type GameState = {
  champ: string;
  /** Item ids as the game reports them, in inventory slot order (slots 1-6, then the trinket) where the app sorts them. */
  items: number[];
  /** Augments on offer right now (the cards on screen). */
  offer?: number[];
  /** Your teammates: champion and level (for Ornn's Masterwork upgrades). */
  allies?: { champ: string; level: number }[];
  enemies?: Enemy[];
  level?: number;
  /** Skill points in Q, W, E, R. */
  skills?: number[];
  gold?: number;
  dead?: boolean;
  /** Seconds since the game started. */
  t?: number;
  /** [crit chance (0 to 1), attack speed, ability haste] as the live game reports them, when the app reads them. */
  stats?: number[];
  /** This game's headliner, once the app knows it ("La Ilusion", "Cafe Cuties"...). */
  headliner?: string;
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

/** The champion's key in a data file, whatever its capitals (the game says "FiddleSticks"). */
export const keyIn = (obj: object | undefined | null, champ: string | undefined) =>
  obj && champ ? Object.keys(obj).find((k) => k.toLowerCase() === champ.toLowerCase()) : undefined;
// Icons whose file is another mode's copy of the item (the client shares one image across ids): the id the game
// reports. The Collector's icon is 667666 while the game reports 6676; Overlord's Bloodmail shows Arena's 447111
// (base 7111, not 2501), so an owned Bloodmail stayed Next (PC replay, Dr. Mundo 2026-08-09).
const ICON_ID: Record<number, number> = { 667666: 6676, 447111: 2501, 663060: 3131, 667109: 6035, 447104: 4402, 773348: 3364 };
/** The base item id of an item icon (Mayhem copies 223031 -> 3031). */
export const itemId = (icon: string | null | undefined) => {
  const n = Number((String(icon ?? "").match(/(\d+)\.png$/) ?? [])[1]);
  return ICON_ID[n] ?? n % 10000;
};
const base = (id: number) => id % 10000;
/** Items that turn into another in your inventory (Riot item.json "specialRecipe", 16.23.1: map 12 and Mayhem's 77xxxx
 *  copies): the transformed id -> the item you bought. Seraph's Embrace counts as owning Archangel's Staff, so the
 *  path doesn't get stuck asking for an item you already have (Nico 2026-11-25). */
export const TRANSFORMED_FROM: Record<number, number> = { 3040: 3003, 3042: 3004, 3121: 3119, 2530: 2526, 3160: 3154 };
/** The id an inventory item counts as for "do you own it": the base id, a transformed item as its source. */
export const ownedId = (id: number) => TRANSFORMED_FROM[base(id)] ?? base(id);
/** What you own, held as the items you bought (ownedId). has() maps its argument the same way, so a path that names
 *  either form (the site's builds list Diadem of Songs and Fimbulwinter, not their sources) finds it, and iterating
 *  never counts one inventory item twice. */
export class OwnedItems extends Set<number> {
  constructor(items: Iterable<number> = []) { super([...items].map(ownedId)); }
  has(id: number) { return super.has(ownedId(id)); }
}
const champKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------------------------------------------------------
// Item limits and substitutes

export type ItemRules = { clash: (a: number, b: number) => boolean; substitute: (a: number, b: number) => boolean };
export function itemRules(k: Kinds | null | undefined): ItemRules {
  const groups = new Map<number, number[]>();
  (RULES.itemLimits.on ? (k?.limits ?? []) : []).forEach((g, n) => g.forEach((id) => groups.set(base(id), [...(groups.get(base(id)) ?? []), n])));
  const subs = new Set((RULES.substitutes.on ? (k?.substitutes ?? []) : []).map(([a, b]) => `${Math.min(base(a), base(b))}-${Math.max(base(a), base(b))}`));
  return {
    clash: (a, b) => base(a) !== base(b) && (groups.get(base(a)) ?? []).some((g) => (groups.get(base(b)) ?? []).includes(g)),
    substitute: (a, b) => subs.has(`${Math.min(base(a), base(b))}-${Math.max(base(a), base(b))}`),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Augments

export const COMBO_ODDS = 0.04;
/** Augment picks a headliner adds, on average per player (owner's archive since 16.21, other players included). */
export const HEADLINER_EXTRA_PICKS: Record<string, number> = { kda: 0.93, superfans: 0.29 };
/** Regular augment screens: the first and levels 7, 11 and 15. */
export const AUGMENT_SCREENS = 4;
export const COMBO_CAP = 0.12;
export const LUCKY_ODDS = 0.35;
export const LUCKY_CAP = 1;
export const REROLL_GAIN = 0.25;

export type RankedAugment = {
  id: number;
  score: number;
  boost: number | null;
  potential: number;
  combo: number | null;
  mate: number | null;
  deep: number;
  /** Feeling lucky: points added for being a rarer pick among near-ties (0 when none). */
  tilt?: number;
  /** Why it can't work with an augment you took (augmentConflicts); such augments go last. */
  conflict?: string;
  /** Transmute/Pandora's Box (transmuteDraw): points added (or taken) for what is left to draw and, for Pandora's,
   *  what you hold. Estimated. */
  draw?: number;
};

// ---------------------------------------------------------------------------------------------------------------
// Augment conflicts (wiki augment text), by name so every id of an augment counts

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Augments that only work when you cast your ultimate (or add ultimate haste). */
export const ULTIMATE_AUGMENTS = new Set(["arcaneaxiom", "canttouchthis", "feymagic", "finalform", "itskillingtime", "jeweledbracelet", "moshmonster", "rise", "stuckinherewithme", "ultimateawakening", "ultimaterecursion", "ultimaterevolution", "ultimateunstoppable"]);
/** Augments that need the Mark summoner spell, the Flash summoner spell, or replace a summoner spell with their own. */
export const MARK_AUGMENTS = new Set(["biggestsnowballever", "holysnowball", "pinball", "snowblast", "snowday"]);
export const FLASH_AUGMENTS = new Set(["flashy", "flash2", "flashbang"]);
export const SPELL_AUGMENTS = new Set(["bladewaltz", "brassblast", "clowncollege", "getjinxed", "growthspurt", "poltergeist", "spinmerightround", "totentanz"]);

/** Why augment `id` can't work with what you took, or null (augmentConflicts). */
export function augmentConflict(picks: Picks, taken: number[], id: number): string | null {
  if (!RULES.augmentConflicts.on) return null;
  const nm = (x: number) => picks.augments[x]?.[0] ?? "";
  const me = nameKey(nm(id));
  if (!me) return null;
  const mine = taken.map((x) => ({ id: x, k: nameKey(nm(x)) })).filter((x) => x.k);
  for (const t of mine) {
    if ((me === "backtobasics" && ULTIMATE_AUGMENTS.has(t.k)) || (t.k === "backtobasics" && ULTIMATE_AUGMENTS.has(me)))
      return `Back to Basics seals your ultimate, which ${me === "backtobasics" ? nm(t.id) : nm(id)} needs`;
    if ((me === "adapt" && t.k === "escapade") || (me === "escapade" && t.k === "adapt"))
      return `${nm(t.id)} converts the other way`;
  }
  const keys = [...mine.map((t) => t.k), me];
  const slots = (keys.some((k) => MARK_AUGMENTS.has(k)) ? 1 : 0) + (keys.some((k) => FLASH_AUGMENTS.has(k)) ? 1 : 0) + keys.filter((k) => SPELL_AUGMENTS.has(k)).length;
  if (slots > 2 && (MARK_AUGMENTS.has(me) || FLASH_AUGMENTS.has(me) || SPELL_AUGMENTS.has(me)))
    return "No summoner spell slot left for it after your other spell augments";
  return null;
}

/** Feeling lucky's tilt toward rarer options: at most this many points (win-rate points). */
export const LUCKY_TILT = 0.3;

/**
 * Feeling lucky (Nico 2026-11-23: "a slight bias toward unique/off-meta builds if roughly same win rate"): an option
 * picked less than the median gets up to LUCKY_TILT points, scaled by how rare it is. "Roughly the same" is the
 * options' own uncertainty: the tilt can only reorder two options whose 95% ranges overlap (gap within
 * 1.96 x the combined standard error); an option never passes one that is clearly better. Options with no
 * uncertainty (estimates) get no tilt.
 */
export function luckyOrder<T extends { score: number }>(list: T[], se: (x: T) => number | null, pick: (x: T) => number | null): (T & { tilt: number })[] {
  const picks = list.map(pick).filter((x): x is number => x !== null && x >= 0).sort((a, b) => a - b);
  const median = picks.length ? picks[Math.floor(picks.length / 2)] : 0;
  const rows = list.map((x) => {
    const p = pick(x), e = se(x);
    const tilt = RULES.luckyTilt.on && e !== null && e >= 0 && p !== null && p >= 0 && median > 0 && p < median ? LUCKY_TILT * (1 - p / median) : 0;
    return { ...x, tilt };
  });
  const band = (a: T, b: T) => {
    const ea = se(a), eb = se(b);
    return ea === null || eb === null || ea < 0 || eb < 0 ? 0 : 1.96 * Math.sqrt(ea * ea + eb * eb);
  };
  const before = (a: T & { tilt: number }, b: T & { tilt: number }) =>
    Math.abs(a.score - b.score) > band(a, b) ? a.score > b.score : a.score + a.tilt > b.score + b.tilt;
  // insertion sort: the comparison only holds pairwise, so keep it simple and stable
  const out: (T & { tilt: number })[] = [];
  for (const r of [...rows].sort((a, b) => b.score - a.score)) {
    let i = out.length;
    while (i > 0 && before(r, out[i - 1]) && Math.abs(r.score - out[i - 1].score) <= band(r, out[i - 1])) i--;
    out.splice(i, 0, r);
  }
  return out;
}

/**
 * This champion's augments best first: real per-champion score, plus synergy with what you took, plus a share of the
 * best combo you could still complete (the chance it's offered again, partnerOdds, at most COMBO_CAP; "I'm feeling
 * lucky" uses LUCKY_ODDS per pick left instead).
 * A partner already shown this game can't come back, so it adds no potential. A headliner that adds picks (K/DA,
 * Superfans) adds its expected extra picks to the picks left (extraAugments). `tier` is the tier of the screen being
 * picked from: the picks left are counted per partner tier (partnerPicks).
 */
/** A headliner's name as a key: "K/DA" -> "kda", "Command Line" -> "commandline". */
export const headlinerKey = (h?: string | null): string => (h ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Picks still to come after the one being made: the regular screens left, plus what the headliner adds on average. */
export function picksLeft(taken: number, headliner?: string): number {
  const extra = RULES.extraAugments.on && headliner ? HEADLINER_EXTRA_PICKS[headlinerKey(headliner)] ?? 0 : 0;
  return Math.max(0, AUGMENT_SCREENS + extra - 1 - taken);
}

/** Chance of each tier on a later screen, from the archive since 16.21 (all players; every player gets the same tier on a
 *  screen). second: screen 2 given screen 1 (never Silver twice); next: the screen after the one on offer; later: any
 *  screen further on, and the extra K/DA or Superfans screens (random tier). */
export const TIER_ODDS: { second: Record<string, Record<string, number>>; next: Record<string, Record<string, number>>; later: Record<string, number> } = {
  second: {
    gold: { gold: 0.427, prismatic: 0.237, silver: 0.336 },
    prismatic: { gold: 0.493, prismatic: 0.134, silver: 0.373 },
    silver: { gold: 0.481, prismatic: 0.519, silver: 0 },
  },
  next: {
    gold: { gold: 0.478, prismatic: 0.271, silver: 0.251 },
    prismatic: { gold: 0.431, prismatic: 0.183, silver: 0.385 },
    silver: { gold: 0.433, prismatic: 0.291, silver: 0.276 },
  },
  later: { gold: 0.453, prismatic: 0.25, silver: 0.296 },
};
/** Cards a screen can show: 3 offered plus one reroll each. */
export const SCREEN_DRAWS = 6;

/**
 * Chance a partner of this tier is offered again before your picks run out (tierOdds): for each screen left, the chance
 * it comes at that tier times the chance the partner is among the cards it can show (SCREEN_DRAWS out of `pool`, the
 * champion's augments left at that tier). `tier` is the screen on offer. Command Line screens are only Silver or Gold;
 * Maestro shows 8 cards.
 */
export function partnerOdds(taken: number, rarity: string, pool: number, opts: { tier?: string; headliner?: string } = {}): number {
  if (!rarity || pool <= 0) return 0;
  const hl = RULES.headlinerScreens.on ? headlinerKey(opts.headliner) : "";
  const draws = hl === "maestro" ? SCREEN_DRAWS * (MAESTRO_CARDS / 3) : SCREEN_DRAWS;
  const shown = Math.min(1, draws / pool);
  const odds = (t: Record<string, number>) => {
    if (hl !== "commandline") return t[rarity] ?? 0;
    const sg = (t.silver ?? 0) + (t.gold ?? 0);
    return rarity === "prismatic" || sg <= 0 ? 0 : (t[rarity] ?? 0) / sg;
  };
  const screens: { p: number; w: number }[] = [];
  const regular = Math.max(0, AUGMENT_SCREENS - 1 - taken);
  for (let k = 0; k < regular; k++) {
    const t = k === 0 && opts.tier ? (taken === 0 ? TIER_ODDS.second[opts.tier] : TIER_ODDS.next[opts.tier]) ?? TIER_ODDS.later : TIER_ODDS.later;
    screens.push({ p: odds(t), w: 1 });
  }
  const extra = picksLeft(taken, opts.headliner) - regular;
  if (extra > 0) screens.push({ p: odds(TIER_ODDS.later), w: extra });
  // An extra screen that comes only some of the time counts that share of its chance.
  return 1 - screens.reduce((miss, s) => miss * (1 - s.w * s.p * shown), 1);
}

/** Maestro shows this many cards a screen instead of 3. */
export const MAESTRO_CARDS = 4;

/**
 * Chances still to come of seeing an augment of this tier, in regular screens (screenTiers, headlinerScreens):
 * the picks left, minus the second screen for a Silver one when the first screen (`tier`) is Silver; none for a
 * Prismatic one under Command Line; 4/3 as many under Maestro.
 */
export function partnerPicks(taken: number, rarity: string | undefined, opts: { tier?: string; headliner?: string } = {}): number {
  let n = picksLeft(taken, opts.headliner);
  const hl = RULES.headlinerScreens.on ? headlinerKey(opts.headliner) : "";
  if (RULES.screenTiers.on && taken === 0 && opts.tier === "silver" && rarity === "silver") n = Math.max(0, n - 1);
  if (hl === "commandline" && rarity === "prismatic") n = 0;
  if (hl === "maestro") n *= MAESTRO_CARDS / 3;
  return n;
}

/**
 * Random-draw cards (transmuteDraw, estimated). `tier` is what the draw comes from ("" = every tier: Chaos, which
 * also skips the other cards on screen, already in `seen`); `slope` is how much the card's score moves per point of
 * its pool's average across champions (AramHex 16.21-16.23); `swap` = Pandora's, which also turns every augment you
 * hold into a random Prismatic.
 */
export const TRANSMUTE: Record<number, { tier: string; slope: number; swap?: boolean }> = {
  1237: { tier: "gold", slope: 0.34 }, 237: { tier: "gold", slope: 0.34 },
  1238: { tier: "prismatic", slope: 0.61 }, 238: { tier: "prismatic", slope: 0.61 },
  1243: { tier: "", slope: 0.54 }, 243: { tier: "", slope: 0.54 },
  12317: { tier: "prismatic", slope: 0.61, swap: true }, 317: { tier: "prismatic", slope: 0.61, swap: true },
};

function transmuteDraw(
  picks: Picks,
  own: [number, number, number?, number?, number?, number?][],
  pairs: [number, number, number][],
  taken: number[],
  gone: Set<number>,
  ranked: RankedAugment[],
) {
  const tierOf = (id: number) => picks.augments[id]?.[1] ?? "";
  const value = new Map(own.map(([id, score]) => [id, score * 100]));
  // Synergy an augment would add with what you hold (the same pair bonus the ranking uses).
  const bonus = (id: number) => pairs.reduce((t, [a, b, p]) => t + ((a === id && taken.includes(b)) || (b === id && taken.includes(a)) ? p : 0), 0);
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  for (const r of ranked) {
    const t = TRANSMUTE[r.id];
    if (!t) continue;
    const inTier = own.filter(([id]) => !TRANSMUTE[id] && (!t.tier || tierOf(id) === t.tier));
    const left = inTier.filter(([id]) => !taken.includes(id) && !gone.has(id));
    if (inTier.length < 5 || left.length < 3) continue;
    const full = mean(inTier.map(([id]) => value.get(id)!));
    const now = mean(left.map(([id]) => value.get(id)! + bonus(id)));
    let draw = t.slope * (now - full);
    if (t.swap) {
      // Each held augment becomes a random Prismatic: the draw's worth minus what it was worth, and synergy between
      // held augments is gone.
      const held = taken.filter((id) => value.has(id) && !TRANSMUTE[id]);
      draw += held.reduce((s, id) => s + t.slope * (now - value.get(id)!), 0);
      draw -= pairs.reduce((s, [a, b, p]) => s + (taken.includes(a) && taken.includes(b) ? p : 0), 0);
    }
    if (!Number.isFinite(draw) || Math.abs(draw) < 0.005) continue;
    r.draw = draw;
    r.score += draw;
    if (r.boost !== null) r.boost += draw;
  }
}

export function rankAugments(
  picks: Picks,
  champ: string,
  taken: number[],
  opts: { lucky?: boolean; seen?: number[]; headliner?: string; tier?: string; stickers?: Record<string, number> } = {},
): RankedAugment[] {
  const ck = keyIn(picks.champions, champ);
  const own = ck ? picks.champions[ck] : [];
  const pairs = (keyIn(picks.pairs, champ) && picks.pairs[keyIn(picks.pairs, champ)!]) || [];
  const gone = new Set(RULES.seenAugments.on ? (opts.seen ?? []) : []);
  // The champion's augments left at each tier: a partner is one of these (tierOdds).
  const left = new Map<string, number>();
  for (const [id] of own) {
    if (taken.includes(id) || gone.has(id)) continue;
    const r = picks.augments[id]?.[1] ?? "";
    left.set(r, (left.get(r) ?? 0) + 1);
  }
  const oddsAt = new Map<string, number>();
  const odds = (other: number) => {
    const r = picks.augments[other]?.[1] ?? "";
    if (!oddsAt.has(r)) {
      const flat = partnerPicks(taken.length, r, opts);
      oddsAt.set(r, opts.lucky ? Math.min(LUCKY_CAP, LUCKY_ODDS * flat)
        : RULES.tierOdds.on ? Math.min(COMBO_CAP, partnerOdds(taken.length, r, left.get(r) ?? 0, opts))
        : Math.min(COMBO_CAP, COMBO_ODDS * flat));
    }
    return oddsAt.get(r)!;
  };
  const info = new Map(own.map(([id, , , , se = -1, pick = -1]) => [id, { se, pick }]));
  const ranked = own
    .filter(([id]) => !taken.includes(id))
    .map(([id, score, deep = -1, est = 1]) => {
      let bonus = 0, mate: number | null = null, best = 0, potential = 0, combo: number | null = null;
      for (const [a, b, p] of pairs) {
        const other = a === id ? b : b === id ? a : null;
        if (other === null) continue;
        if (taken.includes(other)) {
          bonus += p;
          if (p > best) { best = p; mate = other; }
        } else if (!gone.has(other) && p > 0 && p * odds(other) > potential) {
          potential = p * odds(other);
          combo = other;
        }
      }
      const baseScore = score * 100 + bonus + (RULES.heartsteelStickers.on ? opts.stickers?.[id] ?? 0 : 0);
      const conflict = augmentConflict(picks, taken, id);
      return { id, score: baseScore + potential, boost: est ? baseScore : null, potential, combo, mate, deep, ...(conflict ? { conflict } : {}) } as RankedAugment;
    });
  if (RULES.transmuteDraw.on) transmuteDraw(picks, own, pairs, taken, gone, ranked);
  ranked.sort((x, y) => Number(!!x.conflict) - Number(!!y.conflict) || y.score - x.score);
  if (!opts.lucky) return ranked;
  return luckyOrder(ranked, (a) => info.get(a.id)?.se ?? null, (a) => info.get(a.id)?.pick ?? null);
}

// ---------------------------------------------------------------------------------------------------------------
// HEARTSTEEL stickers (headliner, 26.21+): a band member's sticker on an offered augment adds a bonus when you pick
// it. The bonuses are the game's own text (lol.stringtable kiwi_goh_heartsteelaugmentmodifier_*, 2026-11-24). Their
// value is ESTIMATED: each stat priced at basic-item gold (16.23: Long Sword 35 per AD, Amplifying Tome 20 per AP,
// Ruby Crystal 2.67 per health, Dagger 25 per 1% attack speed; ability haste 50 by the usual Glowing Mote convention;
// life steal 53.6 per 1% from Vampiric Scepter minus its AD, used for omnivamp), counted only when the champion uses
// that stat, then turned into win-rate points at 0.45 per 1,000 gold. That rate comes from the archive-free public
// augment data: Deft (60% attack speed, 1,500 gold) scores 0.6 points higher on champions whose build has attack
// speed than on ones without, Recursion (60 haste, 3,000 gold) 1.43 points higher with haste in the build: 0.40 and
// 0.48 per 1,000 gold. Per-level bonuses use the average level from the pick to 18. Aphelios' 2 Stat Anvils are the
// Stats! augment's own effect, so they take Stats!'s score on the champion plus the average augment's value (1.0
// point, from Deft on champions that don't build attack speed). K'Sante's level is priced at 600 gold: one level of base-stat
// growth is 376-661 gold across champions (median 506, Data Dragon 16.23.1), plus an ability rank and a higher cap (estimate).

export const STICKERS: Record<string, string> = {
  Aphelios: "2 Stat Anvils",
  Ezreal: "+4 AD and +4 AP per level",
  Kayn: "+5% omnivamp",
  "K'Sante": "+1 level and +1 level cap",
  Sett: "+30 health per level",
  Yone: "+40% attack speed and +20 ability haste",
};
export const STAT_GOLD = { ad: 35, ap: 20, hp: 400 / 150, as: 25, haste: 50, vamp: 53.6 };
export const POINTS_PER_1000_GOLD = 0.45;
const AVERAGE_AUGMENT_POINTS = 1.0;
const LEVEL_GOLD = 600;
const STATS_AUGMENT = 1404; // Stats!: gain 2 Stat Anvils

export type StickerValue = { member: string; gold: number; points: number; parts: { stat: string; gold: number; used: number }[]; why: string };

/** The estimated value of a HEARTSTEEL sticker for this champion and build, picked at `level`. */
export function stickerValue(member: string, champ: OverlayChamp | null | undefined, kinds: Kinds | null | undefined,
  picks: Picks | null | undefined, level = 1): StickerValue | null {
  if (!STICKERS[member] || !champ) return null;
  const magic = kinds?.champions?.[champ.id] ?? kinds?.champions?.[keyIn(kinds?.champions, champ.id) ?? ""] ?? 0.5;
  const build = [...(champ.items ?? []), ...(champ.rest ?? [])].slice(0, 6).map((it) => itemId(it.icon));
  const builds = (tag: string) => build.some((id) => (kinds?.items?.[String(id)] ?? []).includes(tag));
  const tanky = builds("armor") || builds("mr");
  const avgLevel = (Math.max(1, Math.min(18, level)) + 18) / 2;
  const parts: StickerValue["parts"] = [];
  const add = (stat: string, gold: number, used: number) => parts.push({ stat, gold: Math.round(gold), used });
  let flat: number | null = null;
  if (member === "Yone") { add("attack speed", 40 * STAT_GOLD.as, builds("as") ? 1 : 0); add("ability haste", 20 * STAT_GOLD.haste, builds("haste") ? 1 : 0); }
  if (member === "Ezreal") { add("attack damage", 4 * avgLevel * STAT_GOLD.ad, 1 - magic); add("ability power", 4 * avgLevel * STAT_GOLD.ap, magic); }
  if (member === "Sett") add("health", 30 * avgLevel * STAT_GOLD.hp, tanky ? 1 : 0.5);
  if (member === "Kayn") add("omnivamp", 5 * STAT_GOLD.vamp, 1);
  if (member === "K'Sante") add("a level", LEVEL_GOLD, 1);
  if (member === "Aphelios") {
    const ck = keyIn(picks?.champions, champ.id);
    const row = ck ? picks!.champions[ck].find(([id]) => id === STATS_AUGMENT) : undefined;
    flat = Math.max(0, (row ? row[1] * 100 : 0) + AVERAGE_AUGMENT_POINTS);
  }
  const gold = parts.reduce((t, p) => t + p.gold * p.used, 0);
  const points = flat ?? (gold / 1000) * POINTS_PER_1000_GOLD;
  const used = parts.filter((p) => p.used > 0).map((p) => p.stat);
  const why = flat !== null ? `${STICKERS[member]}: worth what the Stats! augment is on this champion (estimated)`
    : used.length ? `${STICKERS[member]}: about ${Math.round(gold / 50) * 50} gold of ${used.join(" and ")} you use (estimated)`
    : `${STICKERS[member]}: stats this build doesn't use (estimated)`;
  return { member, gold: Math.round(gold), points: Math.round(points * 100) / 100, parts, why };
}

/**
 * Cards on offer that are a near-tie with the best one (nearTies): the score gap is within 1.96 x the combined
 * standard error of the two real-game scores. Estimates (no standard error) are never called a tie.
 */
export function nearTies(picks: Picks, champ: string, offered0: { id: number; score: number; conflict?: string }[]): number[] {
  const offered = offered0.filter((o) => !o.conflict);
  if (!RULES.nearTies.on || offered.length < 2) return [];
  const ck = keyIn(picks.champions, champ);
  const se = new Map((ck ? picks.champions[ck] : []).map(([id, , , , e = -1]) => [id, e]));
  const best = offered.reduce((a, b) => (b.score > a.score ? b : a));
  const eb = se.get(best.id) ?? -1;
  if (eb < 0) return [];
  return offered.filter((o) => {
    const e = se.get(o.id) ?? -1;
    return o.id !== best.id && e >= 0 && best.score - o.score <= 1.96 * Math.sqrt(e * e + eb * eb);
  }).map((o) => o.id);
}

/**
 * Among the best card and its near-ties, the one to take if you can't decide (Nico 2026-11-24): more combo potential
 * first (it can grow), else the one fewer players take (more unusual). Null when nothing separates them.
 */
/** Augments that act through teammates (wiki text) and the allies they need (allyAugments). "carry": the ally's own
 *  hits trigger it (Empowered By The Faithful, Searing Dawn); "melee": it fires around allies in the fight (Sonic Boom,
 *  Windspeaker's Blessing, Empyrean Promise, Spirit Bomb, Wee Woo Wee Woo). */
export const ALLY_AUGMENTS: Record<number, "carry" | "melee"> = { 2004: "carry", 1072: "carry", 72: "carry", 1076: "melee", 76: "melee", 1331: "melee", 1095: "melee", 95: "melee", 2104: "melee", 1005: "melee" };
const CARRY_ARCH = new Set(["Marksman", "Burst", "Artillery", "Battlemage", "Assassin"]);
const MELEE_ARCH = new Set(["Vanguard", "Warden", "Juggernaut", "Diver", "Skirmisher", "Assassin"]);
/** Whether this team gives an ally augment what it needs: 2+ allies of that kind. */
export function allyFit(aug: number, allies: string[], fit: Fit | null): boolean {
  const need = RULES.allyAugments.on ? ALLY_AUGMENTS[aug] : undefined;
  if (!need || !fit) return false;
  const set = need === "carry" ? CARRY_ARCH : MELEE_ARCH;
  return allies.filter((c) => (fit.champions[keyIn(fit.champions, c) ?? ""]?.[1] ?? []).some((a) => set.has(a))).length >= 2;
}

export function tieBreak(picks: Picks, champ: string, ids: number[], ranked: RankedAugment[], team?: { allies: string[]; fit: Fit | null }): { id: number; why: string } | null {
  if (ids.length < 2) return null;
  const ck = keyIn(picks.champions, champ);
  const pickRate = new Map((ck ? picks.champions[ck] : []).map(([id, , , , , pr = -1]) => [id, pr]));
  const rows = ids.map((id) => ranked.find((a) => a.id === id)).filter((a): a is RankedAugment => !!a);
  if (rows.length < 2) return null;
  const pot = [...rows].sort((a, b) => b.potential - a.potential);
  if (pot[0].potential - pot[1].potential >= 0.05) return { id: pot[0].id, why: "more combo potential" };
  // an augment that works through teammates, when this team has the teammates for it (allyAugments)
  const helps = team ? rows.filter((a) => allyFit(a.id, team.allies, team.fit)) : [];
  if (helps.length === 1) return { id: helps[0].id, why: "your team suits it" };
  const rare = rows.filter((a) => (pickRate.get(a.id) ?? -1) >= 0).sort((a, b) => pickRate.get(a.id)! - pickRate.get(b.id)!);
  if (rare.length >= 2 && pickRate.get(rare[0].id)! < pickRate.get(rare[1].id)! * 0.8) return { id: rare[0].id, why: "fewer players take it" };
  return null;
}

export type RerollAdvice = {
  /** "reroll": reroll `card`; "keep": nothing worth rerolling. */
  action: "reroll" | "keep";
  card: number | null;
  best: number;
  /** Share of the pool that beats the best card on offer. */
  beats: number;
  /** Expected points gained by rerolling `card`. */
  gain: number;
  rarity: string;
  /** Command Line: this screen's rerolls still draw one tier higher. */
  hacked?: boolean;
};

const NEXT_TIER: Record<string, string> = { silver: "gold", gold: "prismatic", prismatic: "prismatic" };

/**
 * Reroll or keep. Rerolling a card swaps it for one drawn evenly from this champion's pool at the card's tier (every
 * card on a screen shares one), minus the cards on screen, the ones you took and every augment already shown this
 * game. Each card can be rerolled once, so cards in `rerolled` are never named. With the headliner known
 * (headlinerScreens): Command Line's first reroll on a screen draws one tier higher; Maestro's 4 cards need nothing
 * more; Debonair's card gold (`gold`) breaks a tie for the best card. Null when the pool is too small to judge.
 */
export function rerollAdvice(
  picks: Picks,
  ranked: RankedAugment[],
  offered: { id: number; score?: number | null; gold?: number | null }[],
  taken: number[],
  opts: { seen?: number[]; rerolled?: number[]; headliner?: string } = {},
): RerollAdvice | null {
  if (!offered.length) return null;
  const tierOf = (id: number) => picks.augments[id]?.[1] ?? "";
  // The screen's tier: the one most cards share (a hacked reroll leaves one card a tier higher).
  const tiers = offered.map((o) => tierOf(o.id));
  const r = tiers.reduce((a, b) => (tiers.filter((t) => t === b).length > tiers.filter((t) => t === a).length ? b : a), tiers[0]);
  const hl = RULES.headlinerScreens.on ? headlinerKey(opts.headliner) : "";
  const done = new Set(RULES.rerollOnce.on ? (opts.rerolled ?? []) : []);
  // Command Line: the first reroll on a screen is hacked; using it turns the others back to normal.
  const hacked = hl === "commandline" && !offered.some((o) => (opts.rerolled ?? []).includes(o.id));
  const gone = new Set([...taken, ...offered.map((o) => o.id), ...(RULES.seenAugments.on ? (opts.seen ?? []) : [])]);
  const poolAt = (tier: string) => ranked.filter((a) => tierOf(a.id) === tier && !gone.has(a.id)).map((a) => a.score);
  const pool = poolAt(r);
  if (pool.length < 5) return null;
  const low = Math.min(...pool);
  const scoreOf = (o: { id: number; score?: number | null }) => o.score ?? ranked.find((a) => a.id === o.id)?.score ?? low;
  const v = offered.map(scoreOf);
  const best = Math.max(...v);
  let pick = -1, gain = 0;
  v.forEach((_, j) => {
    if (done.has(offered[j].id)) return;
    const draw = hacked ? poolAt(NEXT_TIER[tierOf(offered[j].id)] ?? "") : poolAt(tierOf(offered[j].id));
    if (draw.length < 5) return;
    const keep = Math.max(...v.filter((__, k) => k !== j), -Infinity);
    const g = draw.reduce((t, x) => t + Math.max(keep, x), 0) / draw.length - best;
    if (g > gain) { gain = g; pick = j; }
  });
  const beats = pool.filter((x) => x > best).length / pool.length;
  const min = RULES.rerollMinGain.on ? REROLL_GAIN : 0;
  // Debonair: among cards that show the same score (to 0.1), the one with more gold.
  const same = (x: number) => Math.round(x * 10) === Math.round(best * 10);
  const tied = offered.map((o, k) => ({ o, k })).filter((x) => same(v[x.k]));
  const top = hl === "debonair" && tied.length > 1 ? tied.reduce((a, b) => ((b.o.gold ?? 0) > (a.o.gold ?? 0) ? b : a)) : { o: offered[v.indexOf(best)] };
  const bestId = top.o.id;
  const out = { best: bestId, beats, gain, rarity: r, ...(hacked ? { hacked: true } : {}) };
  return pick >= 0 && gain > 0 && gain >= min ? { action: "reroll", card: offered[pick].id, ...out } : { action: "keep", card: null, ...out };
}

// ---------------------------------------------------------------------------------------------------------------
// Enemy team

/** Enemy damage, 0 (all physical) to 1 (all magic): each champion's usual mix, pulled toward their finished items. */
export function enemyMagic(k: Kinds, enemies: Enemy[]): number | null {
  const lower = new Map(Object.entries(k.champions).map(([a, m]) => [a.toLowerCase(), m]));
  const mixes = enemies.filter((e) => e.champ).map((e) => {
    let ap = 0, ad = 0;
    if (RULES.itemDamageMix.on)
      for (const id of e.items) {
        const g = k.items[String(base(id))] ?? [];
        if (g.includes("ap") && !g.includes("ad")) ap += 1;
        if (g.includes("ad") && !g.includes("ap")) ad += 1;
      }
    return (2 * (lower.get(e.champ.toLowerCase()) ?? 0.5) + ap) / (2 + ap + ad);
  });
  return mixes.length ? mixes.reduce((a, b) => a + b, 0) / mixes.length : null;
}

const TANKY = new Set(["Vanguard", "Warden", "Juggernaut"]);
const BURSTY = new Set(["Burst", "Assassin"]);
const CATCH = new Set(["Catcher", "Vanguard"]);
// Life steal / omnivamp / big self-heal items, and shield or heal-and-shield-power items (PC 1.22.0).
export const SUSTAIN_ITEMS = new Set([3072, 3153, 3074, 4633, 3146, 6610, 6673, 3065, 3083]);
export const SHIELD_ITEMS = new Set([6617, 6620, 3504, 6616, 3107, 3190, 3222, 6621, 3053, 3040, 3156]);
// Champions whose kits heal a lot (from their ability descriptions), for "Vs healing" (PC 1.22.0, under audit).
export const HEALERS = new Set(["aatrox", "akshan", "alistar", "belveth", "briar", "drmundo", "fiddlesticks", "illaoi", "ivern", "kayn", "kled", "maokai", "milio", "nami", "nidalee", "olaf", "renataglasc", "senna", "sona", "soraka", "swain", "sylas", "taric", "trundle", "vladimir", "warwick", "yuumi", "zac", "seraphine", "darius", "fiora", "irelia", "masteryi", "udyr", "volibear", "yone"]);

/**
 * Counters that passed the mechanism test (2026-11-23, research/counter-items Steps 3 and 4): against their trigger
 * the buyer's share of that damage type dropped clearly more than with a matched other buy and than in the placebo.
 * These are real swaps; every other lit situational item stays a pointer.
 */
export const PROVEN: { when: string; items: number[] | "armor"; trigger: string }[] = [
  { when: "Vs magic damage", items: [2504, 3065, 3111], trigger: "magic" },
  { when: "Vs auto attacks", items: "armor", trigger: "marksmen" },
];

/** Each situation's reason in this game, or "" when it doesn't hold. */
export function triggers(k: Kinds, fit: Fit | null, enemies: Enemy[]): Record<string, string> {
  const list = enemies.filter((e) => e.champ);
  const arch = (e: Enemy) => fit?.champions?.[keyIn(fit.champions, e.champ) ?? ""]?.[1] ?? [];
  const count = (set: Set<string>) => list.filter((e) => arch(e).some((a) => set.has(a))).length;
  const tags = (e: Enemy) => e.items.flatMap((i) => k.items[String(base(i))] ?? []);
  const owns = (e: Enemy, set: Set<number>) => e.items.some((i) => set.has(base(i)));
  const tanky = list.filter((e) => arch(e).some((a) => TANKY.has(a)) || tags(e).filter((t) => t === "armor" || t === "mr").length >= 2).length;
  const crit = list.filter((e) => tags(e).filter((t) => t === "crit").length >= 2).length;
  const healers = list.filter((e) => HEALERS.has(champKey(e.champ)) || owns(e, SUSTAIN_ITEMS)).length;
  const shielders = list.filter((e) => arch(e).includes("Enchanter") || owns(e, SHIELD_ITEMS)).length;
  const marksmen = list.filter((e) => arch(e).includes("Marksman")).length;
  const magic = enemyMagic(k, list);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const n = (x: number, what: string) => `${x} ${x === 1 ? "enemy" : "enemies"} ${what}.`;
  const proven = {
    "Vs magic damage": magic !== null && magic >= 0.65 ? `Enemy damage is about ${pct(magic)} magic.` : "",
    // Armor cut the share of physical damage taken vs 2+ marksmen (-7 ± 3 pts, placebo -2 ± 1).
    "Vs auto attacks": marksmen >= 2 ? n(marksmen, "are marksmen") : "",
    "Vs heavy crowd control": RULES.ccCounters.on && count(CATCH) >= 3 ? n(count(CATCH), "lock you down") : "",
  };
  if (!RULES.countTriggers.on) return proven;
  return {
    ...proven,
    "Vs tanks": tanky >= 2 ? n(tanky, tanky === 1 ? "is tanky" : "are tanky") : "",
    "Vs burst": count(BURSTY) >= 2 ? n(count(BURSTY), "deal burst damage") : "",
    "Vs healing": healers >= 2 ? n(healers, "heal a lot") : "",
    "Vs physical damage": magic !== null && magic <= 0.35 ? `Enemy damage is about ${pct(1 - magic)} physical.` : "",
    "Vs mixed damage": magic !== null && magic > 0.4 && magic < 0.6 ? "Enemy damage is mixed." : "",
    "Vs crit carries": crit >= 1 ? n(crit, "build crit") : "",
    "Vs shields": shielders >= 2 ? n(shielders, "shield themselves or allies") : "",
    "Vs heavy crowd control": count(CATCH) >= 3 ? n(count(CATCH), "lock you down") : "",
  };
}

export type LitItem = Situational & { why: string; aug?: boolean; proven?: boolean; kit?: boolean };
/** Knight's Vow: you heal 12% of the damage your Worthy ally deals to champions (vowPartner). */
const KNIGHTS_VOW = 3109;
/** Champions whose abilities deal damage from the target's maximum health (ability text, Data Dragon 16.23). */
export const PCT_HEALTH = new Set(["aatrox", "kogmaw", "reksai", "sett", "shen", "sion", "varus", "vayne", "warwick", "zac"]);
const VOW_OWNERS = new Set(["Warden", "Vanguard", "Juggernaut", "Enchanter", "Catcher"]);
/** Mercury's Treads, Quicksilver Sash, Mercurial Scimitar, Silvermere Dawn. */
export const CC_ITEMS = new Set([3111, 3140, 3139, 6035]);
/** Fortified, Mystic Guard, Steadfaster Presence: what each multiplies. */
export const RESIST_AUGMENTS: Record<number, string[]> = { 3265: ["armor"], 3264: ["mr"], 3263: ["armor", "mr"] };

/**
 * The champion's situational items checked against this game: each gets the reason it applies now ("" when it
 * doesn't). Augment-driven entries light up once you take one of their augments and come first. Armor items also
 * answer "Vs auto attacks". `proven` marks the counters that passed the mechanism test.
 */
export function situational(champ: OverlayChamp | undefined, k: Kinds, fit: Fit | null, enemies: Enemy[], taken: number[], skip: Set<number>, augName: (id: number) => string = (id) => `#${id}`): LitItem[] {
  const own = champ?.situational ?? [];
  // Measured augment -> item patterns the champion's list doesn't already have.
  const prefix = ([...(champ?.items ?? []), ...own].find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
  // The patterns are measured over all champions: an AD item from one (Jeweled Gauntlet -> Infinity Edge) only fits a
  // build with no AD items when ADAPt turns that AD into AP (Nico 2026-11-24: "Infinity Edge on mages works if they
  // have ADAPt and Jeweled Gauntlet"; replay QA: Infinity Edge shown to Orianna with Jeweled Gauntlet alone).
  const hasAd = [...(champ?.items ?? []), ...(champ?.rest ?? []), ...(champ?.full ?? [])].some((it) => it?.icon && (k.items[String(itemId(it.icon))] ?? []).includes("ad"));
  const fitsBuild = (id: number) => hasAd || taken.includes(ADAPT) || !(k.items[String(id)] ?? []).includes("ad");
  const extra: Situational[] = RULES.augmentItems.on
    ? [...AUGMENT_ITEMS]
        .sort((x, y) => y.rate - x.rate)
        .filter((x, n, all) => taken.includes(x.augment) && k.recipes[x.item] && !own.some((it) => itemId(it.icon) === x.item) && !skip.has(x.item) && fitsBuild(x.item)
          && all.findIndex((y) => y.augment === x.augment && taken.includes(y.augment) && k.recipes[y.item] && !own.some((it) => itemId(it.icon) === y.item) && !skip.has(y.item) && fitsBuild(y.item)) === n)
        .map((x) => ({ name: k.recipes[x.item][0], icon: `${prefix}${220000 + x.item}.png`, when: `With ${x.augmentName}`, why: augmentItemWhy(x), augments: [x.augment] }))
    : [];
  // Every other augment you took: items its holders finish clearly more often than the same champion's players
  // without it (EB-shrunk build pull >= SHIFT_SWAP_MIN). The pulls are over all champions, so an item must also match
  // this champion's own build: no AD-only item on a champion whose build has no AD item, and the same for AP.
  if (RULES.augmentShift.on && taken.length) {
    const pure = (t: string[]) => (t.includes("ad") && !t.includes("ap") ? "ad" : t.includes("ap") && !t.includes("ad") ? "ap" : "");
    const tags = new Set([...(champ?.items ?? []), ...(champ?.rest ?? []), ...(champ?.full ?? [])].map((it) => (it?.icon ? pure(k.items[String(itemId(it.icon))] ?? []) : "")));
    const fits = (id: number) => { const p0 = pure(k.items[String(id)] ?? []); return !p0 || tags.has(p0); };
    const known = new Set([...own, ...extra].map((it) => itemId(it.icon)));
    const cand = new Map<number, { pull: number; by: number; sure: boolean }>();
    for (const a of taken)
      for (const [i, v] of Object.entries(AUGMENT_SHIFT[String(a)] ?? {})) {
        const id = Number(i);
        if (known.has(id) || skip.has(id) || !k.recipes[id] || k.boots.includes(id) || !fits(id)) continue;
        const sh = shiftOf(taken, id);
        if (sh.build >= SHIFT_SWAP_MIN && !cand.has(id)) cand.set(id, { pull: sh.build, by: a, sure: shiftSure(v, 0) });
      }
    for (const [id, c] of [...cand].sort((x, y) => y[1].pull - x[1].pull).slice(0, 2))
      extra.push({ name: k.recipes[id][0], icon: `${prefix}${220000 + id}.png`, when: `With ${augName(c.by)}`,
        why: `With ${augName(c.by)}, ${Math.round(c.pull * 100)}% more players build it (estimated)`, augments: [c.by] });
  }
  const list = [...own, ...extra].filter((it) => !skip.has(itemId(it.icon)));
  if (!list.length) return [];
  const t = triggers(k, fit, enemies);
  const has = new Set(taken.map(Number));
  const armor = (id: number) => (k.items[String(id)] ?? []).includes("armor");
  const out: LitItem[] = list.map((it) => {
    if (Array.isArray(it.augments))
      return { ...it, aug: true, why: it.augments.some((a) => has.has(Number(a))) ? it.why || it.when || "fits an augment you took" : "" };
    const id = itemId(it.icon);
    let why = t[it.when ?? ""] || "";
    let proven = false;
    // tenacity and cleanse items answer heavy CC (ccCounters), whatever situation the item is filed under
    const kit = RULES.ccCounters.on && !!t["Vs heavy crowd control"] && (CC_ITEMS.has(id) || it.when === "Vs heavy crowd control");
    if (kit) why = t["Vs heavy crowd control"];
    if (RULES.provenCounters.on) {
      for (const p of PROVEN) {
        const fitsItem = p.items === "armor" ? armor(id) : p.items.includes(id);
        if (!fitsItem || !t[p.when]) continue;
        if (p.when === it.when || p.items === "armor") { why = t[p.when]; proven = true; }
      }
    }
    return { ...it, why, proven, kit };
  });
  // Best item first in each group (Nico 2026-11-24: "sort by best at top"); entries without a DeepScore keep their place
  // after the scored ones.
  const best = (list: LitItem[]) => [...list].sort((x, y) => (y.deepScore ?? -Infinity) - (x.deepScore ?? -Infinity));
  return [...best(out.filter((it) => it.aug && it.why)), ...best(out.filter((it) => !(it.aug && it.why)))];
}

// ---------------------------------------------------------------------------------------------------------------
// Build path

export const STYLE_NAMES: Record<string, string> = { crit: "Crit", onhit: "On-hit", ap: "AP", lethality: "Lethality", fighter: "AD", tank: "Tank", enchanter: "Enchanter" };
// Items that grow with time or takedowns: first while no legendary is finished (PC 1.22.0, under audit).
export const STACKING = new Set([6697, 3084, 3070, 3004, 3003, 3119]);
export const BACK_TO_BASICS = new Set([1004, 4]);
// Champions whose R has a passive that works once R has a point (Riot's R descriptions), so Back to Basics still
// levels R; for the rest it takes R's only use away (Nico 2026-11-20).
export const R_PASSIVE = new Set(["ambessa", "annie", "belveth", "blitzcrank", "fiora", "galio", "gnar", "jax", "kayn", "khazix", "lux", "masteryi", "mel", "nidalee", "olaf", "pantheon", "reksai", "rengar", "ryze", "shyvana", "sona", "syndra", "teemo", "xinzhao", "zaahen"]);
// Augments that change how a champion builds whatever the style tags say (PC 1.22.0, under audit): 3 votes each.
export const BUILD_CHANGERS: Record<number, string[]> = { 1029: ["onhit"], 2018: ["ap"], 2123: ["ap"], 1388: ["ap"], 1205: ["ap"], 1206: ["lethality", "fighter"], 3049: ["tank"], 1324: ["tank"], 1353: ["tank"] };
// Measured augment -> build switches (website thread, 2026-11-23): the only ones on.
export const MEASURED_SWITCHES: Record<number, string> = { 1029: "onhit" };
// Confirmed augment -> item follow patterns (data/augment-items.json, shared with the site's lib/build-plan.ts).
export type AugmentItem = { augment: number; augmentName: string; item: number; itemName: string; rate: number; base: number; payoff: Record<string, number> | null; holders: number };
/** A with-vs-without comparison needs enough augment games: pairs with fewer holders are dropped (2026-11-23, owner-games
 *  reliance review; hides none of today's 26, the fewest is Protein Shake at 84). */
export const MIN_HOLDERS = 50;
export const AUGMENT_ITEMS: AugmentItem[] = (augmentItemsData.pairs as AugmentItem[]).filter((p) => p.holders >= MIN_HOLDERS);
const PAYOFF_WORD: Record<string, string> = { dmg: "damage", heal: "healing", mitig: "damage mitigated" };
/** "With Draw Your Sword, 19% of players build Death's Dance (2% without it)." Payoff words only where measured. */
export function augmentItemWhy(p: Pick<AugmentItem, "augmentName" | "itemName" | "rate" | "base" | "payoff">): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const gain = Object.entries(p.payoff ?? {}).map(([k, v]) => `${v > 0 ? "+" : "-"}${pct(Math.abs(v))} ${PAYOFF_WORD[k] ?? k}`).join(", ");
  return `With ${p.augmentName}, ${pct(p.rate)} of players build ${p.itemName} (${pct(p.base)} without it)${gain ? `; about ${gain} (estimated)` : ""}.`;
}
// "Upgrade X" augments and the items they upgrade (the augment's own name; Immolate and Sheen name item families).
export const UPGRADES: Record<number, number[]> = {
  1318: [3157], 1319: [3068, 6664, 2502], 1320: [6676], 1336: [3031], 1379: [4011], 1996: [3078, 3100, 6662, 3508, 2510],
  2140: [3074], 2143: [6610], 2157: [6333], 3150: [4646],
};
export const WEAPON_OF_DESTINY = 3081;
export const KING_ME = 1337;
const ORNN = "ornn";

/**
 * slotFirst: Weapon of Destiny, King Me and Ornn's Masterwork upgrade the first eligible Legendary in slots 1-6. When the
 * item you'd want upgraded isn't the first one, say which to move to slot 1. `owned` is in slot order; `path` is the
 * build path, most important first; `destiny` the champion's best Weapon of Destiny item.
 */
export function slotCue(
  game: GameState,
  taken: number[],
  path: Named[],
  destiny: number | null,
  k: Kinds | null,
  augName: (id: number) => string,
): { item: number; why: string; estimated: boolean } | null {
  if (!RULES.slotFirst.on || !k) return null;
  const boots = new Set(k.boots ?? []);
  const eligible = game.items.map(ownedId).filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !boots.has(i));
  if (eligible.length < 2) return null;
  const first = eligible[0];
  const byPath = path.map((it) => ownedId(itemId(it.icon))).find((i) => eligible.includes(i)) ?? null;
  const cue = (target: number | null, why: string, estimated: boolean) =>
    target !== null && target !== first ? { item: target, why, estimated } : null;
  if ((game.offer ?? []).includes(WEAPON_OF_DESTINY) && destiny !== null && eligible.includes(destiny))
    return cue(destiny, `Before taking ${augName(WEAPON_OF_DESTINY)}: it goes on your first Legendary (slots 1-6)`, false);
  const me = game.champ.toLowerCase() === ORNN;
  const ornnAlly = (game.allies ?? []).some((a) => a.champ.toLowerCase() === ORNN && a.level >= 13 && a.level <= 17);
  if ((me && (game.level ?? 0) >= 11 && (game.level ?? 0) < 13) || (!me && ornnAlly))
    return cue(byPath, me ? "Masterwork at level 13 upgrades your first Legendary (slots 1-6)" : "Ornn's Masterwork upgrades your first Legendary (slots 1-6)", true);
  if (taken.includes(KING_ME))
    return cue(byPath, `${augName(KING_ME)} upgrades your first Legendary when you enter the enemy gate`, true);
  return null;
}
/** augment -> item -> [build, early, holders, builders, z build, z early]: build = extra share of holders who finish
 *  the item, early = extra share with it as 1st/2nd legendary, both EB-shrunk (tools/augment_item_shift.py, DeepARAM-PC). */
/** Lean-in table (data/estimates/augment_lean_in.py): per augment, the items worth building around it (kit stat its text
 *  scales with + holders build it more, or a measured damage-share gain), whether its own number scales with that stat,
 *  and pairs where following the pull did clearly worse (z >= 3), which no rule may push. */
export type LeanIn = { name: string; items: number[]; how: "measured" | "kit" | null; kit: string[]; scaling: boolean; blocked: number[]; blockedVsSquishy?: number[] };
export const LEAN_IN = (augmentLeanInData as unknown as { pairs: Record<string, LeanIn> }).pairs;
const SHIFT_ALL = (augmentShiftData as { pairs: Record<string, Record<string, number[]>> }).pairs;
const dropPairs = (drop: (a: string, i: number) => boolean): Record<string, Record<string, number[]>> =>
  Object.fromEntries(Object.entries(SHIFT_ALL).map(([a, m]) => [a, Object.fromEntries(Object.entries(m).filter(([i]) => !drop(a, Number(i))))]));
/** Augment pulls the engine follows against 2+ enemy frontliners: pairs that did clearly worse are out. */
const SHIFT_VS_FRONT = dropPairs((a, i) => RULES.leanIn.on && !!LEAN_IN[a]?.blocked.includes(i));
/** Against squishier teams also without pairs that did worse there and aren't contradicted vs 2+ frontliners
 *  (Dual Wield -> BotRK: Nico 2026-11-24, BotRK is best vs high health). */
const SHIFT_VS_SQUISHY = dropPairs((a, i) => RULES.leanIn.on && (!!LEAN_IN[a]?.blocked.includes(i) || !!LEAN_IN[a]?.blockedVsSquishy?.includes(i)));
/** The pulls in use: plan() picks the set for this game's enemy frontline before anything reads it. */
export let AUGMENT_SHIFT: Record<string, Record<string, number[]>> = SHIFT_VS_SQUISHY;
/** Enemy frontliners (Warden/Vanguard/Juggernaut) for the pull set. */
export function shiftTableFor(frontliners: number) {
  AUGMENT_SHIFT = frontliners >= 2 ? SHIFT_VS_FRONT : SHIFT_VS_SQUISHY;
}
/** Path positions an item moves per 1.0 of shrunk early pull (Wooglet's -> Rabadon's 0.52 moves it ~4 places). */
export const SHIFT_ORDER_GAIN = 8;
/** augmentRush gates: build-share z, early-buy z, and build-share lift (21 pairs pass on the 2026-11-24 data). */
export const RUSH_Z_BUILD = 3, RUSH_Z_EARLY = 2, RUSH_LIFT = 0.15;
/** Shrunk build pull before an item outside your path becomes a swap (10 points more holders build it). */
export const SHIFT_SWAP_MIN = 0.1;
/** Converter augments (data/estimates/augment_converters.py): the kind of item the augment re-prices and the items of
 *  that kind its holders build most; `on` is false if archive players following it did clearly worse. */
export type Converter = { name: string; kind: string; champs: "ap" | "ad" | null; does: string; items: number[]; on: boolean };
export const CONVERTERS = (augmentConvertersData as unknown as { pairs: Record<string, Converter> }).pairs;
/** ADAPt (AD -> AP) and EscAPADe (AP -> AD), both id generations. */
const TO_AP = new Set([1205, 205]), TO_AD = new Set([1206, 206]);
/** Measured enough to drop "(estimated)": z >= 4 with 50+ holders. */
const shiftSure = (v: number[] | undefined, at: 0 | 1) => !!v && Math.abs(v[4 + at]) >= 4 && v[2 + at] >= 50;
/** Sum of the taken augments' pulls on an item: [build, early, the augment pulling hardest early, sure]. */
export function shiftOf(taken: number[], id: number): { build: number; early: number; by: number | null; sure: boolean } {
  let build = 0, early = 0, by: number | null = null, top = 0, sure = false;
  if (!RULES.augmentShift.on) return { build, early, by, sure };
  for (const a of taken) {
    const v = AUGMENT_SHIFT[String(a)]?.[String(id)];
    if (!v) continue;
    build += v[0]; early += v[1];
    if (Math.abs(v[1]) > top) { top = Math.abs(v[1]); by = a; sure = shiftSure(v, 1); }
  }
  return { build, early, by, sure };
}

/** A style build for a champion with none of that style: the style's usual items over all champions. */
export function classBuild(picks: Picks, k: Kinds, style: string, magic: boolean, rules: ItemRules): [number[], number[]] | null {
  const score: Record<number, number> = {}, core: Record<number, number> = {};
  for (const builds of Object.values(picks.builds ?? {}))
    for (const [st, share, , c3, rest] of builds) {
      if (st !== style) continue;
      c3.forEach((id) => { score[id] = (score[id] ?? 0) + share; core[id] = (core[id] ?? 0) + share; });
      rest.forEach((id, i) => { score[id] = (score[id] ?? 0) + share * (1 - i * 0.15); });
    }
  const fits = (id: number) => { const t = k.items[String(base(id))] ?? []; return style === "tank" || t.includes(magic ? "ap" : "ad"); };
  const ids = Object.keys(score).map(Number).filter(fits);
  const pickFree = (cands: number[], n: number, keep: number[]) => {
    const out: number[] = [];
    for (const id of cands) if (out.length < n && ![...keep, ...out].some((o) => rules.clash(o, id))) out.push(id);
    return out;
  };
  const byCore = pickFree([...ids].sort((a, b) => (core[b] ?? 0) - (core[a] ?? 0)), 3, []);
  const rest = pickFree(ids.filter((id) => !byCore.includes(id)).sort((a, b) => score[b] - score[a]), 5, byCore);
  return byCore.length === 3 ? [byCore, rest] : null;
}

export type BuildPick = { list: Named[]; style: string | null; core: number | null; because?: string; classWide?: boolean; niche?: boolean };

/**
 * The build to follow: the champion's usual one or, once the augments you took point to another style (on-hit, AP,
 * tank...), that style: the champion's own build of it if players make one, else the class-wide style build. Only
 * what you haven't bought is re-planned: items you own stay.
 */
export function pickBuild(base0: Named[], picks: Picks | null, k: Kinds | null, champ: string, taken: number[], owned: Set<number>, rules: ItemRules,
  forced: { style: string; because: string; magic: boolean } | null = null): BuildPick {
  if (!k || !picks) return { list: base0, style: null, core: null };
  if (!forced && (!(RULES.augmentReplan.on || RULES.measuredReplan.on) || !taken.length)) return { list: base0, style: null, core: null };
  const ck = keyIn(picks.builds, champ);
  const styles = ck ? picks.builds![ck] : [];
  const votes: Record<string, number> = {}, because: Record<string, number> = {};
  for (const id of taken) {
    // Niche builds (nicheBuilds): the champion's own niche style that this augment unlocks.
    if (RULES.nicheBuilds.on)
      for (const [st, , , , , triggers] of styles)
        if (triggers?.includes(id)) { votes[st] = (votes[st] ?? 0) + 3; because[st] = id; }
    const measured = RULES.measuredReplan.on && MEASURED_SWITCHES[id] ? [MEASURED_SWITCHES[id]] : undefined;
    const strong = measured ?? (RULES.augmentReplan.on ? BUILD_CHANGERS[id] : undefined);
    for (const st of strong ?? (RULES.augmentReplan.on ? picks.styles[id] : undefined) ?? []) {
      votes[st] = (votes[st] ?? 0) + (strong ? 3 : 1);
      if (strong) because[st] = id;
    }
  }
  // the items you bought re-plan only when no augment switched the build
  // Candidates by votes (at equal votes a style the champion has its own build for goes first), then the style your
  // items point to. A style that can't make a plan (no own build, no class build) doesn't block the next one.
  const own = (x: string) => (styles.some(([y]) => y === x) ? 0 : 1);
  const cands: [string, number][] = Object.entries(votes).sort((x, y) => y[1] - x[1] || own(x[0]) - own(y[0]));
  if (forced && !votes[forced.style]) cands.push([forced.style, 3]);
  let st = "", byItems = false, found: (typeof styles)[number] | undefined, plan: number[][] | null = null;
  for (const [x, n] of cands) {
    st = x;
    byItems = !!forced && x === forced.style && !votes[x];
    if (styles[0]?.[0] === x) return { list: base0, style: null, core: null };
    found = styles.find(([y]) => y === x);
    plan = found ? [found[2].slice(0, 1), found[3], found[4]] : null;
    if (!plan && n >= 3 && (RULES.augmentReplan.on || byItems)) {
      const magic = byItems ? forced!.magic : (Object.entries(k.champions).find(([a]) => a.toLowerCase() === champ.toLowerCase())?.[1] ?? 0.5) > 0.5;
      const cb = classBuild(picks, k, x, magic, rules);
      const boots = base0.find((it) => k.boots.includes(itemId(it.icon)));
      if (cb) plan = [boots ? [itemId(boots.icon)] : [], cb[0], cb[1]];
    }
    if (plan) break;
  }
  if (!plan) return { list: base0, style: null, core: null };
  const prefix = (base0[0]?.icon ?? "").replace(/\d+\.png$/, "");
  // build lists mix plain ids and Mayhem ids; the art for finished items sits under the Mayhem id (22 + id)
  const mk = (id: number): Named | null => {
    // ids as the game reports them (The Collector's 667666 is 6676); an item the data doesn't know is left out
    const b = ICON_ID[id] ?? base(id);
    if (!k.recipes[b]) return null;
    const fin = id >= 220000 || (k.recipes[b]?.[1] ?? 0) >= 2000;
    return { name: k.recipes[b][0], icon: `${prefix}${ICON_ID[id] ? id : fin ? 220000 + b : b}.png` };
  };
  const fresh = [...plan[0].slice(0, 1), ...plan[1], ...plan[2]].flatMap((id) => mk(id) ?? []);
  const kept = byItems ? [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 || k.boots.includes(i)).flatMap((i) => base0.find((it) => ownedId(itemId(it.icon)) === i) ?? mk(i) ?? [])
    : [...base0.filter((it) => owned.has(itemId(it.icon))), ...[...owned].filter((i) => k.boots.includes(i) && !base0.some((it) => itemId(it.icon) === i)).flatMap((i) => mk(i) ?? [])];
  const keptIds = kept.map((it) => itemId(it.icon));
  const list: Named[] = [...kept];
  // boots you own are your boots: the new style's boots aren't added on top
  const hasBoots = keptIds.some((i) => k.boots.includes(i));
  for (const it of fresh) {
    const id = itemId(it.icon);
    if (keptIds.includes(id) || (hasBoots && k.boots.includes(id)) || list.some((x) => rules.clash(itemId(x.icon), id))) continue;
    list.push(it);
  }
  const why = byItems ? forced!.because : because[st] ? (picks.augments[because[st]]?.[0] ?? "") : "";
  const sized = list.slice(0, 6);
  const niche = !!found?.[5]?.length && found[5]!.includes(because[st]);
  return { list: sized, style: STYLE_NAMES[st] ?? st, core: Math.min(sized.length, (plan[0].length ? 1 : 0) + 3), because: why, classWide: !found, ...(niche ? { niche: true } : {}) };
}

/**
 * One pick per 4th/5th/6th item slot: an owned item from the slot's list, else the site's "full" path pick, else the
 * slot's first item, never one that clashes with the core or an earlier pick. Null without slot data.
 */
export function laterPicks(champ: OverlayChamp | undefined, owned: Set<number>, rules: ItemRules): { slot: number; it: Named; alts: Named[] }[] | null {
  const slots = champ?.laterSlots;
  if (!slots?.length) return null;
  const used = (champ?.items ?? []).map((it) => itemId(it.icon));
  const ok = (id: number) => !used.includes(id) && !used.some((u) => rules.clash(u, id));
  const fullRest = (champ?.full ?? []).filter((it) => it?.icon && !used.includes(itemId(it.icon)));
  // Six items in all, boots included, as on the site's card (lib/card-score.ts fullPicks).
  const room = Math.max(0, 6 - (champ?.items ?? []).length);
  const out: { slot: number; it: Named; alts: Named[] }[] = [];
  [...slots].sort((a, b) => a.slot - b.slot).slice(0, room).forEach((s, n) => {
    // the full path's pick, with the slot's own row for it when it has one (that row carries the near-tie flag)
    const fr = fullRest[n] && ok(itemId(fullRest[n].icon)) ? fullRest[n] : null;
    const pick = fr ? [(s.items ?? []).find((x) => itemId(x.icon) === itemId(fr.icon)) ?? fr] : [];
    const items = [...pick, ...(s.items ?? []).filter((x) => !pick.length || itemId(x.icon) !== itemId(pick[0].icon))];
    const free = items.filter((it) => ok(itemId(it.icon)));
    const it = free.find((x) => owned.has(itemId(x.icon))) ?? free[0];
    if (!it) return;
    used.push(itemId(it.icon));
    out.push({ slot: s.slot, it, alts: free.filter((x) => x !== it).slice(0, 2) });
  });
  return out.length ? out : null;
}

/** What your gold buys now toward the next item: the item itself, else its priciest missing part you can afford. */
export function buyNow(k: Kinds, nextId: number, owned: Set<number>, gold: number): { id: number; name: string; whole: boolean; cost?: number } | null {
  const r = k.recipes[nextId];
  if (!r) return null;
  const have = r[2].filter((c) => owned.has(c)).reduce((sum, c) => sum + (k.recipes[c]?.[1] ?? 0), 0);
  if (gold >= r[1] - have) return { id: nextId, name: r[0], whole: true };
  const parts = r[2].filter((c) => !owned.has(c) && (k.recipes[c]?.[1] ?? 1e9) <= gold).sort((x, y) => k.recipes[y][1] - k.recipes[x][1]);
  return parts.length ? { id: parts[0], name: k.recipes[parts[0]][0], whole: false, cost: k.recipes[parts[0]][1] } : null;
}

/** On level-up: where the point goes. R at 6, 11 and 16; with Back to Basics only when R has a passive. */
export function skillUp(order: string[] | undefined, pts: number[], level: number, taken: number[], champ: string, eCap = 5, split?: { first: string; points: number }): string {
  const spent = pts.reduce((a, b) => a + b, 0);
  if (!order?.length || !pts.length || spent >= level) return "";
  const noR = !R_PASSIVE.has(champKey(champ)) && taken.some((id) => BACK_TO_BASICS.has(id));
  const rDue = [6, 11, 16].filter((l) => l <= level).length;
  if (!noR && pts[3] < rDue) return "R";
  const idx: Record<string, number> = { Q: 0, W: 1, E: 2 };
  const cap = Math.min(5, Math.ceil(level / 2));
  const lead = split && RULES.skillSplits.on ? [split.first, ...order] : order;
  const first = level <= 3 && lead.find((key) => pts[idx[key]] === 0);
  if (first) return first;
  // A split (Katarina: Q to 3, then max E): the split ability first, up to its points.
  if (split && RULES.skillSplits.on && idx[split.first] !== undefined && pts[idx[split.first]] < Math.min(split.points, cap)) return split.first;
  return order.find((key) => pts[idx[key]] < Math.min(cap, key === "E" ? eCap : 5)) || "";
}

// ---------------------------------------------------------------------------------------------------------------
// Why an item is there, and Feeling lucky's build

const METRIC_WORD: Record<string, string> = { damage: "damage to champions", healing: "healing", mitigated: "damage mitigated", cc: "crowd control", deaths: "deaths per 10 min" };

/**
 * One line on why an item is best for this champion, from tested reasons only, else null (research/why-best section 5,
 * Nico approved 2026-11-23): a confirmed augment pattern for an augment you took; most of the champion's players
 * build it; the kit explains it (10 items only, and only on the right side of the trait); what it does (archive,
 * estimated). Never a win rate.
 */
export function whyBest(id: number, champ: string, name: string, taken: number[], why: WhyData | null | undefined, profiles?: Profiles | null): { text: string; kind: "augment" | "follow" | "kit" | "does"; estimated?: boolean } | null {
  if (!RULES.whyBest.on) return null;
  const b = base(id);
  const aug = [...AUGMENT_ITEMS].sort((x, y) => y.rate - x.rate).find((p) => p.item === b && taken.includes(p.augment));
  if (aug && RULES.augmentItems.on) return { text: augmentItemWhy(aug), kind: "augment" };
  const alias = keyIn(why?.follow, champ);
  if (alias && (why!.follow[alias][String(b)] ?? 0) >= 0.5) return { text: `Built by most ${name} players.`, kind: "follow" };
  const trait = why?.kit[String(b)];
  const side = why?.traits[keyIn(why?.traits, champ) ?? ""];
  if (trait && side) {
    if (trait === "physical" && side.physical) return { text: `Fits ${name}'s physical damage.`, kind: "kit" };
    if (trait === "carry" && !side.tank) return { text: "Fits a carry, not a tank.", kind: "kit" };
    if (trait === "tank" && side.tank) return { text: "Fits a champion who takes the hits.", kind: "kit" };
    if (trait === "melee" && side.melee) return { text: "Stronger on melee champions.", kind: "kit" };
  }
  // Same cut as the site's lib/mechanisms.ts: |z| >= 3 and big enough to matter.
  const p = profiles?.items?.[String(b)];
  if (p) {
    // Only a gain is a reason it's best: more damage, healing, mitigation or cc, fewer deaths (2026-11-23).
    const gain = (k: string) => (k === "deaths" ? p[k].change < 0 : p[k].change > 0);
    const m = Object.keys(METRIC_WORD)
      .filter((k) => p[k] && gain(k) && Math.abs(p[k].z) >= 3 && Math.abs(p[k].change) >= (k === "deaths" ? 0.3 : 8))
      .sort((x, y) => Math.abs(p[y].z) - Math.abs(p[x].z))[0];
    if (m) {
      const c = p[m].change;
      const n = m === "deaths" ? Math.abs(c).toFixed(1) : `${Math.round(Math.abs(c))}%`;
      return { text: `What it does: ${c > 0 ? "+" : "-"}${n} ${METRIC_WORD[m]} (estimated).`, kind: "does", estimated: true };
    }
  }
  return null;
}

/** Feeling lucky: the least played build style whose win rate is roughly the best's (95% ranges overlap), else null. */
export function luckyBuild(champ: OverlayChamp | undefined): NonNullable<OverlayChamp["builds"]>[number] | null {
  const list = champ?.builds ?? [];
  if (!RULES.luckyTilt.on || list.length < 2) return null;
  const near = list.slice(1).filter((b) => b.nearBest && b.share < list[0].share && b.items?.length);
  return near.sort((a, b) => a.share - b.share)[0] ?? null;
}

/** Must-have items per champion (mustCore, data/estimates/core_strictness.py): held at game end by 50%+ of players. */
export const CORE_STRICTNESS = (coreStrictnessData as unknown as { champions: Record<string, { must: number[]; hold: Record<string, number> }> }).champions;
export function mustHave(champ: string): Set<number> {
  if (!RULES.mustCore.on) return new Set();
  const key = keyIn(CORE_STRICTNESS, champ) ?? Object.keys(CORE_STRICTNESS).find((c) => champKey(c) === champKey(champ));
  return new Set(key ? CORE_STRICTNESS[key].must : []);
}

// ---------------------------------------------------------------------------------------------------------------
// Breakpoints (breakpoints): penetration and %-health picks are worth more against an unusually tanky enemy team

type BreakpointData = { champions: Record<string, number[]>; items: Record<string, number[]>; finished: number[]; avgChampion: number[]; refItems: number[][]; cut: Record<string, number> };
const BP = breakpointData as unknown as BreakpointData;
const BP_FINISHED = new Set(BP.finished);
export type Breakpoint = { id: number; kind: "item" | "augment"; stat: "armor" | "mr" | "hp"; passed: boolean; value: number; threshold: number; why: string; estimated: true };
/** Item -> the enemy stat it answers and the damage type it's for. */
const BP_ITEMS: [number, "armor" | "mr" | "hp", "ad" | "ap"][] = [
  [3036, "armor", "ad"], [3033, "armor", "ad"], [6694, "armor", "ad"], [3071, "armor", "ad"], [3135, "mr", "ap"], [3137, "mr", "ap"],
  [3153, "hp", "ad"], [3036, "hp", "ad"], [6653, "hp", "ap"], [4637, "hp", "ap"],
];
/** Thread the Needle: 18% armor and magic penetration (wiki). */
const THREAD_THE_NEEDLE = [1084, 84];
const growStat = (base: number, per: number, lvl: number) => base + per * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1));

/** The enemy team's average [health, armor, MR] and a typical team's at the same levels and item counts. */
export function enemyStats(enemies: Enemy[], level = 18): { got: number[]; usual: number[] } | null {
  const list = enemies.filter((e) => e.champ && BP.champions[champKey(e.champ)]);
  if (!list.length) return null;
  const got = [0, 0, 0], usual = [0, 0, 0];
  for (const e of list) {
    const c = BP.champions[champKey(e.champ)], lvl = e.level ?? level;
    const own = e.items.reduce((t, i) => t.map((x, j) => x + (BP.items[String(base(i))]?.[j] ?? 0)), [0, 0, 0]);
    const n = Math.min(6, e.items.filter((i) => BP_FINISHED.has(base(i))).length);
    for (let j = 0; j < 3; j++) {
      got[j] += (growStat(c[j], c[j + 3], lvl) + own[j]) / list.length;
      usual[j] += (growStat(BP.avgChampion[j], BP.avgChampion[j + 3], lvl) + BP.refItems[n][j]) / list.length;
    }
  }
  return { got, usual };
}

/** Breakpoint picks for this champion in this game: passed when the enemy stat clears the tanky-game cut. */
export function breakpoints(enemies: Enemy[], level: number, magic: boolean, known: Set<number>, pool: Set<number>): Breakpoint[] {
  if (!RULES.breakpoints.on) return [];
  const st = enemyStats(enemies, level);
  if (!st) return [];
  const idx = { hp: 0, armor: 1, mr: 2 } as const;
  const words = { hp: "health", armor: "armor", mr: "magic resist" } as const;
  const check = (stat: "armor" | "mr" | "hp") => {
    const value = Math.round(st.got[idx[stat]]), threshold = Math.round(st.usual[idx[stat]] * BP.cut[stat]);
    return { value, threshold, passed: value >= threshold, why: `Enemy ${words[stat]} about ${value} (tanky from ${threshold}, usual ${Math.round(st.usual[idx[stat]])})` };
  };
  const out: Breakpoint[] = [];
  for (const [id, stat, type] of BP_ITEMS) {
    if ((type === "ap") !== magic || !known.has(id)) continue;
    const c = check(stat);
    const prev = out.find((b) => b.id === id);
    if (prev) { if (!prev.passed && c.passed) Object.assign(prev, { stat, ...c }); continue; }
    out.push({ id, kind: "item", stat, ...c, estimated: true });
  }
  const ttn = THREAD_THE_NEEDLE.find((a) => pool.has(a));
  if (ttn !== undefined) out.push({ id: ttn, kind: "augment", stat: magic ? "mr" : "armor", ...check(magic ? "mr" : "armor"), estimated: true });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The plan

export type Swap = { item: Named; replaces: Named | null; at: number; why: string; kind: "augment" | "proven" | "kit" };
export type Tip = { rank: number; kind: string; text: string; item?: number };
export type Plan = {
  /** The whole path in buying order: core, then the 4th/5th/6th picks. */
  path: Named[];
  coreLen: number;
  /** Up to two items to buy next, first one first. */
  next: Named[];
  /** One line per path item: why it's there. */
  why: string[];
  /** Path items this game calls for, with the reason. */
  lit: { item: Named; why: string }[];
  /** Real swaps: augment-driven or proven counters. Each replaces the item it clashes or substitutes with, else the
   *  last open slot. */
  swaps: Swap[];
  /** Lit situational items that aren't proven: shown as a pointer only. */
  pointers: { item: Named; why: string; replaces: Named | null }[];
  /** Your augments switched the build. */
  switched: { style: string; because: string; classWide: boolean; instead: Named | null } | null;
  /** Items moved up for an augment you took. */
  timing: { item: Named; because: string }[];
  tips: Tip[];
  /** The rules this plan used, with their sources (RULES). */
  rules: string[];
  /** One tested reason per path item, or null (whyBest). */
  reasons: ({ text: string; kind: string; estimated?: boolean } | null)[];
  /** Feeling lucky picked a less played build style that wins about as often. */
  luckyStyle: string | null;
  /** The max order for the build this plan follows (augment, Archmage route or switched style), and its split. */
  skills?: string[];
  skillSplit?: OverlayChamp["skillSplit"];
  /** slotFirst: move this owned item to slot 1 before an effect upgrades your first Legendary. */
  slotCue: { item: Named; why: string; estimated: boolean } | null;
  /** Items and augments whose value grows with enemy armor, magic resist or health, checked against this game. */
  breakpoints: Breakpoint[];
};

export type PlanInput = {
  champ: OverlayChamp | undefined;
  kinds: Kinds | null;
  picks: Picks | null;
  fit: Fit | null;
  game: GameState;
  taken: number[];
  /** Feeling lucky: lean toward rarer near-tie options. */
  lucky?: boolean;
  /** why-best.json and mechanism-profiles.json, for the "why it's best" lines. */
  why?: WhyData | null;
  profiles?: Profiles | null;
};

/** The starting items to show: the first augment's own start when it has one (augmentStart); else, with more gold
 *  than the 1,400 everyone starts with (the Debonair headliner pays gold per augment pick), the best start above
 *  1,400 you can afford (richStart); else the champion's. With gold left over and the item recipes (damage-types.json),
 *  the rest goes on the parts of the item that start leads to (goldFill). */
export function startFor(
  champ: Pick<OverlayChamp, "start" | "augmentStarts" | "richStarts" | "items"> | undefined,
  taken: number[],
  gold?: number,
  kinds?: Pick<Kinds, "recipes" | "boots"> | null,
): { start: Named[]; augment: number | null; rich: boolean; filled: boolean } {
  const hit = RULES.augmentStart.on && taken.length ? champ?.augmentStarts?.find((a) => a.augment === taken[0]) : undefined;
  const rich = !hit && RULES.richStart.on && gold !== undefined && gold > START_GOLD ? champ?.richStarts?.find((r) => r.cost <= gold) : undefined;
  const start = hit?.start ?? rich?.start ?? champ?.start ?? [];
  const out = { start, augment: hit?.augment ?? null, rich: !!rich, filled: false };
  if (!RULES.goldFill.on || gold === undefined || gold <= START_GOLD || !kinds?.recipes) return out;
  const core = (champ?.items ?? []).map((it) => itemId(it.icon)).filter((i) => i && !kinds.boots?.includes(i));
  const targets = [...(hit?.toward ? [hit.toward] : []), ...core].filter((x, n, a) => a.indexOf(x) === n);
  const ids = fillStart(start.map((it) => itemId(it.icon)), targets, gold, kinds.recipes);
  if (!ids) return out;
  const prefix = ([...start, ...(champ?.items ?? [])].find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
  const known = new Map(start.map((it) => [itemId(it.icon), it]));
  return { ...out, filled: true, start: ids.map((i) => known.get(i) ?? { name: kinds.recipes[i]?.[0] ?? `#${i}`, icon: prefix ? `${prefix}${i}.png` : null }) };
}

type Part = { id: number; own: number; kids: Part[]; have?: boolean };
/** Spends the gold left after a start on the targets' parts (recipes: id -> [name, total cost, parts]): the biggest
 *  part that fits first, owned parts counted; on to the next target once nothing more fits. null when nothing is
 *  bought. */
export function fillStart(start: number[], targets: number[], gold: number, recipes: Kinds["recipes"]): number[] | null {
  const cost = (i: number) => recipes[i]?.[1];
  if (start.some((i) => cost(i) === undefined)) return null;
  let have = [...start];
  let left = gold - have.reduce((sum, i) => sum + (cost(i) ?? 0), 0);
  let bought = false;
  const tree = (i: number, depth = 0): Part | null => {
    const r = recipes[i];
    if (!r) return null;
    const kids = depth < 4 ? r[2].flatMap((k) => tree(k, depth + 1) ?? []) : [];
    // A part missing from the recipes can't be priced: never buy around it.
    if (kids.length !== r[2].length) return { id: i, own: Infinity, kids: [] };
    return { id: i, own: r[1] - kids.reduce((sum, k) => sum + (cost(k.id) ?? 0), 0), kids };
  };
  const mark = (n: Part, owned: number[]) => {
    const k = owned.indexOf(n.id);
    n.have = k >= 0;
    if (n.have) owned.splice(k, 1);
    else for (const c of n.kids) mark(c, owned);
  };
  const price = (n: Part): number => (n.have ? 0 : n.own + n.kids.reduce((sum, c) => sum + price(c), 0));
  const open = (n: Part): Part[] => (n.have ? [] : [n, ...n.kids.flatMap(open)]);
  const inside = (n: Part): number[] => n.kids.flatMap((c) => (c.have ? [c.id] : inside(c)));
  for (const target of targets) {
    for (let step = 0; step < 8 && left > 0; step++) {
      const t = tree(target);
      if (!t) break;
      mark(t, [...have]);
      const pick = open(t).map((n) => ({ n, p: price(n) })).filter((x) => x.p > 0 && x.p <= left).sort((x, y) => y.p - x.p)[0];
      if (!pick) break;
      // Owned parts of what we buy go into it.
      const used = inside(pick.n);
      have = have.filter((i) => {
        const k = used.indexOf(i);
        if (k < 0) return true;
        used.splice(k, 1);
        return false;
      });
      have.push(pick.n.id);
      left -= pick.p;
      bought = true;
      if (pick.n === t) break;
    }
    if (left <= 0) break;
  }
  return bought ? have : null;
}

/** Every player's gold at 0:00 (the owner's archive, all patches). */
export const START_GOLD = 1400;

const ord = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** Augments that favor one basic ability: Bread and Butter / Jam / Cheese (+100 haste on Q / W / E, short and long
 *  ids) and Pentakill HEAVY / POWER / THRASH (+20 haste and +10% on Q / W / E). Game data (wiki augment list). */
export const SLOT_AUGMENTS: Record<number, "Q" | "W" | "E"> = { 103: "Q", 1103: "Q", 150: "W", 1150: "W", 151: "E", 1151: "E", 3170: "Q", 3171: "W", 3172: "E" };

/**
 * A weaker-evidence split tipped by your augments (splitAugments): an augment on the split's 3-point ability maxes it
 * first; one on the maxed ability maxes that from the start. Both or neither: the split stays.
 */
export function splitFor(order: string[] | undefined, split: OverlayChamp["skillSplit"], taken: number[]): { order: string[] | undefined; split: OverlayChamp["skillSplit"]; tipped: boolean } {
  if (!split?.weak || !RULES.splitAugments.on || !order?.length) return { order, split, tipped: false };
  const fav = new Set(taken.map((id) => SLOT_AUGMENTS[id]).filter(Boolean));
  const onFirst = fav.has(split.first as "Q"), onMax = fav.has(order[0] as "Q");
  if (onFirst === onMax) return { order, split, tipped: false };
  return { order: onFirst ? [split.first, ...order.filter((x) => x !== split.first)] : order, split: undefined, tipped: true };
}

/** Champions whose own passive turns crit over 100% into AD (Yasuo, Yone: 0.5 bonus AD per 1%, wiki). */
export const CRIT_CONVERTERS = new Set(["yasuo", "yone"]);

export function plan({ champ: champ0, kinds: k, picks, fit, game, taken, lucky, why: whyData, profiles }: PlanInput): Plan {
  const rules = itemRules(k);
  const used = new Set<string>();
  const applied = (r: string) => used.add(r);
  shiftTableFor((game.enemies ?? []).filter((e) => (fit?.champions?.[keyIn(fit.champions, e.champ) ?? ""]?.[1] ?? []).some((a) => TANKY.has(a))).length);
  const alt = lucky && !game.items.some((i) => (k?.recipes[ownedId(i)]?.[1] ?? 0) >= 2000) ? luckyBuild(champ0) : null;
  if (alt) applied("luckyTilt");
  const champ1: OverlayChamp | undefined = alt && champ0 ? { ...champ0, ...alt, id: champ0.id, builds: champ0.builds, destiny: champ0.destiny } : champ0;
  // AP Ashe with Archmage: the haste route for the loop augments you took (the route with the most of them).
  const arch = RULES.archmageRoute.on && champ0?.archmage && taken.includes(champ0.archmage.augment) ? champ0.archmage : null;
  const route = arch
    ? [...arch.routes].filter((r) => r.with.every((a) => taken.includes(a))).sort((x, y) => y.with.length - x.with.length)[0] ?? null
    : null;
  if (route) applied("archmageRoute");
  const champ2: OverlayChamp | undefined =
    route && champ1 && arch
      ? { ...champ1, items: route.items.slice(0, 1 + route.routeLen), rest: route.items.slice(1 + route.routeLen), laterSlots: undefined, skills: arch.skills }
      : champ1;
  // A skill order that changes with an augment you took (Gwen with Ethereal Weapon).
  const augSkill = RULES.augmentSkills.on ? champ0?.augmentSkills?.find((a) => taken.includes(a.augment)) : undefined;
  if (augSkill) applied("augmentSkills");
  const champ: OverlayChamp | undefined = augSkill && champ2 ? { ...champ2, skills: augSkill.skills } : champ2;
  const owned: Set<number> = new OwnedItems(game.items);
  const bootIds = new Set(k?.boots ?? []);
  let slotRows = laterPicks(champ, owned, rules);
  const placedOff = new Set<number>();  // off-path items you own that ownedOffPath put in later slots
  if (slotRows && RULES.itemLimits.on) applied("itemLimits");
  // Off the path (ownedReplan): two or more finished items the path doesn't list, of the other damage type than the
  // path, switch what's left to the class-wide style build that holds the most of what you own.
  let forced: { style: string; because: string; magic: boolean } | null = null;
  if (RULES.ownedReplan.on && k && picks) {
    const listed = new Set([...(champ?.items ?? []), ...(champ?.rest ?? []), ...(slotRows ?? []).flatMap((r) => [r.it, ...r.alts])].map((it) => itemId(it.icon)));
    const fin = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i));
    const off = fin.filter((i) => !listed.has(i));
    const tag = (i: number, t: string) => (k.items[String(i)] ?? []).includes(t);
    const magicOf = (ids: number[]) => ids.filter((i) => tag(i, "ap") && !tag(i, "ad")).length > ids.filter((i) => tag(i, "ad") && !tag(i, "ap")).length;
    const pathIds = [...listed].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i));
    // two off-path items: after one off-type buy, players who double down do worse (archive, within champion: team
    // damage share -2.0 pts with 1 off-type item, -4.3 with 2), so one off-type item gets a sell tip instead (sellMismatch)
    if (off.length >= 2 && magicOf(fin) !== magicOf(pathIds)) {
      const magic = magicOf(fin);
      const inPath = fin.filter((i) => listed.has(i)).length;
      let best: { st: string; hit: number } | null = null;
      for (const st of [...new Set(Object.values(picks.builds ?? {}).flatMap((b) => b.map((x) => x[0])))]) {
        const cb = classBuild(picks, k, st, magic, rules);
        if (!cb) continue;
        const ids = new Set([...cb[0], ...cb[1]]);
        const hit = fin.filter((i) => ids.has(i)).length;
        if (off.filter((i) => ids.has(i)).length >= 2 && hit > inPath && (!best || hit > best.hit)) best = { st, hit };
      }
      if (best) forced = { style: best.st, magic, because: off.slice(0, 2).map((i) => k.recipes[i][0]).join(" + ") };
    }
  }
  // Finished items you own that the path doesn't list take the first later slots you haven't filled.
  if (slotRows && k && RULES.ownedOffPath.on) {
    const listed = new Set([...(champ?.items ?? []), ...slotRows.map((r) => r.it)].map((it) => itemId(it.icon)));
    const prefix = ((champ?.items ?? []).find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
    const extra = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !(k.boots ?? []).includes(i) && !listed.has(i));
    extra.forEach((i) => placedOff.add(i));
    for (const i of extra) {
      const row = slotRows.find((r) => !owned.has(itemId(r.it.icon)));
      if (!row) break;
      row.alts = [row.it, ...row.alts].slice(0, 2);
      row.it = { name: k.recipes[i][0], icon: `${prefix}${220000 + i}.png` };
      applied("ownedOffPath");
    }
    // a later pick that can't be owned with something you have gives way to its first alternative that can
    for (const r of slotRows)
      if (!owned.has(itemId(r.it.icon)) && [...owned].some((o) => rules.clash(o, itemId(r.it.icon)))) {
        const alt = r.alts.find((x) => ![...owned].some((o) => rules.clash(o, itemId(x.icon))));
        if (alt) r.it = alt;
      }
    slotRows = slotRows.filter((r) => owned.has(itemId(r.it.icon)) || ![...owned].some((o) => rules.clash(o, itemId(r.it.icon))));
  }
  // Crit cap (critCap): at 100%+ live crit, a crit item in a later slot gives way to a near-tied option with better
  // synergy (augment pull, then kit match, then a non-crit item whose stats and passive keep full value).
  const critNow = (game.stats ?? [])[0] ?? 0;
  if (slotRows && k && RULES.critCap.on && (critNow > 2 ? critNow / 100 : critNow) >= 0.995 && !CRIT_CONVERTERS.has(champKey(game.champ))) {
    const isCrit = (it: Named) => (k.items[String(itemId(it.icon))] ?? []).includes("crit");
    const synergy = (it: Named) => {
      const w = RULES.whyBest.on ? whyBest(itemId(it.icon), game.champ, it.name, taken, whyData, profiles)?.kind : undefined;
      return (w === "augment" ? 4 : w === "kit" ? 2 : 0) + (isCrit(it) ? 0 : 1);
    };
    const usedIds = new Set([...(champ?.items ?? []), ...slotRows.map((r) => r.it)].map((it) => itemId(it.icon)));
    for (const r of slotRows) {
      if (owned.has(itemId(r.it.icon)) || !isCrit(r.it) || !r.it.tie) continue;
      const better = r.alts
        .filter((x) => x.tie && !usedIds.has(itemId(x.icon)) && ![...owned].some((o) => rules.clash(o, itemId(x.icon))) && synergy(x) > synergy(r.it))
        .sort((x, y) => synergy(y) - synergy(x))[0];
      if (!better) continue;
      usedIds.delete(itemId(r.it.icon));
      usedIds.add(itemId(better.icon));
      r.alts = [r.it, ...r.alts.filter((x) => x !== better)].slice(0, 2);
      r.it = better;
      applied("critCap");
    }
  }
  // Each item once (pathOnce): a later slot that repeats an earlier item takes its first option not yet in the path.
  if (slotRows && RULES.pathOnce.on) {
    const seen = new Set((champ?.items ?? []).map((it) => itemId(it.icon)));
    slotRows = slotRows.flatMap((r) => {
      const pick = [r.it, ...r.alts].find((x) => !seen.has(itemId(x.icon)) && ![...seen].some((s) => rules.clash(s, itemId(x.icon))));
      if (!pick) return [];
      if (pick !== r.it) { applied("pathOnce"); r = { ...r, it: pick, alts: [r.it, ...r.alts.filter((x) => x !== pick)].slice(0, 2) }; }
      seen.add(itemId(pick.icon));
      return [r];
    });
  }
  const baseList = [...(champ?.items ?? []), ...(slotRows ? slotRows.map((r) => r.it) : (champ?.rest ?? []))].filter((it, i, a) => a.findIndex((x) => itemId(x.icon) === itemId(it.icon)) === i);
  const picked = pickBuild(baseList, picks, k, game.champ, taken, owned, rules, forced);
  if (picked.style) { slotRows = null; applied(picked.niche ? "nicheBuilds" : forced && picked.because === forced.because ? "ownedReplan" : RULES.augmentReplan.on ? "augmentReplan" : "measuredReplan"); }
  const build = [...picked.list];
  const coreLen = picked.core ?? (champ?.items ?? []).length;
  // Rush (augmentRush): an augment whose holders build one item far more AND earlier (augment-item-shift.json, real
  // lobbies: build z >= 3, early z >= 2, +15 pts build share, e.g. Upgrade Stormsurge -> Stormsurge +52 pts, Wooglet's
  // -> Zhonya's) puts that item in the core and makes it Next. Smaller pulls only nudge the order (augmentShift).
  const rushed: { item: Named; by: number }[] = [];
  const converted: { item: Named; by: number; does: string }[] = [];
  const must = mustHave(game.champ);
  if (RULES.augmentRush.on && k) {
    const prefix = (build.find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
    for (const a of taken) {
      const top = Object.entries(AUGMENT_SHIFT[String(a)] ?? {})
        .filter(([i, v]) => v[4] >= RUSH_Z_BUILD && v[5] >= RUSH_Z_EARLY && v[0] >= RUSH_LIFT && !!k.recipes[i])
        .sort((x, y) => y[1][4] - x[1][4])[0];
      if (!top) continue;
      const id = Number(top[0]);
      if (owned.has(id) || [...owned].some((o) => o !== id && rules.clash(o, id))) continue;
      // only an item of the build's damage type (no Wooglet's -> Zhonya's on an AD build) unless ADAPt converts it
      const t = k.items[top[0]] ?? [];
      const pathAp = build.filter((x) => (k.items[String(itemId(x.icon))] ?? []).includes("ap") && !(k.items[String(itemId(x.icon))] ?? []).includes("ad")).length;
      const pathAd = build.filter((x) => (k.items[String(itemId(x.icon))] ?? []).includes("ad") && !(k.items[String(itemId(x.icon))] ?? []).includes("ap")).length;
      const wrongType = (t.includes("ap") && !t.includes("ad") && pathAd > pathAp) || (t.includes("ad") && !t.includes("ap") && pathAp > pathAd);
      if (wrongType && !taken.includes(ADAPT)) continue;
      const at = build.findIndex((it) => itemId(it.icon) === id);
      const it: Named = at >= 0 ? build[at] : { name: k.recipes[top[0]][0], icon: `${prefix}${220000 + id}.png` };
      if (at >= 0) build.splice(at, 1);
      // it takes the last core place you haven't bought (or the one it can't be built with); boots keep theirs
      const clash = build.findIndex((x) => rules.clash(itemId(x.icon), id) && !owned.has(itemId(x.icon)));
      if (clash >= 0) build.splice(clash, 1);
      else if (at < 0 && build.length >= 6) {
        const drop = [...build.keys()].reverse().find((j) => !owned.has(itemId(build[j].icon)) && !bootIds.has(itemId(build[j].icon)));
        if (drop !== undefined) build.splice(drop, 1);
      }
      // a must-have core item keeps its core place (mustCore): the rush takes the last flexible one, or goes right after
      const flex = [...build.keys()].slice(0, coreLen).reverse().find((j) => !must.has(itemId(build[j].icon)) && !owned.has(itemId(build[j].icon)) && !bootIds.has(itemId(build[j].icon)));
      const pos = flex !== undefined ? flex : must.size && build.slice(0, coreLen).some((x) => must.has(itemId(x.icon))) ? coreLen : coreLen - 1;
      if (flex === undefined && pos === coreLen) applied("mustCore");
      build.splice(Math.min(Math.max(pos, 0), build.length), 0, it);
      rushed.push({ item: it, by: a });
      applied("augmentRush");
    }
    // the path then follows this re-planned list, not the per-slot picks (they'd list the rushed item twice)
    if (rushed.length) slotRows = null;
  }
  // Converters (converterItems): an augment that re-prices a stat (ADAPt, Jeweled Gauntlet, Ethereal Weapon...) puts the
  // item of that kind its holders build most into the core, if it fits the champion's damage type or a taken ADAPt or
  // EscAPADe converts it. Not when the build already switched style for it (Ethereal Weapon's on-hit build).
  if ((RULES.converterItems.on || RULES.leanIn.on) && k && !picked.style) {
    const magic = (Object.entries(k.champions).find(([a]) => champKey(a) === champKey(game.champ))?.[1] ?? 0.5) > 0.5;
    const pure = (id: number) => { const t = k.items[String(id)] ?? []; return t.includes("ad") && !t.includes("ap") ? "ad" : t.includes("ap") && !t.includes("ad") ? "ap" : ""; };
    const toAp = taken.some((a) => TO_AP.has(a)), toAd = taken.some((a) => TO_AD.has(a));
    const fitsType = (id: number) => { const p0 = pure(id); return !p0 || (p0 === "ap" ? magic || toAd : !magic || toAp); };
    const prefix = (build.find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
    const lean = (a: number): Converter | undefined => {
      const l = RULES.leanIn.on ? LEAN_IN[String(a)] : undefined;
      if (!l?.scaling || !l.items.length) return undefined;
      // an item that gives the augment's stat and the champion's damage type first (Lich Brain on a mage: Riftmaker)
      const own = magic ? "ap" : "ad";
      const items = [...l.items.filter((i) => pure(i) === own), ...l.items.filter((i) => pure(i) !== own)];
      const words: Record<string, string> = { Health: "health", Armor: "armor", SpellBlock: "magic resist", AbilityHaste: "ability haste", AttackSpeed: "attack speed", CriticalStrike: "crit", Mana: "mana", ArmorPenetration: "lethality" };
      return { name: l.name, kind: l.kit.join(", "), champs: null, does: `Scales with ${l.kit.map((t) => words[t]).filter(Boolean).join(" and ") || "it"}`, items, on: true };
    };
    for (const a of taken) {
      const cv = (RULES.converterItems.on ? CONVERTERS[String(a)] : undefined) ?? lean(a);
      if (!cv?.on || (cv.champs === "ap" && !magic) || (cv.champs === "ad" && magic)) continue;
      const ids = build.map((it) => itemId(it.icon));
      // already building one of its items: nothing to add
      if (cv.items.some((i) => ids.includes(i) || owned.has(i))) continue;
      const id = cv.items.find((i) => k.recipes[i] && fitsType(i) && ![...owned, ...ids].some((o) => rules.clash(o, i)));
      if (id === undefined) continue;
      const it: Named = { name: k.recipes[id][0], icon: `${prefix}${220000 + id}.png` };
      // it takes the last core place you haven't bought and no other augment claimed; that item moves just past the core
      const claimed = new Set([...rushed, ...converted].map((r) => r.item));
      const j = [...build.keys()].slice(0, coreLen).reverse().find((x) => !owned.has(itemId(build[x].icon)) && !bootIds.has(itemId(build[x].icon)) && !claimed.has(build[x]) && !must.has(itemId(build[x].icon)));
      if (j === undefined && build.slice(0, coreLen).some((x) => must.has(itemId(x.icon)))) { build.splice(Math.min(coreLen, build.length), 0, it); applied("mustCore"); }
      else if (j === undefined) build.push(it);
      else { const [moved] = build.splice(j, 1, it); build.splice(Math.min(coreLen, build.length), 0, moved); }
      converted.push({ item: it, by: a, does: cv.does });
      applied(CONVERTERS[String(a)] ? "converterItems" : "leanIn");
    }
  }
  // Plain Boots and Slightly Magical Boots are tier 1: owning them still leaves the build's boots to buy (replay QA
  // 2026-11-24: "Build done" with plain Boots while the build's Sorcerer's Shoes were still owed).
  const hasBoots = [...owned].some((i) => bootIds.has(i) && !TIER1_BOOTS.has(i));
  const isOwned = (it: Named) => owned.has(itemId(it.icon)) || (hasBoots && bootIds.has(itemId(it.icon)));
  let next = build.filter((it) => !isOwned(it));
  const finished = [...owned].filter((i) => (k?.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i)).length;
  // A path item you've passed over twice (two finished items bought that come after it in the path, or aren't in it)
  // moves behind the rest (ownedReplan): Next moves on instead of waiting on an item you keep skipping.
  if (RULES.ownedReplan.on) {
    const buildIds = build.map((it) => itemId(it.icon));
    const fin = [...owned].filter((i) => (k?.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i));
    // You own n finished items, so the path's first n (boots aside) should be bought: any of those you don't own was
    // skipped for something else (later in the path or off it) and moves behind the rest. Boots are skipped once you've
    // bought past their place without starting them (plain Boots owned means you're building them).
    const n = fin.length;
    const nonBoot = build.filter((it) => !bootIds.has(itemId(it.icon)));
    const bootsAt = build.findIndex((it) => bootIds.has(itemId(it.icon)));
    const beforeBoots = bootsAt < 0 ? 0 : build.slice(0, bootsAt).filter((it) => !bootIds.has(itemId(it.icon))).length;
    const started = [...owned].some((i) => TIER1_BOOTS.has(i));
    // Started boots count as passed once you've bought two legendaries past their place without upgrading them (keeping
    // basic boots isn't worse: archive +3.7 +- 2.5 pts vs upgraded, BOOTS test 2026-11-24).
    const passed = (it: Named) => bootIds.has(itemId(it.icon)) ? (started ? n > beforeBoots + 1 : n > beforeBoots) : nonBoot.indexOf(it) < n;
    const skipped = next.filter(passed);
    // passed boots always go behind passed legendaries, even when everything left was passed (replay QA: Janna's Ionian
    // Boots stayed Next 5:00-15:00 at 3,000+ gold)
    const order0 = [...skipped.filter((it) => !bootIds.has(itemId(it.icon))), ...skipped.filter((it) => bootIds.has(itemId(it.icon)))];
    if (skipped.length && skipped.length < next.length) { next = [...next.filter((it) => !skipped.includes(it)), ...order0]; applied("ownedReplan"); }
    else if (skipped.length && order0.some((it, i) => it !== next[i])) { next = order0; applied("ownedReplan"); }
  }
  const timing: { item: Named; because: string }[] = [];
  const augName = (id: number) => picks?.augments[id]?.[0] ?? `#${id}`;
  const front = (idx: number, because: string) => {
    if (idx <= 0) { if (idx === 0) timing.push({ item: next[0], because }); return; }
    timing.push({ item: next[idx], because });
    next = [next[idx], ...next.filter((_, i) => i !== idx)];
  };
  // Augment-aware timing: Weapon of Destiny makes the first legendary its weapon, so the champion's best Weapon item
  // (AramHex real games) goes first. "Upgrade X" moving X up is off until tested (RULES.upgradeNext).
  if (RULES.destinyFirst.on && taken.includes(WEAPON_OF_DESTINY) && !finished && champ?.destiny) {
    const idx = next.findIndex((it) => itemId(it.icon) === itemId(champ.destiny!.icon));
    if (idx >= 0) { front(idx, `${augName(WEAPON_OF_DESTINY)}: your first legendary becomes the Weapon`); applied("destinyFirst"); }
  }
  for (const c of [...converted].reverse()) {
    const idx = next.findIndex((it) => itemId(it.icon) === itemId(c.item.icon));
    if (idx >= 0 && !timing.some((t) => t.item === next[idx])) front(idx, `${augName(c.by)}: ${c.does.replace(/\.$/, "").toLowerCase()}`);
  }
  for (const r of [...rushed].reverse()) {
    const idx = next.findIndex((it) => itemId(it.icon) === itemId(r.item.icon));
    if (idx >= 0 && !timing.some((t) => t.item === next[idx])) front(idx, `${augName(r.by)}: players who take it rush this`);
  }
  const upgraded = new Map<number, string>();
  for (const a of taken) for (const id of UPGRADES[a] ?? []) if (RULES.upgradeLabel.on) upgraded.set(id, augName(a));
  if (RULES.upgradeNext.on)
    for (const a of taken) {
      const family = UPGRADES[a];
      if (!family) continue;
      const idx = next.findIndex((it) => family.includes(itemId(it.icon)));
      if (idx >= 0 && !timing.some((t) => t.item === next[idx])) { front(idx, `${augName(a)} upgrades it`); applied("upgradeNext"); }
    }
  // Every taken augment pulls items earlier or later by how much more often its holders buy them early (shrunk), on
  // top of the base order; items another rule put first stay first.
  if (RULES.augmentShift.on && taken.length) {
    const fixed = next.filter((it) => timing.some((t) => t.item === it));
    const rest0 = next.filter((it) => !fixed.includes(it));
    const pos = new Map(rest0.map((it, i) => [it, i - SHIFT_ORDER_GAIN * shiftOf(taken, itemId(it.icon)).early]));
    const sorted = [...rest0].sort((x, y) => pos.get(x)! - pos.get(y)! || rest0.indexOf(x) - rest0.indexOf(y));
    sorted.forEach((it, i) => {
      if (i < rest0.indexOf(it)) {
        const sh = shiftOf(taken, itemId(it.icon));
        if (sh.by !== null) timing.push({ item: it, because: `${augName(sh.by)}: players who take it buy this earlier${sh.sure ? "" : " (estimated)"}` });
      }
    });
    if (sorted.some((it, i) => it !== rest0[i])) applied("augmentShift");
    next = [...fixed, ...sorted];
  }
  const stack = RULES.stackingFirst.on && !finished && !timing.length ? next.findIndex((it) => STACKING.has(itemId(it.icon))) : -1;
  if (stack > 0) { next = [next[stack], ...next.filter((_, i) => i !== stack)]; applied("stackingFirst"); }
  const [, aspd = 0, haste = 0] = game.stats ?? [];
  const has = (it: Named, kind: string) => (k?.items[String(itemId(it.icon))] ?? []).includes(kind);
  const nearCap = RULES.attackSpeedNudge.on && aspd >= 4.5;
  if (nearCap) { next = [...next.filter((it) => !has(it, "as")), ...next.filter((it) => has(it, "as"))]; applied("attackSpeedNudge"); }
  const order = new Map(next.map((it, i) => [itemId(it.icon), i]));
  next = next.slice(0, 2);

  // Path: the core, then the 4th/5th/6th picks (or the rest of the build).
  let coreItems = build.slice(0, coreLen);
  let rest = (slotRows ? slotRows.map((r) => r.it) : build.slice(coreLen, 6)).filter((it, i, a) => !coreItems.some((c) => itemId(c.icon) === itemId(it.icon)) && a.findIndex((x) => itemId(x.icon) === itemId(it.icon)) === i);
  // Core items an augment pushed out of the core (augmentRush, converterItems) stay in the path right after the core
  // rather than vanishing; the path keeps six items, dropping unbought ones from the end, never one you own.
  const inPath0 = new Set([...coreItems, ...rest].map((it) => itemId(it.icon)));
  // ...and so do items an augment added right after a core of must-haves (mustCore)
  const pushed = [...(champ?.items ?? []), ...[...rushed, ...converted].map((r) => r.item)]
    .filter((it, i, a) => !inPath0.has(itemId(it.icon)) && !isOwned(it) && build.some((b) => itemId(b.icon) === itemId(it.icon)) && a.findIndex((x) => itemId(x.icon) === itemId(it.icon)) === i);
  const path = [...coreItems, ...pushed, ...rest];
  while (path.length > 6) {
    const j = [...path.keys()].reverse().find((x) => x >= coreItems.length && !isOwned(path[x]));
    if (j === undefined) break;
    path.splice(j, 1);
  }
  rest = path.slice(coreItems.length);
  // The path's unbought places follow Next's order (pathOrder): owned items keep their places, the rest are re-sorted
  // among the open places, so an augment's pull or rush shows in the path, not only in Next.
  if (RULES.pathOrder.on) {
    // boots keep their place: their Next timing moves with what you buy, which would make the path flicker
    const fixed = (it: Named) => isOwned(it) || bootIds.has(itemId(it.icon));
    const open0 = path.map((it, i) => (fixed(it) ? -1 : i)).filter((i) => i >= 0);
    const at = (it: Named) => order.get(itemId(it.icon)) ?? Infinity;
    const sorted = open0.map((i) => path[i]).sort((x, y) => at(x) - at(y) || path.indexOf(x) - path.indexOf(y));
    // with an augment, must-have items you haven't bought stay core (mustCore): when its rush or pull sorts ahead of
    // them, or its build put them after the core, the core grows to hold them (no augment: the site card's core)
    const mustIn = taken.length ? path.filter((it) => must.has(itemId(it.icon)) && !isOwned(it)) : [];
    if (sorted.some((it, n) => it !== path[open0[n]])) {
      open0.forEach((i, n) => { path[i] = sorted[n]; });
      applied("pathOrder");
    }
    coreItems = path.slice(0, Math.max(coreItems.length, ...mustIn.map((it) => path.indexOf(it) + 1)));
    rest = path.slice(coreItems.length);
    // Next is the path's first unbought items, so it never names an item the path doesn't show
    const fromPath = path.filter((it) => !isOwned(it)).sort((x, y) => at(x) - at(y) || path.indexOf(x) - path.indexOf(y));
    // (empty when you own the whole path: an item the path can't fit isn't Next; full-build advice takes over)
    next = fromPath.slice(0, 2);
  }
  const first = coreItems.filter((it) => !bootIds.has(itemId(it.icon))).length + 1;
  const slotName = (i: number) => ord(slotRows?.[i]?.slot ?? first + i);

  // Situational: lit items in the path explain themselves; the rest become swaps (augment-driven or proven) or
  // pointers.
  const inPath = new Set(path.map((it) => itemId(it.icon)));
  const all = k ? situational(champ, k, fit, game.enemies ?? [], taken, owned, augName) : [];
  // Headliners that feed one situation (headlinerItems): candle shields (La Ilusion) and stronger health relics (Cafe
  // Cuties) light the champion's own anti-shield / anti-heal pick as a pointer, never a swap.
  const hlWhy: Record<string, [string, string]> = { lailusion: ["Vs shields", "La Ilusion: candles shield the enemy team."], cafecuties: ["Vs healing", "Cafe Cuties: health relics heal more."] };
  const hl = RULES.headlinerItems.on ? hlWhy[headlinerKey(game.headliner)] : undefined;
  if (hl) for (const it of all) if (it.when === hl[0] && !it.why) { it.why = hl[1]; applied("headlinerItems"); }
  // Knight's Vow (vowPartner): a frontliner or enchanter heals off an ally who shreds the enemy's frontline
  if (RULES.vowPartner.on && k?.recipes[KNIGHTS_VOW] && !inPath.has(KNIGHTS_VOW) && !owned.has(KNIGHTS_VOW)) {
    const arch = (c: string) => fit?.champions?.[keyIn(fit.champions, c) ?? ""]?.[1] ?? [];
    const front = (game.enemies ?? []).filter((e) => arch(e.champ).some((a) => TANKY.has(a))).length;
    const allies = arch(game.champ).some((a) => VOW_OWNERS.has(a)) && front >= 2 ? game.allies ?? [] : [];
    const ally = allies.find((a) => PCT_HEALTH.has(champKey(a.champ))) ?? allies.find((a) => arch(a.champ).includes("Marksman"));
    const prefix = (path.find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
    const why = `Pledge to ${ally?.champ}: you heal 12% of their damage, and they hit ${front} frontliners hard.`;
    // the champion's own Knight's Vow entry, if it has one, takes the pledge reason unless another rule already lit it
    const own = all.find((x) => itemId(x.icon) === KNIGHTS_VOW);
    if (ally && own && !own.why) Object.assign(own, { why, kit: true });
    else if (ally && !own) all.unshift({ name: k.recipes[KNIGHTS_VOW][0], icon: `${prefix}${220000 + KNIGHTS_VOW}.png`, when: "Pledge", kit: true, why });
  }
  const reason = (it: Named) => all.find((x) => itemId(x.icon) === itemId(it.icon) && x.why);
  const lit = path.map((it) => ({ item: it, why: reason(it)?.why ?? "" })).filter((x) => x.why);
  const open = rest.filter((it) => !isOwned(it) && it !== next[0]);
  const target = (id: number, taken0: Set<Named>): Named | null => {
    const unbought = path.filter((p) => !isOwned(p) && !taken0.has(p));
    const clash = unbought.find((p) => rules.clash(itemId(p.icon), id)) ?? path.find((p) => rules.clash(itemId(p.icon), id));
    if (clash) return clash;
    const sub = unbought.find((p) => rules.substitute(itemId(p.icon), id));
    if (sub) { applied("substitutes"); return sub; }
    // the open item your augments pull out of the build the most (holders finish it less often), if any
    const out = RULES.augmentShift.on
      ? open.filter((p) => !taken0.has(p)).map((p) => [p, shiftOf(taken, itemId(p.icon)).build] as const).filter(([, b]) => b <= -0.05).sort((x, y) => x[1] - y[1])[0]
      : undefined;
    if (out) return out[0];
    if (!RULES.swapLastSlot.on) return null;
    return [...open].reverse().find((p) => !taken0.has(p)) ?? null;
  };
  const swaps: Swap[] = [];
  const pointers: Plan["pointers"] = [];
  const claimed = new Set<Named>();
  // a resist-multiplying augment you took puts lit swaps of that resist first (resistAugmentSwaps)
  const resists = RULES.resistAugmentSwaps.on ? taken.flatMap((a) => RESIST_AUGMENTS[a] ?? []) : [];
  const boosted = (x: LitItem) => resists.some((r) => (k?.items[String(itemId(x.icon))] ?? []).includes(r));
  const candidates = all.filter((x) => x.why && !inPath.has(itemId(x.icon)));
  if (resists.length && candidates.some(boosted)) applied("resistAugmentSwaps");
  for (const it of [...candidates.filter((x) => x.why && boosted(x)), ...candidates.filter((x) => !boosted(x))]) {
    const id = itemId(it.icon);
    // never alongside an item you own that it can't be owned with
    const ownedClash = [...owned].find((o) => rules.clash(o, id));
    // (Nico 2026-11-24, Gwen: Lich Bane offered next to an owned Dusk and Dawn read as "buy both"): not shown; selling
    // an owned item is the sell tips' call
    if (ownedClash !== undefined && !path.some((p) => itemId(p.icon) === ownedClash && !isOwned(p))) {
      continue;
    }
    if ((it.aug || it.proven || it.kit) && swaps.length < 2) {
      const r = target(id, claimed);
      if (r) claimed.add(r);
      swaps.push({ item: it, replaces: r, at: r ? rest.indexOf(r) : -1, why: it.why, kind: it.aug ? "augment" : it.proven ? "proven" : "kit" });
      if (it.proven) applied("provenCounters");
      if (it.kit && !it.proven) applied(id === KNIGHTS_VOW ? "vowPartner" : "ccCounters");
    } else if (pointers.length < 1) {
      pointers.push({ item: it, why: it.why, replaces: target(id, claimed) });
    }
  }

  // Why each path item is there.
  const why = path.map((it, i) => {
    if (isOwned(it)) return "You have it.";
    const r = reason(it);
    const tm = timing.find((t) => t.item === it);
    const b = route && !picked.style
      ? i < coreLen
        ? route.need !== null
          ? `${augName(arch!.augment)}: ${route.reach ? "reaches" : "heads for"} ${route.need} Ability Haste, so Hawkshot and R refresh each other (keep Hawkshot at rank ${route.eRank}).`
          : `${augName(arch!.augment)}: Ability Haste for Hawkshot and R.`
        : "Rest of the AP build, best DeepScore first."
      : picked.style
      ? `Switched to ${picked.style}${picked.because ? ` for ${picked.because}` : ""}${picked.classWide ? ": usual item for that style" : ""}.`
      : i < coreLen
        ? "Core: the most played build here with the best DeepScore."
        : slotRows
          ? `${slotName(i - coreLen)} item: players usually buy it ${slotName(i - coreLen)}.`
          : "Usually finishes this build.";
    const up = upgraded.get(itemId(it.icon));
    if (up) applied("upgradeLabel");
    return [tm ? `Earlier: ${tm.because}.` : "", b, up ? `${up} upgrades it.` : "", r ? `${r.when}: ${r.why}` : ""].filter(Boolean).join(" ");
  });

  // Tips, most useful first.
  const tips: Tip[] = [];
  // A split applies to the champion's own order only, not to an augment's or Archmage's.
  // styleSkills: a switched build (augment replan, owned items, niche) levels like that build's own players do (the
  // per-build max order the site shows when its build toggle switches); an augment's or Archmage's order still wins.
  const styleOrder = RULES.styleSkills.on && picked.style && !augSkill && !route ? champ0?.builds?.find((b) => (STYLE_NAMES[b.style] ?? b.style) === picked.style)?.skills : undefined;
  if (styleOrder?.length && styleOrder.join() !== (champ?.skills ?? []).join()) applied("styleSkills");
  const sp = splitFor(styleOrder?.length ? styleOrder : champ?.skills, !augSkill && !route && !styleOrder?.length ? champ0?.skillSplit : undefined, taken);
  if (sp.tipped) applied("splitAugments");
  const point = skillUp(sp.order, game.skills ?? [], game.level ?? 0, taken, game.champ, route?.eRank ?? 5, sp.split);
  if (point) tips.push({ rank: 1, kind: "skill", text: point });
  const shop = game.dead ? "You're dead: a good time to shop." : (game.t ?? 999) < 60 ? "In base: a good time to shop." : "";
  if (shop) tips.push({ rank: 0, kind: "shop", text: shop });
  if (RULES.shopTips.on && shop && k && next.length) {
    const buy = buyNow(k, itemId(next[0].icon), owned, game.gold ?? 0);
    if (buy) tips.push({ rank: 2, kind: "buy", item: buy.id, text: buy.whole ? `Your gold buys ${buy.name} now.` : `Buy ${buy.name} now (${buy.cost} gold) toward it.` });
  }
  if (nearCap) tips.push({ rank: 3, kind: "cap", text: "Attack speed is near Mayhem's 5.0 cap: attack-speed items moved back." });
  else if (RULES.hasteMath.on && haste >= 100 && next[0] && has(next[0], "haste"))
    tips.push({ rank: 3, kind: "haste", text: `You have ${Math.round(haste)} ability haste: cooldowns are ${Math.round((haste / (100 + haste)) * 100)}% shorter.` });
  if (stack > 0) tips.push({ rank: 4, kind: "stacking", item: itemId(next[0].icon), text: `${next[0].name} stacks over time, so it goes first.` });
  for (const t of [timing.find((x) => next[0] && x.item === next[0]) ?? timing[0]].filter(Boolean)) tips.push({ rank: 4, kind: "timing", item: itemId(t.item.icon), text: `${t.item.name} next: ${t.because}.` });
  if (RULES.shopTips.on && k && next.length) {
    const slots = game.items.filter((i) => (k.recipes[ownedId(i)]?.[1] ?? 0) > 0 && !bootIds.has(ownedId(i))).length + ([...owned].some((i) => bootIds.has(i)) ? 1 : 0);
    // upgrading boots you started takes no new slot: never sell for them (Neeko / Kai'Sa: sell a legendary for Sorcerer's Shoes)
    const bootUpgrade = bootIds.has(itemId(next[0].icon)) && [...owned].some((i) => bootIds.has(i));
    if (slots >= 6 && !bootUpgrade) {
      const inBuild = new Set(build.map((it) => itemId(it.icon)));
      const sell = [...owned].find((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !inBuild.has(i) && !bootIds.has(i));
      const cost = k.recipes[itemId(next[0].icon)]?.[1] ?? Infinity;
      if (sell !== undefined && (game.gold ?? 0) + Math.round((k.recipes[sell]?.[1] ?? 0) * 0.7) >= cost)
        tips.push({ rank: 3, kind: "sell", item: sell, text: `Full build: sell ${k.recipes[sell][0]} for ${next[0].name}.` });
    }
  }
  // Full build (fullBuildShop): spend idle gold on a permanent Stat Bonus, else your damage type's elixir.
  if (RULES.fullBuildShop.on && k && shop && !next.length) {
    const fullSlots = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i)).length >= 5;
    const gold = game.gold ?? 0;
    if (fullSlots && gold >= 750 && (game.level ?? 0) >= 9) {
      tips.push({ rank: 2, kind: "anvil", item: STAT_BONUS, text: "Build done: buy a Stat Bonus (permanent stat)." });
      applied("fullBuildShop");
    } else if (fullSlots && gold >= 500) {
      const magic = (Object.entries(k.champions).find(([a]) => champKey(a) === champKey(game.champ))?.[1] ?? 0.5) > 0.5;
      const tank = build.filter((it) => { const t = k.items[String(itemId(it.icon))] ?? []; return (t.includes("armor") || t.includes("mr")) && !t.includes("ad") && !t.includes("ap"); }).length >= 3;
      const elixir = tank ? 2138 : magic ? 2139 : 2140;
      tips.push({ rank: 2, kind: "elixir", item: elixir, text: `Build done: buy ${k.recipes[elixir]?.[0] ?? "an elixir"} (3 minutes).` });
      applied("fullBuildShop");
    }
  }
  // Sell pushback (sellMismatch): exactly one finished item of the other damage type than the champion's own build,
  // and selling it (70%) plus your gold buys the next path item now.
  if (RULES.sellMismatch.on && k && next[0] && !picked.style && !tips.some((t) => t.kind === "sell")) {
    const pure = (id: number) => { const t = k.items[String(id)] ?? []; return t.includes("ad") && !t.includes("ap") ? "ad" : t.includes("ap") && !t.includes("ad") ? "ap" : ""; };
    // the champion's type only when every build style's core agrees (Volibear's Riftmaker builds make him neither)
    const cores = [champ0?.items ?? [], ...(champ0?.builds ?? []).map((b) => b.items ?? [])];
    const own0 = cores.flat().map((it) => pure(itemId(it.icon))).filter(Boolean);
    const type = own0.length && own0.every((t) => t === own0[0]) ? own0[0] : "";
    // and never an item the champion's own data lists anywhere (Statikk Shiv on Teemo)
    const lists = [champ0, ...(champ0?.builds ?? [])].flatMap((b) => [...(b?.items ?? []), ...(b?.rest ?? []), ...(b?.full ?? []), ...(b?.later ?? []), ...(b?.laterSlots ?? []).flatMap((x) => x.items)]);
    const known = new Set(lists.map((it) => itemId(it.icon)));
    const converts = taken.some((a) => (type === "ap" ? TO_AP : TO_AD).has(a));
    const off = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i) && type && pure(i) && pure(i) !== type && !known.has(i));
    const cost = k.recipes[itemId(next[0].icon)]?.[1] ?? Infinity;
    if (type && !converts && off.length === 1 && pure(itemId(next[0].icon)) !== pure(off[0]) && (game.gold ?? 0) + Math.round((k.recipes[off[0]]?.[1] ?? 0) * 0.7) >= cost) {
      tips.push({ rank: 2, kind: "sell", item: off[0], text: `Sell ${k.recipes[off[0]][0]} for ${next[0].name}: it doesn't fit this build.` });
      applied("sellMismatch");
    }
  }
  tips.sort((x, y) => x.rank - y.rank);

  const reasons = path.map((it) => {
    const r = whyBest(itemId(it.icon), game.champ, champ?.name ?? game.champ, taken, whyData, profiles);
    if (r) applied("whyBest");
    return r;
  });
  const baseNext = baseList.find((it) => !isOwned(it)) ?? null;
  const bp = (() => {
    if (!k) return [];
    const magic = (Object.entries(k.champions).find(([a]) => champKey(a) === champKey(game.champ))?.[1] ?? 0.5) > 0.5;
    const known = new Set([...(champ0?.items ?? []), ...(champ0?.rest ?? []), ...(champ0?.full ?? []), ...(champ0?.situational ?? []),
      ...(champ0?.laterSlots ?? []).flatMap((r) => r.items), ...path].map((it) => itemId(it.icon)));
    const ck = picks ? keyIn(picks.champions, game.champ) : undefined;
    const pool = new Set((ck && picks ? picks.champions[ck] : []).map((r) => r[0]));
    const list = breakpoints(game.enemies ?? [], game.level ?? 18, magic, known, pool);
    if (list.some((b) => b.passed)) applied("breakpoints");
    return list;
  })();
  return {
    path,
    coreLen: coreItems.length,
    next,
    why,
    lit,
    swaps,
    pointers,
    switched: picked.style
      ? { style: picked.style, because: picked.because ?? "", classWide: !!picked.classWide, instead: baseNext && next[0] && itemId(baseNext.icon) !== itemId(next[0].icon) ? baseNext : null }
      : route && arch
        ? { style: `${arch.style} (haste for the loop)`, because: augName(arch.augment), classWide: false, instead: null }
        : null,
    timing,
    tips,
    rules: [...used],
    reasons,
    luckyStyle: alt?.style ?? null,
    skills: sp.order,
    skillSplit: sp.split,
    breakpoints: bp,
    slotCue: (() => {
      const c = slotCue(game, taken, path, champ?.destiny ? itemId(champ.destiny.icon) : null, k, augName);
      if (!c) return null;
      applied("slotFirst");
      const it = path.find((x) => itemId(x.icon) === c.item) ?? { name: k?.recipes[c.item]?.[0] ?? `#${c.item}`, icon: `${c.item}.png` };
      return { item: it, why: c.why, estimated: c.estimated };
    })(),
  };
}
