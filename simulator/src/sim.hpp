// Yunara ARAM Mayhem Monte Carlo DPS simulator: data model and core.
//
// The core is single-threaded and deterministic for a given seed so the same
// code can run natively (split across threads by main.cpp) or in a browser as
// WebAssembly (split across Web Workers). All game numbers come from
// data/yunara_mayhem.json; this file only holds mechanics.
#pragma once

#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "json.hpp"

namespace yunara {

// Flat stat bonuses an item, augment or anvil roll can grant.
struct StatBlock {
    double ad = 0, ap = 0, attackSpeed = 0, crit = 0, hp = 0, armor = 0, mr = 0, lifesteal = 0;
    double armorPenPct = 0, lethality = 0, magicPenFlat = 0, magicPenPct = 0;
    double critDamage = 0, apAmp = 0;
    double onhitPhys = 0, onhitMagic = 0, onhitMagicAp = 0, onhitCurHpPhys = 0;

    void add(const StatBlock& o);
    static StatBlock fromJson(const json::Value& v);
};

struct Effect {
    std::string id, name, special, requiresItem;
    std::string rarity;        // augments: silver, gold or prismatic
    bool offeredToYunara = true;  // augments: seen in Yunara's Mayhem augment stats
    StatBlock stats;
    std::map<std::string, double> params;
    std::vector<StatBlock> anvilOptions;
    double param(const std::string& key, double fallback = 0.0) const;
};

struct Build {
    std::string id, name;
    std::vector<std::string> items, augments;
};

// One kind of enemy Yunara might be hitting. A fight's enemies are drawn from
// these by weight, with health varied per enemy.
struct EnemyProfile {
    std::string id, name;
    int championId = 0;
    double weight = 1, hp = 3800, hpSd = 0, armor = 120, mr = 80;
    double damageTaken = 1.0;  // the champion's ARAM damage-taken modifier
    double cc = 0;             // crowd-control rating (1-3) when known
    double physShare = 0.5;    // share of the champion's damage that is physical
    double damageShare = 0.2;  // average share of their team's damage (0.2 = 1 of 5)
    double moveSpeed = 340;    // all-champion sim: how fast they move
    double reach = 550;        // all-champion sim: how far their damage reaches
    // all-champion sim: the enemy's build (its most popular items and augments)
    std::vector<std::string> items, augments;
    // all-champion sim: how hard its build hits at the fight's level compared with the
    // mid-game state real games' damage numbers average over (1 = the same), and its penetration
    double power = 1.0, lethality = 0, armorPen = 0, magicPen = 0, magicPenPct = 0;
    double attackSpeed = 0, attackRange = 0;  // all-champion sim: its attacks, for thorns (Thornmail)
};

struct Scenario {
    int level = 18;
    int trials = 20000;
    uint64_t seed = 1;
    double fightMean = 18, fightSd = 6, fightMin = 6, fightMax = 40;
    double ccRateMin = 0.05, ccRateMax = 0.20, ccMin = 0.75, ccMax = 1.75;
    int clumpMax = 4;
    double clumpChance = 0.45;
    double wHitChance = 0.75;
    double rReadyChance = 0.85;
    double retargetDelay = 1.5;
    // Enemy team to draw targets from. With fixedTarget every enemy uses targetHp/Armor/Mr.
    std::vector<EnemyProfile> enemies;
    bool fixedTarget = false;
    std::string enemySource = "archetypes";
    int teamSize = 5;
    // When > 0, a fight's CC rate is this times the enemy team's summed CC ratings
    // instead of a uniform draw between ccRateMin and ccRateMax.
    double ccRatePerPoint = 0;
    // When true, damage type and amount follow the drawn enemy team's champions.
    bool teamDrivenDamage = false;
    // How much damage Yunara takes relative to the average player (from real games).
    double damageTakenFactor = 1.0;
    double targetHp = 3800, targetArmor = 120, targetMr = 80;
    // Damage aimed at Yunara (before her armor and MR), and when it starts.
    double enemyDpsMean = 500, enemyDpsSd = 200, enemyPhysShare = 0.55;
    double engageMin = 2, engageMax = 6;
    // All-champion sim: how far away the enemy team starts and how spread out it stands.
    double startDistance = 1300, enemySpread = 250;
    // All-champion sim: fight until the champion dies (fightCap seconds at most) instead of
    // for a drawn fight length, and how many enemies a fight has (0 = the enemy pool's size).
    bool untilDeath = false;
    bool onFire = false;  // Mayhem's On Fire! buff on your champion
    bool randomRespawn = true;  // a fallen enemy from the pool is replaced by a new random champion
    double fightCap = 90, deathDamageScale = 1;
    int teamSizeRule = 0;
    int enemyLevel = 18;  // all-champion sim: the enemies' level

    static Scenario fromJson(const json::Value& s);
    // Replaces the enemy team with a champion pool built by tools/build_enemy_pool.py
    // (101.qq.com China-server Mayhem data), leaving out excludeChampionId.
    void applyEnemyPool(const json::Value& pool, int excludeChampionId = 0);
};

struct Champion {
    double baseAd = 55, adGrowth = 3;
    double baseAs = 0.65, asRatio = 0.65, asGrowth = 0.02;
    double baseHp = 590, hpGrowth = 110;
    double baseArmor = 25, armorGrowth = 4.4, baseMr = 33, mrGrowth = 1.1;
    double passiveRatio = 0.10, passivePer100Ap = 0.10;
    // Q
    int qRank = 5;
    std::vector<double> qOnhit, qActiveAs, qActiveOnhit;
    double qOnhitAp = 0.2, qActiveOnhitAp = 0.1, qStacksNeeded = 8, qActiveDuration = 5, qSpreadAd = 0.3;
    // W
    int wRank = 5;
    std::vector<double> wImpact;
    double wCooldown = 10, wAdRatio = 1.1, wApRatio = 0.5, wLingerRatio = 0.6, wLingerSecondaryChance = 0.6;
    double wCastMax = 0.45, wCastMin = 0.225, ruinCastMax = 0.6, ruinCastMin = 0.45;
    double ruinDamageMult = 1.5, ruinCooldownMult = 0.5;
    // E / R
    double eCooldown = 9, eDashTime = 0.25;
    int rRank = 3;
    std::vector<double> rCooldown;
    double rDuration = 15, rWRefund = 0.8;
};

struct Rules {
    double baseCritMult = 2.0;
    double critOverflowAdPerPercent = 0.45;
    double asCap = 5.0, asCapLethalTempo = 10.0;
    double damageDealt = 1.0;
};

struct GameData {
    Champion champ;
    Rules rules;
    std::map<std::string, Effect> items, augments;
    std::map<std::string, Build> builds;
    std::vector<std::string> buildOrder;
    Scenario scenario;

    static GameData fromJson(const json::Value& root);
    // Replaces the scenario's enemy team with a champion pool built by
    // tools/build_enemy_pool.py (101.qq.com China-server Mayhem data).
    void applyEnemyPool(const json::Value& pool);
    // Throws std::runtime_error naming any unknown item or augment.
    void validate(const Build& b) const;
};

enum Source : int {
    SrcAttack = 0,     // basic attack physical damage
    SrcPassive,        // crit bonus magic damage
    SrcQOnhit,         // Q on-hit magic (passive and active)
    SrcQSpread,        // Q active spread to clumped enemies
    SrcW,              // W impact and lingering zone
    SrcItemOnhit,      // item and rune on-hit (Rageblade, BotRK, Wit's, Nashor, Kraken, Stormrazor)
    SrcExtraBolts,     // Runaan's, Typhoon, Dual Wield and Critical Missile
    SrcCount
};
extern const char* const kSourceNames[SrcCount];

struct TrialResult {
    double duration = 0;
    double totalDamage = 0;
    double primaryDamage = 0;
    int kills = 0;
    bool died = false;
    double timeAlive = 0;
    std::array<double, SrcCount> bySource{};
};

// Runs `count` trials starting at trial index `firstTrial`. Each trial seeds its
// own RNG from (seed, trial index), so results do not depend on how trials are
// split across threads or workers.
std::vector<TrialResult> runTrials(const GameData& data, const Build& build, const Scenario& sc,
                                   uint64_t firstTrial, int count);

struct Summary {
    int trials = 0;
    double meanDps = 0, ci95 = 0, p5 = 0, median = 0, p95 = 0;
    double singleTargetDps = 0, killsPerMinute = 0;
    double survivalRate = 0, meanTimeAlive = 0;
    std::array<double, SrcCount> shareBySource{};
};
Summary summarize(const std::vector<TrialResult>& results);

}  // namespace yunara
