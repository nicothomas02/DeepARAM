// All-champion ARAM Mayhem simulator: a generic champion model built from
// parsed game data (data/champions.json), shared items and augments, and a
// build optimizer. Same fight scenario, enemy pool and RNG as the Yunara sim.
#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "json.hpp"
#include "sim.hpp"

namespace mayhem {

using yunara::EnemyProfile;
using yunara::Scenario;

// Flat numeric properties: stats and effect parameters by name.
using Bag = std::map<std::string, double>;
double get(const Bag& b, const std::string& key, double fallback = 0.0);

enum class DamageType { Physical, Magic, True };
enum class HitTarget { Flat, MaxHp, CurrentHp, MissingHp };
enum class Area { Single, Line, Aoe };

struct Hit {
    DamageType type = DamageType::Magic;
    HitTarget target = HitTarget::Flat;
    bool perSecond = false;
    double weight = 1.0;  // how much of this tooltip number counts per cast
    std::string calc;
    Bag scaling;          // const, ap, bonus_ad, bonus_hp, bonus_armor, bonus_mr, as, crit, lethality
};

// Where an ability reaches and what it covers on the ground, in game units
// (data/champions.json "geometry", read from the game's aiming indicators).
enum class Shape { Single, Line, Circle, Cone };
enum class Move { None, Dash, Blink };
struct Geometry {
    Shape shape = Shape::Single;
    double range = 0;      // how far from the caster it can be aimed (0 with onSelf: centred on the caster)
    double radius = 0;     // circle radius
    double width = 0;      // line width
    double angle = 0;      // cone angle, degrees
    double speed = 0;      // missile speed; 0 lands at once
    bool onSelf = false;   // centred on the caster
    bool selfBuff = false; // no area of its own: its damage lands through the champion's attacks
    bool stops = false;    // a line that stops at the first champion it hits
    Move move = Move::None;
};

struct Ability {
    char slot = 'Q';
    std::string name;
    double cooldown = 10, castTime = 0.25, duration = 0;
    double lock = 0;            // seconds a channel keeps the caster busy after it fires
    double castFromAttack = 0;  // > 0: the cast time is this share of the attack wind-up
    bool attackReset = false;   // the next attack can start as soon as it's cast
    // Crowd control it puts on enemies it hits: stun, root, knockup, slow... ("" for none).
    std::string cc;
    double ccDuration = 0, ccSlow = 0;
    Bag shield;                // a shield on yourself when cast (its scaling), and how long it lasts
    double shieldDuration = 0;
    double cost = 0;           // mana or energy per cast
    Bag heal;                  // Health restored to yourself when cast (its scaling)
    Area area = Area::Single;
    Geometry geo;
    bool aura = false;  // per-second damage on a toggle or very short cooldown: always on
    bool toggle = false; // switched on while enemies are in reach (Singed Q, Karthus E, Amumu W)
    double trail = 0;    // > 0: an aura that also lingers this long where you walked (Singed Q's cloud)
    double linger = 0;   // > 0: an aura's damage keeps ticking this long after a target leaves it (poison)
    int onhitEvery = 0; // > 0: a passive that procs on every Nth attack instead of a cast
    int casts = 1;      // casts per cooldown, each granting after-ability passive charges (Riven Q: 3)
    int afterAttacks = 0; // > 0: cast only once this many attacks have hit the target since its last cast (stacks to build: Twitch E)
    double ramp = 0;    // on-hit passives: each proc on the same target adds a stack that multiplies the damage,
                        // lost after this many seconds without a hit (Bel'Veth R)
    bool noHaste = false;
    bool appliesOnHit = false;
    double invuln = 0;
    double refund = 0;
    double critRefund = 0;      // seconds off its cooldown whenever an attack crits (Tryndamere E)
    double readyDelay = 0;      // seconds before its cooldown starts, untouched by haste and refunds (TF W's card cycling)
    double missingMax = 0;      // > 0: the missing-Health bonus stops growing at this share missing (Veigar R)
    double soloMult = 1;        // damage x this when the cast hits only one enemy (Karthus Q on a lone target)
    double missingAmp = 0;      // damage x (1 + this x the target's missing share of Health) (Jhin R)          // mana or energy restored when it hits its target (Zed's shadows hitting it too)          // seconds the caster takes no damage from the cast on (Pantheon E's shield)  // its hit on the first target applies on-hit effects (Bel'Veth Q)  // the cooldown isn't reduced by ability haste (a resource or stack build-up time)
    // Damage scaled by how far it flew: x1 up to rangeFrom, rising to rangeMax at rangeTo (Nidalee Q).
    double rangeFrom = 0, rangeTo = 0, rangeMax = 1;
    // Marks the targets hit: for markDuration seconds, markShare of the damage you deal them is
    // dealt again as physical damage by this ability (Zed R).
    double markDuration = 0, markShare = 0;
    // A buff on yourself when cast, for buffDuration seconds: bonus attack speed, attack damage
    // (flat, and a share of your bonus AD), damage of your attacks (multiplier), omnivamp and healing received.
    double buffDuration = 0, buffAs = 0, buffAd = 0, buffBonusAdPct = 0, buffAttackMult = 1, buffVamp = 0, buffHealAmp = 0;
    bool missingIsolated = false;  // the missing-Health bonus only on an immobilized target or a lone hit (Hwei's Severing Bolt)
    bool placeholder = false;     // a slot kept empty until the kit fills it mid-fight (Viego's possessions, Aphelios' off-hand)
    // A summon that fights on its own for petDuration seconds: an attack every 1/petAs seconds on your
    // target, and every petSlamEvery-th attack (at most every petSlamCd seconds) a slam around it that
    // knocks up for petSlamCc seconds (Ivern's Daisy).
    double petDuration = 0, petAs = 1, petSlamCd = 0, petSlamCc = 0;
    int petSlamEvery = 0;
    std::vector<Hit> petHits, petSlam;
    std::vector<Hit> hits;
    // Versions of this ability the kit swaps in mid-fight: Hwei's three spells per slot, Aphelios' weapons.
    std::vector<Ability> variants;
};

// A champion passive's damage and when it lands (data/passives.json via data/champions.json).
struct Passive {
    enum class Trigger { Attack, Ability, Hit, AfterAbility } trigger = Trigger::Attack;
    int every = 1;          // every Nth attack / ability hit / either
    double cooldown = 0;    // seconds between procs (per enemy when perTarget)
    bool perTarget = false;
    int charges = 1, maxCharges = 1;  // AfterAbility: empowered attacks per cast, and how many can be stored
    bool aoe = false;       // also hits enemies near the target
    double belowHp = 0;     // only against targets below this share of their max Health
    double abilityCdr = 0;  // seconds off its current cooldown whenever an ability cast hits (Galio)
    double restore = 0;     // mana or energy it gives back when it procs (Ambessa)
    double basicCdr = 0;    // seconds off the current cooldowns of Q, W and E whenever it procs (Taric)
    bool needsHit = false;  // AfterAbility: only casts that hit an enemy charge it (Lux marks the enemies she hits)
    std::vector<Hit> hits;
};

struct ChampionKit {
    std::string id, name, role, parseQuality;
    int championId = 0;
    bool ranged = false;
    double hp = 600, hpG = 100, armor = 30, armorG = 4.5, mr = 32, mrG = 2;
    double ad = 60, adG = 3.5, as = 0.65, asG = 0.02, asRatio = 0.65;
    double damageDealt = 1, damageTaken = 1, mayhemAh = 0, mayhemAs = 0;
    double mayhemHealing = 1, mayhemShielding = 1, mayhemTenacity = 0;  // Mayhem balance: heal and shield power, tenacity
    bool hasCn = false;
    double cnDamageShare = 0.2, cnTakenShare = 0.2, cnWeight = 0, cnWinRate = 0.5;
    double attackRange = 125, moveSpeed = 335;
    // Share of an attack's time spent winding up before it fires, and how much of an
    // attack speed gain also speeds up the wind-up (1: all of it).
    double windup = 0.3, windupMod = 1.0;
    double reach = 0;  // how far its damage reaches: attack range, or its abilities' typical range
    double apRatios = 0, adRatios = 0;  // summed ability scalings, to tell AP from AD kits
    std::string combo;  // recommended cast order, e.g. "EQRW" (data/combos.json); empty = by damage
    // Cheating death once a fight (Karthus, Sion, Zilean R, Anivia's egg...): keep acting for
    // deathAct seconds before dying, or go down for reviveDelay seconds and come back with
    // reviveFrac of max Health. deathNeedsR: only while the ultimate is ready (it's used up).
    double deathAct = 0, reviveFrac = 0, reviveDelay = 0, deathChance = 1;
    bool deathNeedsR = false;
    // While acting on after death (Sion's Glory in Death): fixed attack speed, on-hit damage from the
    // target's max Health, and whether abilities can still be cast.
    double deathAs = 0, deathOnhitMaxHp = 0;
    bool deathAbilities = true;
    std::vector<Ability> abilities;
    std::vector<Passive> passives;
    // Mana or energy (resource 1 or 2; 0: casts are free): pool and regeneration per second.
    int resource = 0;
    double mana = 0, manaG = 0, manaRegen = 0, manaRegenG = 0;
    // Stat and stacking passives (data/kit_passives.json), in the same keys as augments.
    Bag kitStats, kitEffects;
    // Its abilities' crowd control that stops a champion acting (slot, kind), damaging or not:
    // what you're hit by when this champion is the enemy.
    std::vector<std::pair<char, std::string>> hardCc;
};

struct Effect {
    std::string key, name, slot, rarity, confidence;
    std::string group;      // items of one group (Last Whisper, Blight, Hydra, Lifeline) can't be bought together
    std::string needsItem;  // augments that only work with an item (Upgrade Infinity Edge): its key
    std::string bind;      // augments on one of your abilities: which kind it picks (any, aoe, missile, cc, buff)
    int id = 0;
    double cost = 0;
    std::vector<std::string> roles;
    Bag stats, effects;
};

struct Rules {
    double critMult = 2.0, critOverflowAf = 0.75, asCap = 5.0;
    double grievous = 0.4;  // healing cut by Grievous Wounds
    // Mayhem stats every champion gets: base health growing from 20 at level 1 to these at 18, and bonus
    // armor and magic resist (melee only for now).
    double mayhemHpMelee = 600, mayhemHpRanged = 400, mayhemResistMelee = 15, mayhemResistRanged = 0;
    double mayhemHp(int level, bool ranged) const {
        const double top = ranged ? mayhemHpRanged : mayhemHpMelee;
        return top <= 0 ? 0.0 : 20.0 + (top - 20.0) * (std::clamp(level, 1, 18) - 1) / 17.0;
    }
    double mayhemResist(bool ranged) const { return ranged ? mayhemResistRanged : mayhemResistMelee; }
    // ARAM: damage from enemy champions further than longRangeStart units away is cut to longRangeNear,
    // falling to longRangeFar at twice that distance (not damage over time or ultimates).
    double longRangeStart = 1000, longRangeNear = 0.85, longRangeFar = 0.70;
    // Combo Breaker (Mayhem): each separate immobilize grants comboTenacity more tenacity (stacking) for
    // comboDuration seconds, refreshed by the next one.
    double comboTenacity = 0.2, comboDuration = 3.25;
    // On Fire! (an optional fight setting): bonus attack and move speed, less healing, more damage taken.
    double fireAs = 0.2, fireMs = 0.2, fireHeal = 0.25, fireTakenMelee = 1.25, fireTakenRanged = 1.35;
    double longRange(double dist) const {
        if (dist <= longRangeStart) return 1.0;
        return longRangeNear + (longRangeFar - longRangeNear) * std::min(1.0, (dist - longRangeStart) / longRangeStart);
    }
    double extraHitWeight = 0.5;
    double castMin = 0.0, castMax = 1.5, minCooldown = 0.75, dotDuration = 3.0, spellbladeWindow = 10.0;
    // Positions: whether a skillshot lands comes from where everyone stands and moves.
    double dodgeChance = 0.5;   // chance an enemy sees a skillshot coming and sidesteps
    double reactionTime = 0.25; // seconds before a dodging enemy starts moving
    double aimLead = 0.5;       // how far ahead of a moving target skillshots are aimed (0-1)
    double hitbox = 65;         // champion radius, game units
    double laneHalfWidth = 550; // the Howling Abyss lane, game units from its middle
    // Enemies only hurt you while in reach, so their damage while in reach is scaled
    // up to keep a fight's total about where real games put it.
    double inRangeBoost = 1.0;
    double focusRamp = 0;     // seconds over which the enemies' damage on you builds up to full
    double deathBlastLife = 0;  // damage dealt on death counts in full only after a life this long
    bool focusFromContact = false;  // the ramp starts when an enemy first has you in reach
    double comboOrder = 1;  // 1: cast in each champion's recommended combo order; 0: by damage
    // Enemies cast their own abilities: their damage partly arrives as those abilities' hits (on
    // their cooldowns, in their range), and their crowd control is their own (rate kept to real games).
    double enemyAbilities = 1;
    double enemyHitChance = 0.7;   // chance an enemy skillshot lands on you (targeted ones always do)
    double enemyAbilityHaste = 60; // enemies' ability haste on top of their Mayhem bonus
    double enemyAbilityShare = 0.65, enemyAbilityShareMarksman = 0.35;  // share of damage from abilities
};

struct OptimizerSettings {
    int legendarySlots = 5, augmentSlots = 4, candidates = 14;
    int screenTrials = 64, finalTrials = 2000, finalists = 12;
    // Only search items that fit the champion's class and scalings (no AD-crit Lux).
    bool fittingItemsOnly = true;
    // Smart search (mayhem_sim --search smart): items and augments searched together, then
    // successive halving: every shortlisted build gets smartStartTrials fights, the best
    // 1/smartKeep go on with smartKeep times as many, until smartFinalists are left for
    // smartFinalTrials fights each.
    bool smart = false;
    int smartItems = 15, smartAugs = 10, smartItemSets = 24, smartAugSets = 12;
    int smartStartTrials = 250, smartKeep = 3, smartFinalists = 4, smartFinalTrials = 20000;
};

struct Build {
    std::vector<std::string> items, augments;
};

// Item roles (items.json "roles") worth searching for this champion.
std::vector<std::string> fittingRoles(const ChampionKit& c);

struct Library {
    std::vector<ChampionKit> champions;
    std::map<std::string, Effect> items, augments;
    Rules rules;
    Scenario scenario;
    OptimizerSettings optimizer;
    std::map<int, double> mayhemDamageTaken;  // champion id -> Mayhem damage-taken modifier
    // champion id -> the augments players are offered on it (data/augment_pools.json);
    // champions missing here can get any augment.
    std::map<int, std::vector<std::string>> augmentPools;
    // The augments the optimizer searches for a champion: its pool, only those with an effect.
    std::vector<std::string> augmentsFor(const ChampionKit& c, bool modeledOnly = true) const;

    // Settings a user can change (the viewer's controls, or --set key=value), by name:
    // model rules, which shape every champion's kit, and fight settings, applied on top
    // of the enemy pool in scenarioFor. settingKeys() lists them with descriptions.
    using Settings = std::map<std::string, double>;
    Settings fight;                    // fight settings in effect
    std::vector<std::string> enemyTeam;  // when set, every fight is against exactly these champions
    static const std::vector<std::pair<std::string, std::string>>& settingKeys();

    // rulesPath: data/mayhem_rules.json; the other files are found next to it.
    // Unknown setting names throw.
    // gameDir: where champions.json, items.json and augments.json are (default: next to the rules,
    // the live patch; data/pbe for the PBE patch).
    static Library load(const std::string& rulesPath, const Settings& settings = {}, const std::string& gameDir = "");
    const ChampionKit* find(const std::string& nameOrId) const;
    // Sets a champion's cast order, e.g. "EQRW" (Q, W, E and R, each at most once). Throws if invalid.
    static void setCombo(ChampionKit& c, const std::string& combo);
    // The fight scenario for one champion: enemy pool without that champion and its
    // real share of team damage taken.
    Scenario scenarioFor(const ChampionKit& c) const;
    // Sets an enemy's Health, Armor and Magic Resist from its base stats at this level plus
    // its build (items and augments); enemies without a build keep the pool's estimate.
    // listed: the build was given by hand, so an empty one means no items at all.
    void equipEnemy(EnemyProfile& p, int level, bool listed = false) const;
    // The pick-weighted average enemy's HP, armor and magic resist at this level: the training dummy's defaults.
    std::array<double, 3> averageEnemy(int level) const;
    void validate(const Build& b) const;

    json::Value enemyPool;
};

enum Source : int { SrcAttack = 0, SrcQ, SrcW, SrcE, SrcR, SrcItems, SrcPassive, SrcCount };
extern const char* const kSourceNames[SrcCount];

constexpr double kShortFight = 6.0, kLongFight = 20.0;

struct Result {
    double duration = 0, totalDamage = 0, primaryDamage = 0, timeAlive = 0, damageTaken = 0, shielded = 0;
    double mitigated = 0;  // damage your Armor, Magic Resist, shields and damage reduction kept off your Health
    double healed = 0;     // Health you restored to yourself
    double ccDealt = 0;    // seconds of crowd control you put on enemies (overlaps on one enemy count once)
    double exposure = 0;  // share of the enemies' damage that could reach you, averaged over the fight
    double firstHit = -1; // when you first deal damage
    double inShort = 0, inLong = 0;  // damage dealt in the kShortFight and kLongFight seconds from then
    int kills = 0;
    bool died = false;
    std::array<double, SrcCount> bySource{};
};

// One moment of a traced fight, for the animated replay. kind is one of:
// cc, spawn, focus, cast, attack, proc, damage, kill, self, death, end, pos.
struct TraceEvent {
    double t = 0;
    std::string kind;
    int target = -1;          // enemy uid (spawn, focus, damage, kill)
    char slot = 0;            // Q/W/E/R for cast and proc
    std::string text;         // enemy champion id (spawn), damage type (damage), area (cast)
    int source = -1;          // Source of a damage event
    double amount = 0;        // damage dealt; cast time for casts; wind-up for attacks; cc end time for cc
    double lock = 0;          // casts: seconds a channel keeps the caster busy after it fires
    std::string who;          // cc on you: the enemy champion whose ability it is
    double hp = 0, maxHp = 0; // enemy HP after the event, or the champion's own HP for self/death
    double shield = 0;        // self/death: your shields left
    bool flag = false;        // crit for attacks, the main target was hit for casts
    double x = 0, y = 0;      // casts: where it was aimed
    double flight = 0;        // casts: seconds the missile flies
    std::vector<double> pos;  // pos: uid, x, y for everyone standing (uid -1 is the champion)
    // Running fight totals: self/death carry damage taken and mitigated so far, heal the Health
    // restored so far, ecc the seconds of crowd control dealt so far.
    double taken = 0, mitigated = 0, total = 0;
};

struct FightTrace {
    Result result;
    double engageAt = 0, maxHp = 0;
    std::vector<std::string> team;  // enemy champion ids in this fight (and the ones that step in later)
    std::vector<double> cooldowns;  // each ability's cooldown with the build's ability haste
    std::vector<TraceEvent> events;
};

// Plays one fight (same draws as runTrials for that trial) and records every event.
FightTrace traceFight(const Library& lib, const ChampionKit& champ, const Build& build, const Scenario& sc,
                      uint64_t trial);

std::vector<Result> runTrials(const Library& lib, const ChampionKit& champ, const Build& build, const Scenario& sc,
                              uint64_t firstTrial, int count);

struct Summary {
    int trials = 0;
    double meanDps = 0, ci95 = 0, p5 = 0, median = 0, p95 = 0;
    double singleTargetDps = 0, killsPerMinute = 0, survivalRate = 0, meanTimeAlive = 0;
    double damageTakenPerSec = 0;  // damage you take per second alive, after your resists
    // Per fight, on average: Health lost, damage mitigated, Health restored, seconds of crowd control dealt.
    double damageTaken = 0, damageMitigated = 0, healing = 0, ccSeconds = 0;
    // Short against long fights: damage per second over the first kShortFight and the first
    // kLongFight seconds from your first hit (going down early counts against both).
    double shortDps = 0, longDps = 0;
    std::array<double, SrcCount> shareBySource{};
};
Summary summarize(const std::vector<Result>& results);

// What a build search ranks builds by: damage per second (the default), or per fight the damage you
// take, the damage you mitigate, the Health you restore, or the seconds of crowd control you deal.
enum class Metric { Damage, Taken, Mitigated, Healing, Cc };
bool parseMetric(const std::string& name, Metric& out);
double metricOf(const Result& r, Metric m);
double metricOf(const Summary& s, Metric m);

struct Ranked {
    Build build;
    Summary summary;
};

// Searches item builds (boots + legendarySlots legendaries) and then augments for
// the highest mean DPS over the whole fight (dying early counts against a build), or
// the highest per-fight value of another metric.
// Uses the same fights for every build (common random numbers) so small
// differences are real differences, not noise. threads > 1 splits the work.
// With lib.optimizer.smart it runs the slower, wider smart search instead.
std::vector<Ranked> optimize(const Library& lib, const ChampionKit& champ, const Scenario& sc, int threads,
                             int top = 5, Metric metric = Metric::Damage);

// A champion's most popular full build in real games (the enemy pool's), or none.
Build popularBuild(const Library& lib, const ChampionKit& champ);

// 5v5: you and four allies against five enemies. Every champion plays its own fight against
// the other team, which says how much damage per second it deals to them and how much it can
// take; then the teams trade that damage, each side hitting the other's front line first.
using TeamPick = std::pair<const ChampionKit*, Build>;
struct TeamMember {
    const ChampionKit* kit = nullptr;
    Build build;
    Scenario scenario;  // this champion's own fight against the other team
    Summary summary;
    double share = 0;          // share of its team's damage
    double teamTimeAlive = 0;  // mean seconds standing in the 5v5 (to the end of the fight if it survives)
    double teamSurvival = 0;   // share of 5v5 fights it's still standing at the end
};
struct TeamEvent {
    double t = 0;
    int side = 0;    // 0 your team, 1 the enemy team
    size_t index = 0;  // who went down
};
struct TeamResult {
    std::vector<TeamMember> members, foes;
    double teamDps = 0, enemyDps = 0;
    double damageScale = 1;           // both teams' damage per second is scaled by this in the 5v5
    double fightLength = 0;           // median seconds until one team is down
    double winRate = 0;               // fights your team wins (a fight still going at 120 s counts half)
    std::vector<TeamEvent> timeline;  // who goes down when, in a median-length fight
};
// The enemy team when none is given: the five most likely enemies that aren't on your team,
// each with its most popular build.
std::vector<TeamPick> defaultEnemyTeam(const Library& lib, const std::vector<TeamPick>& allies);
TeamResult runTeam(const Library& lib, const std::vector<TeamPick>& allies, const std::vector<TeamPick>& enemies, int trials);

}  // namespace mayhem
