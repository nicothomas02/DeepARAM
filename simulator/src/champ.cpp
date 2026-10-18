#include "champ.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <deque>
#include <fstream>
#include <numeric>
#include <set>
#include <sstream>
#include <stdexcept>
#ifndef __EMSCRIPTEN__
#include <thread>
#include <type_traits>
#endif

#include "rng.hpp"

namespace mayhem {

const char* const kSourceNames[SrcCount] = {"Basic attacks", "Q", "W", "E", "R", "Items and augments", "Passive"};

double get(const Bag& b, const std::string& key, double fallback) {
    auto it = b.find(key);
    return it == b.end() ? fallback : it->second;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

namespace {

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open " + path);
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

std::string dirOf(const std::string& path) {
    const auto slash = path.find_last_of("/\\");
    return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string lower(std::string s) {
    for (auto& ch : s) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    std::string out;
    for (char ch : s)
        if (std::isalnum(static_cast<unsigned char>(ch))) out += ch;
    return out;
}

Bag bagOf(const json::Value& v) {
    Bag b;
    for (const auto& [k, x] : v.obj)
        if (x.isNumber()) b[k] = x.asNumber();
    return b;
}

double ruleValue(const json::Value& rules, const char* key, double fallback) {
    const json::Value& r = rules[key];
    if (r.isObject()) return r["value"].asNumber(fallback);
    return r.asNumber(fallback);
}

std::map<std::string, Effect> loadEffects(const json::Value& obj, const char* defaultSlot) {
    std::map<std::string, Effect> out;
    for (const auto& [key, v] : obj.obj) {
        if (!v.isObject()) continue;
        Effect e;
        e.key = key;
        e.name = v["name"].asString(key);
        e.id = static_cast<int>(v["id"].asNumber(0));
        e.slot = v["slot"].asString(defaultSlot);
        e.rarity = v["rarity"].asString();
        e.cost = v["cost"].asNumber(0);
        e.confidence = v["confidence"].asString("approx");
        for (const auto& r : v["roles"].arr) e.roles.push_back(r.asString());
        e.stats = bagOf(v["stats"]);
        e.effects = bagOf(v["effects"]);
        e.needsItem = v["requires_item"].asString();
        e.group = v["group"].asString();
        e.bind = v["spell_bind"].asString();
        out[key] = e;
    }
    return out;
}

Area areaOf(const std::string& s) {
    if (s == "aoe") return Area::Aoe;
    if (s == "line") return Area::Line;
    return Area::Single;
}

Geometry geometryOf(const json::Value& g, Area area, double attackRange) {
    Geometry geo;
    const std::string shape = g["shape"].asString();
    geo.shape = shape == "line" ? Shape::Line : shape == "circle" ? Shape::Circle : shape == "cone" ? Shape::Cone
                : shape == "single"                                                     ? Shape::Single
                : area == Area::Line ? Shape::Line : area == Area::Aoe ? Shape::Circle : Shape::Single;
    geo.range = g["range"].asNumber(0);
    geo.radius = g["radius"].asNumber(geo.shape == Shape::Circle ? 250 : 0);
    geo.width = g["width"].asNumber(geo.shape == Shape::Line ? 80 : 0);
    geo.angle = g["angle"].asNumber(geo.shape == Shape::Cone ? 45 : 0);
    geo.speed = g["speed"].asNumber(0);
    geo.onSelf = g["on_self"].asBool(false);
    geo.selfBuff = g["self_buff"].asBool(false);
    geo.stops = g["stops"].asBool(false);
    const std::string move = g["move"].asString();
    geo.move = move == "dash" ? Move::Dash : move == "blink" ? Move::Blink : Move::None;
    if (geo.range <= 0 && !geo.onSelf) geo.range = std::max(600.0, attackRange + 100);
    if (geo.selfBuff) geo.range = attackRange;
    return geo;
}

ChampionKit loadChampion(const json::Value& c, const Rules& rules) {
    ChampionKit k;
    k.id = c["id"].asString();
    k.name = c["name"].asString(k.id);
    k.championId = static_cast<int>(c["champion_id"].asNumber(0));
    k.role = c["role"].asString("fighter");
    k.ranged = c["ranged"].asBool(false);
    k.parseQuality = c["parse_quality"].asString();
    const json::Value& s = c["stats"];
    k.hp = s["hp"].asNumber(k.hp);
    k.hpG = s["hp_per_level"].asNumber(k.hpG);
    k.armor = s["armor"].asNumber(k.armor);
    k.armorG = s["armor_per_level"].asNumber(k.armorG);
    k.mr = s["mr"].asNumber(k.mr);
    k.mrG = s["mr_per_level"].asNumber(k.mrG);
    k.ad = s["ad"].asNumber(k.ad);
    k.adG = s["ad_per_level"].asNumber(k.adG);
    k.as = s["attack_speed"].asNumber(k.as);
    k.asG = s["attack_speed_per_level"].asNumber(k.asG);
    k.asRatio = s["attack_speed_ratio"].asNumber(k.as);
    k.attackRange = s["attack_range"].asNumber(k.ranged ? 550 : 125);
    k.moveSpeed = s["move_speed"].asNumber(k.moveSpeed);
    k.windup = std::clamp(s["attack_windup"].asNumber(0.3), 0.05, 0.6);
    k.windupMod = s["attack_windup_mod"].asNumber(1.0);
    const json::Value& m = c["mayhem"];
    k.damageDealt = m["damage_dealt"].asNumber(1.0);
    k.damageTaken = m["damage_taken"].asNumber(1.0);
    k.mayhemAh = m["ability_haste"].asNumber(0.0);
    k.mayhemAs = m["attack_speed"].asNumber(0.0);
    k.mayhemHealing = m["healing"].asNumber(1.0);
    k.mayhemShielding = m["shielding"].asNumber(1.0);
    k.mayhemTenacity = std::clamp(m["tenacity"].asNumber(0.0), 0.0, 1.0);
    const json::Value& res = c["resource"];
    const std::string kind = res["kind"].asString("none");
    k.resource = kind == "mana" ? 1 : kind == "energy" ? 2 : 0;
    k.mana = res["pool"].asNumber(0);
    k.manaG = res["pool_per_level"].asNumber(0);
    k.manaRegen = res["regen"].asNumber(0);
    k.manaRegenG = res["regen_per_level"].asNumber(0);
    k.kitStats = bagOf(c["kit"]["stats"]);
    k.kitEffects = bagOf(c["kit"]["effects"]);
    const json::Value& d = c["death"];
    k.deathAct = d["act"].asNumber(0.0);
    k.reviveFrac = d["revive_frac"].asNumber(0.0);
    k.reviveDelay = d["revive_delay"].asNumber(0.0);
    k.deathChance = d["chance"].asNumber(1.0);
    k.deathNeedsR = d["needs_r"].asBool(false);
    const json::Value& cn = c["cn"];
    if (cn.isObject()) {
        k.hasCn = true;
        k.cnDamageShare = cn["damage_share"].asNumber(0.2);
        k.cnTakenShare = cn["damage_taken_share"].asNumber(0.2);
        k.cnWeight = cn["weight"].asNumber(0.0);
        k.cnWinRate = cn["win_rate"].asNumber(0.5);
    }
    auto hitOf = [](const json::Value& h) {
        Hit hit;
        const std::string type = h["type"].asString("magic");
        hit.type = type == "physical" ? DamageType::Physical : type == "true" ? DamageType::True : DamageType::Magic;
        const std::string target = h["target"].asString("flat");
        hit.target = target == "target_max_hp"       ? HitTarget::MaxHp
                     : target == "target_current_hp" ? HitTarget::CurrentHp
                     : target == "target_missing_hp" ? HitTarget::MissingHp
                                                     : HitTarget::Flat;
        hit.perSecond = h["per_second"].asBool(false);
        hit.calc = h["calc"].asString();
        hit.scaling = bagOf(h["scaling"]);
        return hit;
    };
    for (const auto& p : c["passives"].arr) {
        Passive ps;
        const std::string t = p["trigger"].asString("attack");
        ps.trigger = t == "ability" ? Passive::Trigger::Ability : t == "hit" ? Passive::Trigger::Hit
                     : t == "after_ability" ? Passive::Trigger::AfterAbility : Passive::Trigger::Attack;
        ps.every = std::max(1, static_cast<int>(p["every"].asNumber(1)));
        ps.cooldown = std::max(0.0, p["cooldown"].asNumber(0));
        ps.perTarget = p["per_target"].asBool(false);
        ps.charges = std::max(1, static_cast<int>(p["charges"].asNumber(1)));
        ps.maxCharges = std::max(1, static_cast<int>(p["max_charges"].asNumber(1)));
        ps.aoe = p["aoe"].asBool(false);
        ps.belowHp = p["below_hp"].asNumber(0);
        for (const auto& h : p["hits"].arr) ps.hits.push_back(hitOf(h));
        if (!ps.hits.empty()) k.passives.push_back(ps);
    }
    for (const auto& a : c["abilities"].arr) {
        Ability ab;
        const std::string slot = a["slot"].asString("Q");
        ab.slot = slot.empty() ? 'Q' : slot[0];
        ab.name = a["name"].asString();
        ab.cooldown = a["cooldown"].asNumber(10);
        ab.castTime = std::clamp(a["cast_time"].asNumber(0.25), rules.castMin, rules.castMax);
        ab.lock = std::max(0.0, a["lock"].asNumber(0));
        ab.castFromAttack = a["cast_from_attack"].asNumber(0);
        ab.attackReset = a["attack_reset"].asBool(false);
        const json::Value& cc = a["cc"];
        if (cc.isObject()) {
            ab.cc = cc["type"].asString();
            ab.ccDuration = cc["duration"].asNumber(1.0);
            ab.ccSlow = cc["amount"].asNumber(0.3);
            if (ab.cc != "slow" && ab.cc != "silence" && ab.cc != "root") k.hardCc.push_back({ab.slot, ab.cc});
        }
        if (a["heal"].isObject()) ab.heal = bagOf(a["heal"]["scaling"]);
        ab.cost = a["cost"].asNumber(0);
        if (a["shield"].isObject()) {
            ab.shield = bagOf(a["shield"]["scaling"]);
            ab.shieldDuration = a["shield"]["duration"].asNumber(2.5);
        }
        ab.duration = a["duration"].asNumber(0);
        ab.area = areaOf(a["area"].asString());
        ab.geo = geometryOf(a["geometry"], ab.area, k.attackRange);
        ab.onhitEvery = static_cast<int>(a["onhit_every"].asNumber(0));
        ab.toggle = a["toggle"].asBool(false);

        // Which tooltip numbers count: the first main number fully, repeats of the
        // same formula fully (e.g. Ahri Q out and back), other numbers at
        // extraHitWeight. Alternatives (empowered/maximum versions) only when an
        // ability has nothing else.
        std::vector<Hit> main, alts;
        for (const auto& h : a["hits"].arr) {
            Hit hit = hitOf(h);
            (h["alt"].asBool(false) ? alts : main).push_back(hit);
        }
        if (main.empty() && !alts.empty()) main.push_back(alts.front());
        std::set<std::string> seen;
        bool first = true;
        for (auto& hit : main) {
            if (first || seen.count(hit.calc)) hit.weight = 1.0;
            else hit.weight = hit.target == HitTarget::Flat ? rules.extraHitWeight : 1.0;
            // A percent-health part usually belongs to the main hit, so it counts fully.
            first = false;
            seen.insert(hit.calc);
            ab.hits.push_back(hit);
        }
        // A toggle's numbers are per second, whatever its tooltip's wording.
        if (ab.toggle)
            for (auto& hit : ab.hits) hit.perSecond = true;
        bool allPerSecond = !ab.hits.empty();
        for (const auto& hit : ab.hits) allPerSecond &= hit.perSecond;
        ab.aura = ab.toggle || (allPerSecond && ab.cooldown < 1.0 && ab.onhitEvery == 0);
        if (!ab.aura && ab.onhitEvery == 0) ab.cooldown = std::max(ab.cooldown, rules.minCooldown);
        for (const auto& hit : ab.hits) {
            k.apRatios += get(hit.scaling, "ap") * hit.weight;
            k.adRatios += get(hit.scaling, "bonus_ad") * hit.weight;
        }
        // Shield-only abilities (Lux W, Janna E) are cast on yourself.
        if (ab.hits.empty() && !ab.shield.empty() && ab.geo.move == Move::None) {
            ab.geo.selfBuff = true;
            ab.geo.range = k.attackRange;
        }
        if (!ab.hits.empty() || !ab.shield.empty()) k.abilities.push_back(ab);
    }
    // How far its damage reaches, as an enemy: the middle of its basic abilities' reach
    // (capped at 800), or its attack range. Ultimates and dashes don't count: a dash
    // brings it close, and long-range ultimates aren't what it fights with.
    std::vector<double> reaches;
    for (const auto& a : k.abilities) {
        if (a.hits.empty() || a.onhitEvery > 0 || a.slot == 'R' || a.geo.move != Move::None) continue;
        const Geometry& g = a.geo;
        double r = g.shape == Shape::Circle ? (g.onSelf ? g.radius : g.range + 0.5 * g.radius) : g.range;
        reaches.push_back(std::clamp(r, k.attackRange, 800.0));
    }
    std::sort(reaches.begin(), reaches.end());
    k.reach = reaches.empty() ? k.attackRange : std::max(k.attackRange, reaches[reaches.size() / 2]);
    return k;
}

}  // namespace

const std::vector<std::pair<std::string, std::string>>& Library::settingKeys() {
    static const std::vector<std::pair<std::string, std::string>> keys = {
        // fight
        {"level", "your champion's level (1-18)"},
        {"enemy_level", "the enemies' level (1-18); their Health, resists and damage come from it plus their build"},
        {"fight_mean", "average fight length, seconds"},
        {"fight_sd", "spread of fight length, seconds"},
        {"fight_min", "shortest fight, seconds"},
        {"fight_max", "longest fight, seconds"},
        {"until_death", "1: each fight runs until your champion dies; 0: fights last the drawn length"},
        {"on_fire", "1: your champion is On Fire! (faster attacks and movement, less healing, more damage taken)"},
        {"fight_cap", "longest a fight can run when it lasts until you die, seconds"},
        {"team_size", "how many enemies are in the fight (1-5)"},
        {"engage_min", "earliest time enemies start hitting you, seconds"},
        {"engage_max", "latest time enemies start hitting you, seconds"},
        {"enemy_damage_scale", "multiplies the damage enemies deal to you"},
        {"cc_scale", "multiplies how often you get crowd controlled"},
        {"cc_min", "shortest crowd control, seconds"},
        {"cc_max", "longest crowd control, seconds"},
        {"start_distance", "how far away the enemy team starts, game units"},
        {"enemy_spread", "how spread out the enemy team stands, game units"},
        {"r_ready_chance", "chance your ultimate is up when the fight starts"},
        {"retarget_delay", "seconds to reach the next target after a kill"},
        {"fixed_target", "1: fight dummies with the HP and resists below instead of real champions"},
        {"target_hp", "dummy HP (default: the average enemy's)"},
        {"target_armor", "dummy armor"},
        {"target_mr", "dummy magic resist"},
        // model rules
        {"dodge_chance", "chance an enemy sees a skillshot coming and sidesteps"},
        {"reaction_time", "seconds before a dodging enemy starts moving"},
        {"aim_lead", "how far ahead of a moving enemy skillshots are aimed (0-1)"},
        {"combo_order", "1: cast abilities in each champion's recommended combo order; 0: strongest first"},
    };
    return keys;
}

static bool isModelKey(const std::string& k) {
    return k == "dodge_chance" || k == "reaction_time" || k == "aim_lead" || k == "combo_order";
}

Library Library::load(const std::string& rulesPath, const Settings& settings, const std::string& gameDir) {
    Library lib;
    for (const auto& [k, v] : settings) {
        bool known = false;
        for (const auto& kv : settingKeys()) known |= kv.first == k;
        if (!known) throw std::runtime_error("unknown setting '" + k + "'");
        if (!isModelKey(k)) lib.fight[k] = v;
    }
    const std::string dir = dirOf(rulesPath);
    const std::string game = gameDir.empty() ? dir : gameDir;
    const json::Value root = json::parse(readFile(rulesPath));
    const json::Value& r = root["rules"];
    lib.rules.critMult = ruleValue(r, "base_crit_multiplier", 2.0);
    lib.rules.grievous = ruleValue(r, "grievous_wounds", 0.4);
    lib.rules.critOverflowAf = ruleValue(r, "crit_overflow_adaptive_per_percent", 0.75);
    lib.rules.asCap = ruleValue(r, "attack_speed_cap", 5.0);
    lib.rules.mayhemHpMelee = ruleValue(r, "mayhem_health_melee", 600);
    lib.rules.mayhemHpRanged = ruleValue(r, "mayhem_health_ranged", 400);
    lib.rules.mayhemResistMelee = ruleValue(r, "mayhem_resists_melee", 15);
    lib.rules.mayhemResistRanged = ruleValue(r, "mayhem_resists_ranged", 0);
    lib.rules.longRangeStart = ruleValue(r, "long_range_start", 1000);
    lib.rules.longRangeNear = ruleValue(r, "long_range_damage_near", 0.85);
    lib.rules.longRangeFar = ruleValue(r, "long_range_damage_far", 0.70);
    lib.rules.comboTenacity = ruleValue(r, "combo_breaker_tenacity", 0.2);
    lib.rules.comboDuration = ruleValue(r, "combo_breaker_duration", 3.25);
    lib.rules.fireAs = ruleValue(r, "on_fire_attack_speed", 0.2);
    lib.rules.fireMs = ruleValue(r, "on_fire_move_speed", 0.2);
    lib.rules.fireHeal = ruleValue(r, "on_fire_healing_cut", 0.25);
    lib.rules.fireTakenMelee = ruleValue(r, "on_fire_damage_taken_melee", 1.25);
    lib.rules.fireTakenRanged = ruleValue(r, "on_fire_damage_taken_ranged", 1.35);
    const json::Value& m = root["model"];
    lib.rules.extraHitWeight = m["extra_hit_weight"].asNumber(lib.rules.extraHitWeight);
    lib.rules.dodgeChance = m["dodge_chance"].asNumber(lib.rules.dodgeChance);
    lib.rules.reactionTime = m["reaction_time"].asNumber(lib.rules.reactionTime);
    lib.rules.aimLead = m["aim_lead"].asNumber(lib.rules.aimLead);
    lib.rules.hitbox = m["hitbox_radius"].asNumber(lib.rules.hitbox);
    lib.rules.laneHalfWidth = m["lane_half_width"].asNumber(lib.rules.laneHalfWidth);
    lib.rules.inRangeBoost = m["in_range_damage_boost"].asNumber(lib.rules.inRangeBoost);
    lib.rules.focusRamp = m["focus_ramp"].asNumber(lib.rules.focusRamp);
    lib.rules.castMin = m["cast_time_min"].asNumber(lib.rules.castMin);
    lib.rules.castMax = m["cast_time_max"].asNumber(lib.rules.castMax);
    lib.rules.minCooldown = m["min_cooldown"].asNumber(lib.rules.minCooldown);
    lib.rules.dotDuration = m["default_dot_duration"].asNumber(lib.rules.dotDuration);
    lib.rules.spellbladeWindow = m["spellblade_window"].asNumber(lib.rules.spellbladeWindow);
    lib.rules.enemyAbilities = m["enemy_abilities"].asNumber(lib.rules.enemyAbilities);
    lib.rules.enemyHitChance = m["enemy_hit_chance"].asNumber(lib.rules.enemyHitChance);
    lib.rules.enemyAbilityHaste = m["enemy_ability_haste"].asNumber(lib.rules.enemyAbilityHaste);
    lib.rules.enemyAbilityShare = m["enemy_ability_share"].asNumber(lib.rules.enemyAbilityShare);
    lib.rules.enemyAbilityShareMarksman = m["enemy_ability_share_marksman"].asNumber(lib.rules.enemyAbilityShareMarksman);
    auto setRule = [&](const char* key, double& field) {
        auto it = settings.find(key);
        if (it != settings.end()) field = std::clamp(it->second, 0.0, 1.0);
    };
    setRule("dodge_chance", lib.rules.dodgeChance);
    setRule("reaction_time", lib.rules.reactionTime);
    setRule("aim_lead", lib.rules.aimLead);
    setRule("combo_order", lib.rules.comboOrder);
    const json::Value& o = root["optimizer"];
    OptimizerSettings& os = lib.optimizer;
    os.legendarySlots = static_cast<int>(o["legendary_slots"].asNumber(os.legendarySlots));
    os.augmentSlots = static_cast<int>(o["augment_slots"].asNumber(os.augmentSlots));
    os.candidates = static_cast<int>(o["candidate_items"].asNumber(os.candidates));
    os.screenTrials = static_cast<int>(o["screen_trials"].asNumber(os.screenTrials));
    os.finalTrials = static_cast<int>(o["final_trials"].asNumber(os.finalTrials));
    os.finalists = static_cast<int>(o["finalists"].asNumber(os.finalists));
    os.fittingItemsOnly = o["fitting_items_only"].asBool(os.fittingItemsOnly);
    const json::Value& sm = o["smart"];
    os.smartItems = static_cast<int>(sm["candidate_items"].asNumber(os.smartItems));
    os.smartAugs = static_cast<int>(sm["candidate_augments"].asNumber(os.smartAugs));
    os.smartItemSets = static_cast<int>(sm["item_sets"].asNumber(os.smartItemSets));
    os.smartAugSets = static_cast<int>(sm["augment_sets"].asNumber(os.smartAugSets));
    os.smartStartTrials = static_cast<int>(sm["start_trials"].asNumber(os.smartStartTrials));
    os.smartKeep = std::max(2, static_cast<int>(sm["keep_one_in"].asNumber(os.smartKeep)));
    os.smartFinalists = std::max(1, static_cast<int>(sm["finalists"].asNumber(os.smartFinalists)));
    os.smartFinalTrials = static_cast<int>(sm["final_trials"].asNumber(os.smartFinalTrials));

    lib.scenario = Scenario::fromJson(root["scenario"]);
    const json::Value champs = json::parse(readFile(game + "/champions.json"));
    for (const auto& c : champs["champions"].arr) {
        lib.champions.push_back(loadChampion(c, lib.rules));
        lib.mayhemDamageTaken[lib.champions.back().championId] = lib.champions.back().damageTaken;
    }
    // Recommended combos: the order each champion casts abilities in when several are ready.
    std::ifstream comboFile(dir + "/combos.json");
    if (comboFile) {
        const json::Value combos = json::parse(readFile(dir + "/combos.json"));
        for (auto& c : lib.champions) {
            const std::string combo = combos[c.id].asString();
            if (!combo.empty()) Library::setCombo(c, combo);
        }
    }
    lib.items = loadEffects(json::parse(readFile(game + "/items.json"))["items"], "legendary");
    lib.augments = loadEffects(json::parse(readFile(game + "/augments.json"))["augments"], "augment");
    const std::string pool = root["scenario"]["enemy_pool"].asString();
    if (!pool.empty()) lib.enemyPool = json::parse(readFile(dir + "/" + pool));
    std::ifstream poolFile(dir + "/augment_pools.json");
    if (poolFile) {
        const json::Value pools = json::parse(readFile(dir + "/augment_pools.json"));
        for (const auto& [id, list] : pools["pools"].obj) {
            auto& out = lib.augmentPools[std::stoi(id)];
            for (const auto& a : list.arr)
                if (lib.augments.count(a.asString())) out.push_back(a.asString());
        }
    }
    return lib;
}

std::vector<std::string> Library::augmentsFor(const ChampionKit& c, bool modeledOnly) const {
    std::vector<std::string> out;
    auto it = augmentPools.find(c.championId);
    for (const auto& [key, a] : augments) {
        if (modeledOnly && a.stats.empty() && a.effects.empty()) continue;
        if (it != augmentPools.end() && !it->second.empty() &&
            std::find(it->second.begin(), it->second.end(), key) == it->second.end())
            continue;
        out.push_back(key);
    }
    return out;
}

void Library::setCombo(ChampionKit& c, const std::string& combo) {
    std::string out;
    for (char ch : combo) {
        const char up = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
        if (up == ' ' || up == '>' || up == '-' || up == ',') continue;
        if (std::string("QWER").find(up) == std::string::npos || out.find(up) != std::string::npos)
            throw std::runtime_error("combo '" + combo + "' for " + c.name + ": use each of Q, W, E, R at most once");
        out += up;
    }
    c.combo = out;
}

const ChampionKit* Library::find(const std::string& nameOrId) const {
    const std::string want = lower(nameOrId);
    for (const auto& c : champions)
        if (lower(c.id) == want || lower(c.name) == want || std::to_string(c.championId) == nameOrId) return &c;
    return nullptr;
}

double meanExposure(const Library& lib, const ChampionKit& c, const Scenario& sc);

// How far per-level stats have grown by this level (the game's level curve).
static double statGrowth(int level) {
    const double n = level - 1;
    return n * (0.7025 + 0.0175 * n);
}

// How hard a champion hits at a level with some items and augments: attacks for its physical
// damage (attack damage, crit, attack speed), abilities for its magic damage (base damage that
// grows with level, plus AP). Only ratios of it are used.
static double offense(const ChampionKit& k, int level, const std::vector<const Effect*>& gear, double physShare) {
    const double g = statGrowth(level);
    double ad = 0, ap = 0, as = 0, crit = 0, critDamage = 0, adaptive = 0, apAmp = 0, amp = 0;
    auto stat = [](const Bag& b, const char* key) { auto f = b.find(key); return f == b.end() ? 0.0 : f->second; };
    for (const Effect* e : gear) {
        ad += stat(e->stats, "ad"); ap += stat(e->stats, "ap"); as += stat(e->stats, "as");
        crit += stat(e->stats, "crit"); critDamage += stat(e->stats, "crit_damage");
        adaptive += stat(e->effects, "adaptive_amp"); apAmp += stat(e->effects, "ap_amp");
        amp += stat(e->effects, "damage_amp");
    }
    if (ap >= ad) ap *= 1.0 + adaptive; else ad *= 1.0 + adaptive;
    ap *= 1.0 + apAmp;
    crit = std::min(1.0, crit);
    // Mayhem crits deal 200% (base_crit_multiplier).
    const double phys = (k.ad + k.adG * g + ad) * (1.0 + crit * (1.0 + critDamage)) * (1.0 + 0.35 * (k.asG * g + as));
    const double magic = 40.0 + 8.0 * (level - 1) + 0.7 * ap;
    return (physShare * phys / (k.ad + k.adG * 12) + (1.0 - physShare) * magic / 170.0) * (1.0 + amp);
}

void Library::equipEnemy(EnemyProfile& p, int level, bool listed) const {
    const ChampionKit* k = find(std::to_string(p.championId));
    if (!k) return;
    std::vector<const Effect*> gear;
    for (int pass = 0; pass < 2; ++pass) {
        auto& names = pass ? p.augments : p.items;
        const auto& table = pass ? augments : items;
        // A build typed for this enemy must be valid. Pool builds come from live-patch games, so on
        // another patch (PBE) they can name an item or augment that patch removed: it's left out.
        if (!listed)
            names.erase(std::remove_if(names.begin(), names.end(), [&](const std::string& n) { return !table.count(n); }),
                        names.end());
        for (const auto& name : names) {
            auto fx = table.find(name);
            if (fx == table.end())
                throw std::runtime_error("unknown " + std::string(pass ? "augment" : "item") + " '" + name + "' for enemy " + p.name);
            gear.push_back(&fx->second);
        }
    }
    // Real games' damage is a whole game's average: taken as level 15 with the first four
    // items and three augments. The fight's level and full build scale it from there (at most 3x).
    std::vector<const Effect*> early;
    for (size_t i = 0; i < gear.size(); ++i)
        if (i < std::min<size_t>(4, p.items.size()) || (i >= p.items.size() && i < p.items.size() + 3)) early.push_back(gear[i]);
    p.power = std::min(3.0, offense(*k, level, gear, p.physShare) / offense(*k, 15, early, p.physShare));
    if (!listed && gear.empty()) return;
    const double g = statGrowth(level);
    const double extra = rules.mayhemResist(k->ranged);  // Mayhem stats every champion gets
    double hp = k->hp + k->hpG * g + rules.mayhemHp(level, k->ranged), armor = k->armor + k->armorG * g + extra,
           mr = k->mr + k->mrG * g + extra, hpPct = 0;
    p.lethality = p.armorPen = p.magicPen = p.magicPenPct = 0;
    auto stat = [](const Bag& b, const char* key) { auto f = b.find(key); return f == b.end() ? 0.0 : f->second; };
    for (const Effect* e : gear) {
        hp += stat(e->stats, "hp");
        armor += stat(e->stats, "armor");
        mr += stat(e->stats, "mr");
        hpPct += stat(e->effects, "hp_pct");
        p.lethality += stat(e->stats, "lethality");
        p.armorPen = 1.0 - (1.0 - p.armorPen) * (1.0 - stat(e->stats, "armor_pen"));
        p.magicPen += stat(e->stats, "magic_pen");
        p.magicPenPct = 1.0 - (1.0 - p.magicPenPct) * (1.0 - stat(e->stats, "magic_pen_pct"));
    }
    p.hp = hp * (1.0 + hpPct);
    p.armor = armor;
    p.mr = mr;
}

std::array<double, 3> Library::averageEnemy(int level) const {
    Scenario pool = scenario;
    if (enemyPool.isObject()) pool.applyEnemyPool(enemyPool);
    double w = 0, hp = 0, armor = 0, mr = 0;
    for (auto& e : pool.enemies) {
        equipEnemy(e, level);
        w += e.weight; hp += e.weight * e.hp; armor += e.weight * e.armor; mr += e.weight * e.mr;
    }
    if (w <= 0) return {scenario.targetHp, scenario.targetArmor, scenario.targetMr};
    return {std::round(hp / w / 10) * 10, std::round(armor / w), std::round(mr / w)};
}

Scenario Library::scenarioFor(const ChampionKit& c) const {
    Scenario sc = scenario;
    if (enemyPool.isObject()) {
        sc.applyEnemyPool(enemyPool, c.championId);
        for (auto& e : sc.enemies) {
            auto it = mayhemDamageTaken.find(e.championId);
            if (it != mayhemDamageTaken.end()) e.damageTaken = it->second;
            if (const ChampionKit* k = find(std::to_string(e.championId))) {
                e.moveSpeed = k->moveSpeed;
                e.reach = k->reach;
            }
        }
    }
    sc.damageTakenFactor = c.damageTaken;
    if (scenario.teamSizeRule > 0) sc.teamSize = scenario.teamSizeRule;
    if (auto it = fight.find("team_size"); it != fight.end()) sc.teamSize = static_cast<int>(it->second);
    sc.teamSize = std::clamp(sc.teamSize, 1, 5);

    auto set = [&](const char* key, auto& field) {
        auto it = fight.find(key);
        if (it != fight.end()) field = static_cast<std::decay_t<decltype(field)>>(it->second);
    };
    set("enemy_level", sc.enemyLevel);
    sc.enemyLevel = std::clamp(sc.enemyLevel, 1, 18);
    auto equip = [&](EnemyProfile& p, bool listed = false) { equipEnemy(p, sc.enemyLevel, listed); };
    for (auto& e : sc.enemies) equip(e);

    if (!enemyTeam.empty() && enemyPool.isObject()) {
        std::vector<EnemyProfile> picked;
        for (const auto& entry : enemyTeam) {
            // "Malphite" or "Malphite:hp=5000:armor=250:items=warmogs+thornmail" to change that enemy.
            std::vector<std::string> parts;
            std::stringstream ss(entry);
            for (std::string part; std::getline(ss, part, ':');) parts.push_back(part);
            const std::string want = parts.empty() ? entry : parts[0];
            bool found = false;
            for (const auto& e : sc.enemies)
                if (lower(e.id) == lower(want) || lower(e.name) == lower(want)) {
                    picked.push_back(e);
                    found = true;
                    break;
                }
            if (!found) throw std::runtime_error("'" + want + "' is not in the enemy pool (or is the champion itself)");
            EnemyProfile& p = picked.back();
            p.weight = 1.0;
            // A listed build replaces the enemy's own; listed stats then replace what it gives.
            bool rebuilt = false;
            for (size_t i = 1; i < parts.size(); ++i) {
                const auto eq = parts[i].find('=');
                if (eq == std::string::npos) throw std::runtime_error("enemy stat '" + parts[i] + "' needs key=value");
                const std::string key = parts[i].substr(0, eq);
                if (key != "items" && key != "augs") continue;
                auto& list = key == "items" ? p.items : p.augments;
                list.clear();
                std::stringstream ls(parts[i].substr(eq + 1));
                for (std::string name; std::getline(ls, name, '+');)
                    if (!name.empty()) list.push_back(name);
                rebuilt = true;
            }
            if (rebuilt) equip(p, true);
            for (size_t i = 1; i < parts.size(); ++i) {
                const auto eq = parts[i].find('=');
                const std::string key = parts[i].substr(0, eq);
                if (key == "items" || key == "augs") continue;
                const double v = std::stod(parts[i].substr(eq + 1));
                if (key == "hp") p.hp = std::max(1.0, v);
                else if (key == "armor") p.armor = std::max(0.0, v);
                else if (key == "mr") p.mr = std::max(0.0, v);
                else if (key == "damage_share") p.damageShare = std::max(0.0, v);
                else if (key == "phys_share") p.physShare = std::clamp(v, 0.0, 1.0);
                else if (key == "cc") p.cc = std::max(0.0, v);
                else if (key == "damage_taken") p.damageTaken = std::max(0.0, v);
                else throw std::runtime_error("unknown enemy stat '" + key +
                                              "' (use hp, armor, mr, damage_share, phys_share, cc, damage_taken, items, augs)");
            }
        }
        sc.enemies = picked;
        sc.teamSize = static_cast<int>(picked.size());
    }
    set("level", sc.level);
    sc.level = std::clamp(sc.level, 1, 18);
    set("fight_mean", sc.fightMean);
    set("fight_sd", sc.fightSd);
    set("fight_min", sc.fightMin);
    set("fight_max", sc.fightMax);
    if (auto it = fight.find("until_death"); it != fight.end()) sc.untilDeath = it->second > 0;
    if (auto it = fight.find("on_fire"); it != fight.end()) sc.onFire = it->second > 0;
    set("fight_cap", sc.fightCap);
    sc.fightCap = std::clamp(sc.fightCap, 5.0, 600.0);
    sc.fightMax = std::max(sc.fightMax, sc.fightMin + 0.5);
    set("engage_min", sc.engageMin);
    set("engage_max", sc.engageMax);
    sc.engageMax = std::max(sc.engageMax, sc.engageMin);
    set("cc_min", sc.ccMin);
    set("cc_max", sc.ccMax);
    sc.ccMax = std::max(sc.ccMax, sc.ccMin);
    set("start_distance", sc.startDistance);
    set("enemy_spread", sc.enemySpread);
    set("r_ready_chance", sc.rReadyChance);
    set("retarget_delay", sc.retargetDelay);
    if (auto it = fight.find("enemy_damage_scale"); it != fight.end()) sc.damageTakenFactor *= std::max(0.0, it->second);
    if (auto it = fight.find("cc_scale"); it != fight.end()) {
        const double k = std::max(0.0, it->second);
        sc.ccRatePerPoint *= k; sc.ccRateMin *= k; sc.ccRateMax *= k;
    }
    if (auto it = fight.find("fixed_target"); it != fight.end() && it->second > 0) {
        sc.fixedTarget = true;
        sc.enemies.clear();
        sc.teamDrivenDamage = false;
        // Unless set, the dummy has the average enemy's HP and resists at the enemies' level.
        const auto avg = averageEnemy(sc.enemyLevel);
        sc.targetHp = avg[0]; sc.targetArmor = avg[1]; sc.targetMr = avg[2];
        set("target_hp", sc.targetHp);
        set("target_armor", sc.targetArmor);
        set("target_mr", sc.targetMr);
    }
    // Enemies only hurt you while you're within their reach, but the simulation has no
    // teammates for them to hit instead, so how much damage you take overall still
    // follows real games (this champion's share of its team's damage taken). Where you
    // stand decides when it lands and from whom: the damage while in reach is scaled by
    // how much of the enemies' damage reaches this champion in a typical fight.
    // In fights that last until you die, the enemies simply hit you whenever you're in their
    // reach, so their damage isn't rescaled to a typical fight's total.
    const double share = c.hasCn ? c.cnTakenShare / 0.2 : 1.0;
    const double exposure = sc.untilDeath ? 1.0 / sc.deathDamageScale : meanExposure(*this, c, sc);
    sc.damageTakenFactor *= share / std::max(0.15, exposure);
    return sc;
}

void Library::validate(const Build& b) const {
    for (const auto& i : b.items)
        if (!items.count(i)) throw std::runtime_error("unknown item '" + i + "'");
    for (size_t i = 0; i < b.items.size(); ++i)
        for (size_t j = i + 1; j < b.items.size(); ++j)
            if (!items.at(b.items[i]).group.empty() && items.at(b.items[i]).group == items.at(b.items[j]).group)
                throw std::runtime_error(items.at(b.items[i]).name + " and " + items.at(b.items[j]).name +
                                         " can't be bought together");
    for (const auto& a : b.augments)
        if (!augments.count(a)) throw std::runtime_error("unknown augment '" + a + "'");
}

// ---------------------------------------------------------------------------
// One teamfight
// ---------------------------------------------------------------------------

namespace {

using mcrng::Rng;

struct Vec {
    double x = 0, y = 0;
};
inline Vec operator+(Vec a, Vec b) { return {a.x + b.x, a.y + b.y}; }
inline Vec operator-(Vec a, Vec b) { return {a.x - b.x, a.y - b.y}; }
inline Vec operator*(Vec a, double k) { return {a.x * k, a.y * k}; }
inline double dot(Vec a, Vec b) { return a.x * b.x + a.y * b.y; }
inline double cross(Vec a, Vec b) { return a.x * b.y - a.y * b.x; }
inline double len(Vec a) { return std::sqrt(dot(a, a)); }
inline Vec unit(Vec a, Vec fallback = {1, 0}) {
    const double l = len(a);
    return l > 1e-9 ? a * (1.0 / l) : fallback;
}

struct Enemy {
    double hp = 0, maxHp = 0;
    double physMult = 1, magicMult = 1, trueMult = 1;
    bool alive = true;
    double respawnAt = 0, burnUntil = -1, conduitAt = -1, heartsteelAt = 0;
    int uid = -1;
    // where it stands and how it moves
    const EnemyProfile* profile = nullptr;
    Vec pos, vel, home;
    double moveSpeed = 340, reach = 550, damageWeight = 0.2;
    double shrinkUntil = -1;  // Shrink Ray: its damage to you is reduced until then
    double strafe = 0, strafeUntil = 0, dodgeUntil = -1;
    Vec dodgeVel;
    // Your crowd control on it: can't act (stun, knockup...), can't move (root), slowed.
    double ccUntil = -1, rootUntil = -1, slowUntil = -1, slow = 0, silenceUntil = -1;
    int combo = 0; double comboUntil = -1;  // Combo Breaker stacks
    bool antiHeal = false;  // its build applies Grievous Wounds (Morellonomicon, Thornmail...)
    double armor = 0, amp = 1;  // its own Armor and damage-taken factor, for armor shred that builds up
    int cleaver = 0;            // Black Cleaver stacks on it (up to 5)
    std::vector<double> castReady;  // its own abilities: when each is next up
};

// One of an enemy's abilities as it's used on you.
struct EnemyCast {
    char slot = 0;
    std::string cc;            // hard crowd control it puts on you ("" for none)
    double ccDuration = 0, ccChance = 0;
    double range = 0, land = 1, cooldown = 10;
    double burst = 0;          // its hit, as seconds of the enemy's damage per second
};
struct EnemyKit {
    double abilityShare = 0;   // share of the enemy's damage its abilities deal (the rest is a steady stream)
    std::vector<EnemyCast> casts;
};

// An item or augment effect with its own cooldown or counter.
struct Proc {
    const Bag* fx = nullptr;
    double readyAt = 0;
    int counter = 0;
};

constexpr double kDanceTail = 4.0;  // seconds the replay keeps going after the fight-ending death

class Fight {
public:
    Fight(const Library& lib, const ChampionKit& ch, const Build& build, const Scenario& sc, uint64_t trial,
          FightTrace* trace = nullptr)
        : lib_(lib), ch_(ch), sc_(sc), rules_(lib.rules), rng_(sc.seed, trial), trace_(trace) {
        setupScenario();  // draw the fight first so every build sees the same fights
        setupBuild(build);
        setupDefences();
    }

    Result run();

private:
    const Library& lib_;
    const ChampionKit& ch_;
    const Scenario& sc_;
    const Rules& rules_;
    Rng rng_;
    Result res_;
    FightTrace* trace_ = nullptr;  // recording never draws random numbers, so traced fights match untraced ones
    int nextUid_ = 0;
    double lastSelfAt_ = -1;

    void record(TraceEvent e) {
        if (trace_) trace_->events.push_back(std::move(e));
    }
    void recordSelf(double t, const char* kind = "self") {
        if (!trace_ || (t - lastSelfAt_ < 0.1 && kind[0] == 's')) return;
        lastSelfAt_ = t;
        TraceEvent e;
        e.t = t; e.kind = kind; e.hp = myHp_; e.maxHp = maxHp_; e.shield = shieldLeft(t);
        e.taken = res_.damageTaken; e.mitigated = res_.mitigated;
        record(e);
    }
    void recordFocus() {
        if (!trace_ || !hasPrimary()) return;
        TraceEvent e;
        e.t = t_; e.kind = "focus"; e.target = P().uid;
        record(e);
    }

    // build
    Bag fx_;  // summed effects
    double ad_ = 0, bonusAd_ = 0, baseAd_ = 0, ap_ = 0, bonusAs_ = 0, crit_ = 0, critDamage_ = 0;
    double maxHp_ = 0, bonusHp_ = 0, armor_ = 0, bonusArmor_ = 0, mr_ = 0, bonusMr_ = 0, ah_ = 0;
    double lethality_ = 0, armorPen_ = 0, magicPen_ = 0, magicPenPct_ = 0, lifesteal_ = 0, omnivamp_ = 0;
    double damageAmp_ = 1, abilityAmp_ = 1;
    double attackSpeed_ = 0;
    const Bag* spellblade_ = nullptr;
    std::vector<Proc> abilityProcs_, attackProcs_, actives_;
    Proc missile_, kraken_, storm_, eclipse_;
    const Bag* poro_ = nullptr;  // Poro Stampede: the Poro Charge summoner spell
    // Augment mechanics (effect keys in README.md). Each item and augment's effects at the fight's
    // level ("x_l1"/"x_l18" pairs become "x"); a deque so pointers into it stay valid.
    std::deque<Bag> bags_;
    // Damage, heals, shields and crowd control set off by an event (trig_on, see TrigOn).
    struct Trig { const Bag* fx = nullptr; double readyAt = 0, taken = 0; int counter = 0; std::map<int, double> perTarget; };
    std::vector<Trig> trigs_;
    // Stacking buffs ("stack_" and "stack2_" keys): stats per stack, all lost when the stacks expire.
    struct Stack { const Bag* fx = nullptr; std::string p; int n = 0; double expire = -1, readyAt = 0, ap = 0, ad = 0, as = 0, ms = 0; };
    std::vector<Stack> stacks_;
    // Augments on one of your abilities (spell_bind): which ability it picked.
    struct Bound { const Bag* fx = nullptr; size_t idx = static_cast<size_t>(-1); std::string kind; };
    std::vector<Bound> bound_;
    double attackRange_ = 125;
    bool ranged_ = false, noUlt_ = false, ultOnlyHaste_ = false, hasDash_ = false, hasImmobilize_ = false;
    double tempAs_ = 0, msToAs_ = 0, asCap_ = 5, execute_ = 0, itemAmp_ = 1, itemCrit_ = 0, trueExtra_ = 0;
    double msDiffAmp_ = 0, hsp_ = 1, cdr_ = 0, incomingMult_ = 1, shrink_ = 0, rWindowAmp_ = 0, openAmp_ = 0, openFor_ = 0;
    double rInvulnReady_ = 0, rBuffReady_ = 0, rRefreshReady_ = 0, rAwakenReady_ = 0, rWindowReady_ = 0, rCcReady_ = 0;
    double rUnstopReady_ = 0, rReductionReady_ = 0, rVampUntil_ = -1, rBasicAhUntil_ = -1, rWindowUntil_ = -1;
    double reductionUntil_ = -1, firstHitAt_ = -1, lowHealReady_ = 0, nextInvuln_ = 1e18, reviveFrac_ = 0;
    Effect kitFx_;  // the champion's own stat and stacking passives
    std::map<const EnemyProfile*, EnemyKit> enemyKits_;
    double ccRate_ = 0;
    Rng abilityRng_{1, 3};
    // Mana or energy: what's left at manaT_ (it refills at manaRegen_ per second since).
    double maxMana_ = 0, mana_ = 0, manaT_ = 0, manaRegen_ = 0, costMult_ = 1;
    double manaAt(double t) const { return std::min(maxMana_, mana_ + manaRegen_ * std::max(0.0, t - manaT_)); }
    double costOf(const Ability& a) const { return ch_.resource ? a.cost * (ch_.resource == 1 ? costMult_ : 1.0) : 0.0; }
    bool affordable(const Ability& a, double t) const { return costOf(a) <= manaAt(t) + 1e-9; }
    void spend(double cost, double t) { mana_ = manaAt(t) - cost; manaT_ = t; }
    bool converting_ = false, snipeHit_ = false, augReviveUsed_ = false, augRevive_ = false;
    double poroReady_ = 0;
    bool hasMissile_ = false, hasKraken_ = false, hasStorm_ = false, hasEclipse_ = false;
    // Shields on you: what's left of each and when it ends. Lifeline items (Sterak's Gage, Maw)
    // shield you once a fight when you drop low; they share one trigger, the strongest wins.
    struct ShieldUp { double amount, until; };
    std::vector<ShieldUp> shields_;
    std::vector<const Bag*> lifelines_;
    bool lifelineUsed_ = false;
    double magicShare_ = 0.5;

    // fight
    double t_ = 0, duration_ = 0, nextAttack_ = 0, primaryRespawnAt_ = 0, spellbladeReady_ = 0;
    bool spellbladeArmed_ = false;
    double spellbladeArmedAt_ = 0;
    int attacks_ = 0;
    std::vector<double> readyAt_;
    std::vector<size_t> order_;
    std::vector<std::pair<double, double>> cc_;
    int myCombo_ = 0; double myComboUntil_ = -1;  // Combo Breaker on you
    std::vector<const EnemyProfile*> team_;
    double totalWeight_ = 0;
    // Everyone on the field. enemies_[primary_] is the current target (-1: none alive).
    std::vector<Enemy> enemies_;
    int primary_ = -1;
    Enemy& P() { return enemies_[static_cast<size_t>(primary_)]; }
    bool hasPrimary() const { return primary_ >= 0 && enemies_[static_cast<size_t>(primary_)].alive; }
    Vec me_;
    // Move speed after the game's soft caps: past 415 only 80% of the rest counts, past 490 only 50%.
    double effMs() const {
        double ms = moveSpeed_;
        if (ms > 490) ms = 415 + 0.8 * 75 + 0.5 * (ms - 490);
        else if (ms > 415) ms = 415 + 0.8 * (ms - 415);
        return ms;
    }
    double moveSpeed_ = 335, posClock_ = 0, nextPosAt_ = 0, busyUntil_ = 0, wantRange_ = 0;
    Rng moveRng_{1, 2};
    double exposureSum_ = 0, exposureTime_ = 0;
    static constexpr double kStep = 0.05;     // movement and damage-taken step, seconds
    static constexpr double kPosEvery = 0.2;  // replay position snapshots, seconds
    bool rUp_ = false;
    double throughResists_ = 1, burstRaw_ = 0;  // for damage mitigated: see setupDefences and enemyCasts
    double myHp_ = 0, incomingDps_ = 0, engageAt_ = 0, damageClock_ = 0, auraClock_ = 0, auraDps_ = 0;
    std::vector<std::pair<const Ability*, const Hit*>> auraHits_;
    std::vector<const Ability*> onhitAbilities_;
    bool dead_ = false;
    // Cheating death (ChampionKit::deathAct / reviveFrac): used once a fight.
    bool deathUsed_ = false;
    double invulnUntil_ = -1, dieAt_ = -1, reviveAt_ = -1;

    static double levelScale(int level) { return statGrowth(level); }

    void addBag(const Bag& src, Bag& dst) {
        for (const auto& [k, v] : src) {
            if (k == "armor_pen" || k == "magic_pen_pct") dst[k] = 1.0 - (1.0 - get(dst, k)) * (1.0 - v);
            else dst[k] += v;
        }
    }

    // Effect values at this fight's level: an "x_l1"/"x_l18" pair becomes "x" (straight line between).
    Bag atLevel(const Bag& b) const {
        Bag out;
        const double lv = (sc_.level - 1) / 17.0;
        for (const auto& [k, v] : b) {
            const size_t n = k.size();
            if (n > 3 && k.compare(n - 3, 3, "_l1") == 0) continue;
            if (n > 4 && k.compare(n - 4, 4, "_l18") == 0) {
                const std::string base = k.substr(0, n - 4);
                const double v1 = get(b, base + "_l1");
                out[base] += v1 + (v - v1) * lv;
            } else {
                out[k] += v;
            }
        }
        return out;
    }

    static bool immobilizes(const Ability& a) { return !a.cc.empty() && a.cc != "slow" && a.cc != "silence"; }

    // Adaptive Force: Ability Power, or 0.6 bonus AD each when the build has more AD than AP.
    void addAdaptive(double af, double* gotAp = nullptr, double* gotAd = nullptr) {
        if (ap_ >= bonusAd_) { ap_ += af; if (gotAp) *gotAp += af; }
        else { bonusAd_ += 0.6 * af; ad_ += 0.6 * af; if (gotAd) *gotAd += 0.6 * af; }
    }

    void updateAs() {
        attackSpeed_ = std::min(asCap_, (ch_.as + ch_.asRatio * (bonusAs_ + tempAs_ + msToAs_ * effMs())) *
                                            (1.0 + get(fx_, "total_as_mult") + ch_.mayhemAs));
    }

    void setupBuild(const Build& b) {
        Bag stats;
        std::vector<const Effect*> effects;
        for (const auto& id : b.items) effects.push_back(&lib_.items.at(id));
        for (const auto& id : b.augments) {
            const Effect& a = lib_.augments.at(id);
            // Item upgrades do nothing without their item.
            if (!a.needsItem.empty() && std::find(b.items.begin(), b.items.end(), a.needsItem) == b.items.end()) continue;
            effects.push_back(&a);
        }
        if (!ch_.kitStats.empty() || !ch_.kitEffects.empty()) {
            kitFx_.stats = ch_.kitStats;
            kitFx_.effects = ch_.kitEffects;
            effects.push_back(&kitFx_);
        }
        ranged_ = ch_.ranged;
        attackRange_ = ch_.attackRange;
        for (const auto& a : ch_.abilities) {
            hasDash_ |= a.geo.move != Move::None;
            hasImmobilize_ |= immobilizes(a);
        }
        double bestBlade = -1;
        for (const Effect* e : effects) {
            addBag(atLevel(e->stats), stats);
            bags_.push_back(atLevel(e->effects));
            const Bag& f = bags_.back();
            addBag(f, fx_);
            if (get(f, "spellblade_cd") > 0) {  // spellblades don't stack: keep the strongest
                const double power = get(f, "spellblade_base_ad") * 3 + get(f, "spellblade_ap") * 3;
                if (power > bestBlade) { bestBlade = power; spellblade_ = &f; }
            }
            if (get(f, "proc_cd") > 0) abilityProcs_.push_back({&f});
            if (get(f, "active_cd") > 0) actives_.push_back({&f});
            if (get(f, "missile_cd") > 0) { hasMissile_ = true; missile_.fx = &f; }
            if (get(f, "kraken_every") > 0) { hasKraken_ = true; kraken_.fx = &f; }
            if (get(f, "storm_every") > 0) { hasStorm_ = true; storm_.fx = &f; }
            if (get(f, "maxhp_proc_cd") > 0) { hasEclipse_ = true; eclipse_.fx = &f; }
            if (get(f, "lifeline_duration") > 0) lifelines_.push_back(&f);
            if (get(f, "poro_cd") > 0) poro_ = &f;
            if (get(f, "trig_on") > 0) {
                Trig tr;
                tr.fx = &f;
                tr.readyAt = get(f, "trig_first");
                trigs_.push_back(std::move(tr));
            }
            for (const char* p : {"stack_", "stack2_"})
                if (get(f, std::string(p) + "max") > 0) stacks_.push_back({&f, p});
            if (!e->bind.empty()) bound_.push_back({&f, static_cast<size_t>(-1), e->bind});
        }
        const double g = levelScale(sc_.level);
        baseAd_ = ch_.ad + ch_.adG * g;
        bonusAd_ = get(stats, "ad");
        ap_ = get(stats, "ap");
        // AP that grows with level (Witchful Thinking: ap_min at level 1 up to ap_max at 18).
        if (get(fx_, "ap_max") > 0) ap_ += get(fx_, "ap_min") + (get(fx_, "ap_max") - get(fx_, "ap_min")) * (sc_.level - 1) / 17.0;
        // Converting one damage stat into the other (escAPADe, ADAPt).
        if (get(fx_, "ap_to_ad") > 0) { bonusAd_ += ap_ * get(fx_, "ap_to_ad"); ap_ = 0; }
        if (get(fx_, "ad_to_ap") > 0) { ap_ += bonusAd_ * get(fx_, "ad_to_ap"); bonusAd_ = 0; }
        // Draw Your Sword: melee, with stats that grow with the range given up (most from 500 range up).
        double sword = 0;
        if (get(fx_, "sword_ad") > 0) {
            const double floor = get(fx_, "sword_floor", 500), ceil = get(fx_, "sword_ceiling", 650);
            sword = 1.0 + std::clamp((attackRange_ - floor) / std::max(1.0, ceil - floor), 0.0, 1.0);
            if (attackRange_ > get(fx_, "sword_range")) { attackRange_ = get(fx_, "sword_range"); ranged_ = false; }
        }
        if (get(fx_, "attack_range_set") > attackRange_ && sc_.level >= get(fx_, "attack_range_level")) {  // Kayle: ranged from level 6
            attackRange_ = get(fx_, "attack_range_set");
            ranged_ = true;
        }
        attackRange_ += ranged_ ? get(fx_, "range_ranged") : get(fx_, "range_melee");
        // Flat Adaptive Force (stat anvils, Slap Around's stacks when the kit can immobilize).
        addAdaptive(get(fx_, "adaptive_flat") + (hasImmobilize_ ? get(fx_, "cc_af") : 0.0));
        // Adaptive amplifiers boost whichever of AP or bonus AD the build has more of.
        const double adaptive = get(fx_, "adaptive_amp");
        if (ap_ >= bonusAd_) ap_ *= 1.0 + adaptive;
        else bonusAd_ *= 1.0 + adaptive;
        ap_ *= 1.0 + get(fx_, "ap_amp");
        crit_ = get(stats, "crit") + get(fx_, "crit_per_ap") * ap_;
        crit_ *= 1.0 + get(fx_, "crit_chance_mult");  // Yasuo, Yone: double crit chance
        if (crit_ > 1.0) {  // Mayhem: crit chance above 100% becomes Adaptive Force (AP or 0.6 AD each)
            addAdaptive((crit_ - 1.0) * 100.0 * rules_.critOverflowAf);
            crit_ = 1.0;
        }
        critDamage_ = get(stats, "crit_damage") + get(fx_, "crit_damage_per_crit") * crit_;
        // Jhin: bonus AD from level, crit chance and bonus attack speed (before the build's % AD).
        bonusAd_ += (get(fx_, "whisper_ad_pct") + get(fx_, "whisper_crit") * crit_ * 100.0 +
                     get(fx_, "whisper_as") * 100.0 * (ch_.asG * g + get(stats, "as"))) * (baseAd_ + bonusAd_);
        ad_ = baseAd_ + bonusAd_;
        bonusAd_ += (get(fx_, "ad_pct") + sword * get(fx_, "sword_ad")) * ad_;  // "% Attack Damage" (Blunt Force)
        ad_ = baseAd_ + bonusAd_;
        bonusAs_ = ch_.asG * g + get(stats, "as") + get(fx_, "as_per_ap") * ap_ + sword * get(fx_, "sword_as") +
                   (sc_.onFire ? rules_.fireAs : 0.0);
        double ahFromAs = 0;
        if (get(fx_, "as_to_ah") > 0) {  // Purist - Caster: all bonus attack speed becomes ability haste
            ahFromAs = get(fx_, "as_to_ah") * 100.0 * bonusAs_;
            bonusAs_ = 0;
        }
        msToAs_ = get(fx_, "ms_to_as");
        asCap_ = std::max(rules_.asCap, get(fx_, "as_cap"));
        if (get(fx_, "as_fixed") > 0) asCap_ = get(fx_, "as_fixed");  // Jhin: attack speed never changes
        // Mana (energy pools don't grow). Mind to Matter turns some of it into Health.
        if (ch_.resource == 1) {
            maxMana_ = ch_.mana + ch_.manaG * g + get(stats, "mana");
            manaRegen_ = (ch_.manaRegen + ch_.manaRegenG * g) * (1.0 + get(stats, "mana_regen"));
        } else if (ch_.resource == 2) {
            maxMana_ = ch_.mana;
            manaRegen_ = ch_.manaRegen;
        }
        mana_ = maxMana_;
        manaT_ = 0;
        costMult_ = 1.0 + get(fx_, "cost_mult");
        bonusHp_ = get(stats, "hp") + (hasImmobilize_ ? get(fx_, "cc_hp") : 0.0) +
                   (ch_.resource == 1 ? get(fx_, "mana_to_hp") * maxMana_ : 0.0);
        const double baseHp = ch_.hp + ch_.hpG * g + rules_.mayhemHp(sc_.level, ch_.ranged);  // Mayhem bonus base health
        maxHp_ = (baseHp + bonusHp_) * (1.0 + get(fx_, "hp_pct") + sword * get(fx_, "sword_hp")) * (1.0 + get(fx_, "hp_mult"));
        bonusHp_ = maxHp_ - baseHp;
        // Health-to-AD items (Overlord's Bloodmail) and base-AD bonuses (Sterak's Gage).
        bonusAd_ += get(fx_, "ad_per_bonus_hp") * bonusHp_ + get(fx_, "base_ad_pct") * baseAd_;
        ad_ = baseAd_ + bonusAd_;
        bonusArmor_ = get(stats, "armor") + (hasDash_ ? get(fx_, "dash_armor") : 0.0) + rules_.mayhemResist(ch_.ranged);
        armor_ = ch_.armor + ch_.armorG * g + bonusArmor_;
        bonusMr_ = get(stats, "mr") + (hasDash_ ? get(fx_, "dash_mr") : 0.0) + rules_.mayhemResist(ch_.ranged);
        mr_ = ch_.mr + ch_.mrG * g + bonusMr_;
        ah_ = get(stats, "ah") + ch_.mayhemAh + get(fx_, "ah_per_ap") * ap_ + get(fx_, "ah_per_crit") * crit_ + ahFromAs;
        lethality_ = get(stats, "lethality");
        armorPen_ = get(stats, "armor_pen");
        magicPen_ = get(stats, "magic_pen");
        magicPenPct_ = get(stats, "magic_pen_pct");
        lifesteal_ = get(stats, "lifesteal") + sword * get(fx_, "sword_lifesteal");
        omnivamp_ = get(stats, "omnivamp") + get(fx_, "omnivamp_per_ap") * ap_;
        // Overflow: double mana costs for more effective damage, heals and shields (more with more mana).
        const double overflow = ch_.resource == 1 && get(fx_, "overflow_amp") > 0
                                    ? get(fx_, "overflow_amp") + get(fx_, "overflow_amp_per_mana") * maxMana_ : 0.0;
        damageAmp_ = (1.0 + get(fx_, "damage_amp")) * (1.0 + overflow) * ch_.damageDealt;
        abilityAmp_ = 1.0 + get(fx_, "ability_amp");
        myHp_ = maxHp_;
        moveSpeed_ = (ch_.moveSpeed + get(fx_, "ms") + get(fx_, "ms_per_ah") * ah_) * (sc_.onFire ? 1.0 + rules_.fireMs : 1.0);
        for (const auto& id : b.items)
            if (lib_.items.at(id).slot == "boots") moveSpeed_ += 45;  // every tier-2 boot gives +45 move speed
        moveSpeed_ *= 1.0 + get(fx_, "ms_pct") + sword * get(fx_, "sword_ms");
        updateAs();
        execute_ = get(fx_, "execute");
        if (get(fx_, "exec_flat") > 0)  // Dropkick: a threshold that grows with bonus Health and base AD
            execute_ = std::max(execute_, get(fx_, "exec_flat") + get(fx_, "exec_bonus_hp") * bonusHp_ + get(fx_, "exec_base_ad") * baseAd_);
        itemAmp_ = 1.0 + get(fx_, "item_damage_amp");
        itemCrit_ = get(fx_, "item_crit_damage");
        trueExtra_ = ranged_ && get(fx_, "true_extra_ranged") > 0 ? get(fx_, "true_extra_ranged") : get(fx_, "true_extra");
        msDiffAmp_ = get(fx_, "ms_diff_amp");
        hsp_ = 1.0 + get(fx_, "heal_shield_power") + get(fx_, "hsp_per_resist") * (bonusArmor_ + bonusMr_) +
               get(fx_, "heal_shield_crit") * crit_ + overflow;
        cdr_ = get(fx_, "cdr");
        incomingMult_ = 1.0 - get(fx_, "crit_defend") * std::min(crit_, get(fx_, "crit_defend_cap", 1.0));
        if (sc_.onFire) incomingMult_ *= ranged_ ? rules_.fireTakenRanged : rules_.fireTakenMelee;
        shrink_ = get(fx_, "shrink");
        rWindowAmp_ = get(fx_, "r_window_amp");
        openAmp_ = get(fx_, "open_amp");
        openFor_ = get(fx_, "open_duration");
        noUlt_ = get(fx_, "no_ult") > 0;
        ultOnlyHaste_ = get(fx_, "ult_only_haste") > 0;
        if (get(fx_, "invuln_every") > 0) nextInvuln_ = get(fx_, "invuln_first");

        // Ability order: the champion's recommended combo when it has one (and the
        // combo_order setting is on), otherwise R when it's up, then the rest by damage per cast.
        readyAt_.assign(ch_.abilities.size(), 0.0);
        passiveState_.assign(ch_.passives.size(), PassiveState{});
        std::vector<std::pair<double, size_t>> byDamage;
        for (size_t i = 0; i < ch_.abilities.size(); ++i) {
            const Ability& a = ch_.abilities[i];
            if (a.aura) {
                for (const auto& h : a.hits) auraHits_.push_back({&a, &h});
                continue;
            }
            if (a.onhitEvery > 0) {
                onhitAbilities_.push_back(&a);
                continue;
            }
            double raw = 0;
            for (const auto& h : a.hits) raw += h.weight * scaled(h.scaling) * (h.target == HitTarget::Flat ? 1 : 3000);
            byDamage.push_back({(a.slot == 'R' ? 1e12 : 0) + raw, i});
            if (a.slot == 'R' && (!rUp_ || noUlt_)) readyAt_[i] = 1e18;
        }
        for (auto& bd : bound_) bd.idx = bindAbility(bd.kind);
        if (rules_.comboOrder > 0.5 && !ch_.combo.empty())
            for (auto& [d, i] : byDamage) {
                const auto pos = ch_.combo.find(ch_.abilities[i].slot);
                d = (pos == std::string::npos ? 0 : 1e15 * static_cast<double>(4 - pos)) + d * 1e-15;
            }
        std::sort(byDamage.rbegin(), byDamage.rend());
        for (const auto& [d, i] : byDamage) order_.push_back(i);
    }

    // The ability an augment on "one of your abilities" goes on: the strongest basic ability of the
    // kind it needs (any damaging one, an area, a missile, crowd control, a self-buff). None: no effect.
    size_t bindAbility(const std::string& kind) const {
        size_t best = static_cast<size_t>(-1);
        double bestV = -1;
        for (size_t i = 0; i < ch_.abilities.size(); ++i) {
            const Ability& a = ch_.abilities[i];
            if (a.slot == 'R' || a.aura || a.onhitEvery > 0) continue;
            const Geometry& g = a.geo;
            const bool ok = kind == "any"       ? !a.hits.empty()
                            : kind == "aoe"     ? !a.hits.empty() && (g.shape == Shape::Circle || g.shape == Shape::Cone)
                            : kind == "missile" ? !a.hits.empty() && !g.selfBuff && (g.shape == Shape::Line || g.speed > 0)
                            : kind == "cc"      ? immobilizes(a)
                            : kind == "buff"    ? g.selfBuff
                            : kind == "dash"    ? g.move != Move::None
                                                : false;
            if (!ok) continue;
            double raw = 0;
            for (const auto& h : a.hits) raw += h.weight * scaled(h.scaling) * (h.target == HitTarget::Flat ? 1 : 3000);
            const double v = 1.0 + raw / std::max(1.0, a.cooldown);
            if (v > bestV) { bestV = v; best = i; }
        }
        return best;
    }

    double scaled(const Bag& s) const {
        double v = 0;
        for (const auto& [k, c] : s) {
            if (k == "const") v += c;
            else if (k == "ap") v += c * ap_;
            else if (k == "bonus_ad") v += c * bonusAd_;
            else if (k == "bonus_hp") v += c * bonusHp_;
            else if (k == "bonus_armor") v += c * bonusArmor_;
            else if (k == "bonus_mr") v += c * bonusMr_;
            else if (k == "as") v += c * bonusAs_;
            else if (k == "crit") v += c * crit_;
            else if (k == "lethality") v += c * lethality_;
        }
        return v;
    }

    void drawTeam() {
        const auto& pool = sc_.enemies;
        const size_t size = static_cast<size_t>(std::max(1, sc_.teamSize));
        const bool distinct = pool.size() >= size;
        std::vector<bool> taken(pool.size(), false);
        double remaining = totalWeight_;
        for (size_t k = 0; k < size; ++k) {
            double r = rng_.uniform() * remaining;
            size_t pick = pool.size();
            for (size_t i = 0; i < pool.size(); ++i) {
                if (taken[i]) continue;
                if (r < pool[i].weight) { pick = i; break; }
                r -= pool[i].weight;
            }
            if (pick == pool.size())
                for (size_t i = pool.size(); i-- > 0;)
                    if (!taken[i]) { pick = i; break; }
            team_.push_back(&pool[pick]);
            if (distinct) { taken[pick] = true; remaining -= pool[pick].weight; }
        }
    }

    // Draws everything about the fight that doesn't depend on the build.
    void setupScenario() {
        duration_ = sc_.untilDeath ? sc_.fightCap
                                   : std::clamp(rng_.normal(sc_.fightMean, sc_.fightSd), sc_.fightMin, sc_.fightMax);
        for (const auto& e : sc_.enemies) totalWeight_ += e.weight;
        if (!sc_.fixedTarget) drawTeam();
        double ccRate = rng_.uniform(sc_.ccRateMin, sc_.ccRateMax);
        if (sc_.ccRatePerPoint > 0 && !team_.empty()) {
            double points = 0;
            for (const auto* e : team_) points += e->cc;
            ccRate = sc_.ccRatePerPoint * points;
        }
        ccRate_ = ccRate;
        if (ccRate > 0)
            for (double t = rng_.exponential(ccRate); t < duration_; t += rng_.exponential(ccRate))
                cc_.push_back({t, t + rng_.uniform(sc_.ccMin, sc_.ccMax)});
        rUp_ = rng_.chance(sc_.rReadyChance);
        engageAt_ = rng_.uniform(sc_.engageMin, sc_.engageMax);
        incomingRoll_ = std::max(0.0, rng_.normal(sc_.enemyDpsMean, sc_.enemyDpsSd));
        targetSeed_ = rng_.next();
    }
    double incomingRoll_ = 0;
    uint64_t targetSeed_ = 0;

    // Tenacity from items (Mercury's Treads) and the champion's Mayhem balance stacks multiplicatively.
    double tenacity() const {
        return 1.0 - (1.0 - std::clamp(get(fx_, "tenacity"), 0.0, 1.0)) * (1.0 - ch_.mayhemTenacity);
    }
    void setupDefences() {
        // Tenacity shortens the crowd control drawn for the fight.
        if (const double ten = tenacity(); ten > 0)
            for (auto& [a, b] : cc_) b = a + (b - a) * (1.0 - ten);
        // Combo Breaker on you: each separate stun after the first in a few seconds is shorter.
        std::sort(cc_.begin(), cc_.end());
        double chainEnd = -1, comboUntil = -1;
        int stacks = 0;
        for (auto& [a, b] : cc_) {
            if (a >= comboUntil) stacks = 0;
            b = a + (b - a) * std::pow(1.0 - rules_.comboTenacity, stacks);
            if (a >= chainEnd) { ++stacks; comboUntil = a + rules_.comboDuration; }
            chainEnd = std::max(chainEnd, b);
        }
        myCombo_ = stacks; myComboUntil_ = comboUntil;
        // Enemy spawns and movement use their own streams so builds that kill faster
        // don't shift the rest of the fight's random draws.
        ccLeft_ = std::clamp(1.0 - std::max<size_t>(1, team_.size()) / 5.0, 0.0, 1.0);
        targetRng_ = Rng(targetSeed_, 1);
        moveRng_ = Rng(targetSeed_, 2);
        abilityRng_ = Rng(targetSeed_, 3);
        double teamDamage = 1.0, share = 0;
        if (sc_.teamDrivenDamage && !team_.empty()) {
            for (const auto* e : team_) share += e->damageShare;
            teamDamage = share / (0.2 * static_cast<double>(team_.size()));
        }
        // Each enemy's damage after your Armor and MR (less its penetration), scaled by how hard
        // its build hits at this level.
        auto through = [&](const EnemyProfile* p) {
            if (!p) {
                const double ps = sc_.enemyPhysShare;
                return ps * 100.0 / (100.0 + armor_) + (1.0 - ps) * 100.0 / (100.0 + mr_);
            }
            const double armor = std::max(0.0, armor_ * (1.0 - p->armorPen) - p->lethality);
            const double mr = std::max(0.0, mr_ * (1.0 - p->magicPenPct) - p->magicPen);
            return (p->physShare * 100.0 / (100.0 + armor) + (1.0 - p->physShare) * 100.0 / (100.0 + mr)) * p->power;
        };
        double mitigation = 0;
        if (sc_.teamDrivenDamage && !team_.empty() && share > 0)
            for (const auto* e : team_) mitigation += e->damageShare / share * through(e);
        else if (!team_.empty())
            for (const auto* e : team_) mitigation += through(e) / static_cast<double>(team_.size());
        else
            mitigation = through(nullptr);
        incomingDps_ = incomingRoll_ * sc_.damageTakenFactor * teamDamage * mitigation * rules_.inRangeBoost * incomingMult_;
        // The share of enemy damage your Armor and Magic Resist let through, for damage mitigated.
        double unresisted = 0;
        auto power = [](const EnemyProfile* p) { return p ? p->power : 1.0; };
        if (sc_.teamDrivenDamage && !team_.empty() && share > 0)
            for (const auto* e : team_) unresisted += e->damageShare / share * power(e);
        else if (!team_.empty())
            for (const auto* e : team_) unresisted += power(e) / static_cast<double>(team_.size());
        else
            unresisted = 1.0;
        throughResists_ = unresisted > 0 ? std::clamp(mitigation / unresisted, 1e-6, 1.0) : 1.0;
        setupEnemyKits();
        magicShare_ = 1.0 - sc_.enemyPhysShare;
        if (!team_.empty()) {
            double phys = 0, w = 0;
            for (const auto* e : team_) { phys += e->damageShare * e->physShare; w += e->damageShare; }
            if (w > 0) magicShare_ = 1.0 - phys / w;
        }
        // Always-on damage (Sunfire-style auras and damage toggles).
        auraDps_ = get(fx_, "aura_flat") + get(fx_, "aura_bonus_hp") * bonusHp_;

        // The field: you at the origin, the enemy team further up the lane, its
        // short-range champions in front.
        me_ = {0, 0};
        const size_t n = static_cast<size_t>(std::max(1, sc_.teamSize));
        enemies_.resize(n);
        for (size_t i = 0; i < n; ++i) {
            const EnemyProfile* p = sc_.fixedTarget || team_.empty() ? nullptr : team_[i % team_.size()];
            Enemy& e = enemies_[i];
            e = spawnEnemy(p);
            const double reach = p ? p->reach : 550.0;
            e.home = {sc_.startDistance + 0.5 * (std::min(reach, 650.0) - 400.0) + moveRng_.normal(0, 0.6 * sc_.enemySpread),
                      std::clamp(moveRng_.normal(0, sc_.enemySpread), -rules_.laneHalfWidth, rules_.laneHalfWidth)};
            e.pos = e.home;
            const double w = p && share > 0 ? p->damageShare / share : 1.0 / static_cast<double>(n);
            e.damageWeight = p && mitigation > 0 ? w * through(p) / mitigation : w;
        }
        primary_ = nearestAlive(me_);
    }
    Rng targetRng_{1, 1};

    // Each enemy's abilities as it uses them on you: which hard crowd control, how far they reach,
    // how often they land and come back, and how much of its damage each hit carries.
    void setupEnemyKits() {
        if (rules_.enemyAbilities <= 0) return;
        double kitCcRate = 0;
        for (const auto* p : team_) {
            const ChampionKit* k = lib_.find(p->id);
            if (!k || enemyKits_.count(p)) continue;
            EnemyKit kit;
            kit.abilityShare = k->role == "marksman" ? rules_.enemyAbilityShareMarksman : rules_.enemyAbilityShare;
            const double haste = k->mayhemAh + rules_.enemyAbilityHaste;
            double weights = 0;
            for (const auto& a : k->abilities) {
                const bool hard = !a.cc.empty() && a.cc != "slow" && a.cc != "silence" && a.cc != "root";
                if (a.hits.empty() && !hard) continue;
                EnemyCast c;
                c.slot = a.slot;
                c.cooldown = std::max(rules_.minCooldown, a.cooldown * 100.0 / (100.0 + haste));
                c.range = a.geo.onSelf ? std::max(a.geo.radius, k->attackRange)
                                       : std::max({a.geo.range, a.geo.radius, k->attackRange});
                c.land = a.geo.onSelf || a.geo.shape == Shape::Single ? 1.0 : rules_.enemyHitChance;
                if (hard) { c.cc = a.cc; c.ccDuration = a.ccDuration; kitCcRate += c.land / c.cooldown; }
                if (!a.hits.empty()) {
                    c.burst = a.slot == 'R' ? 2.5 : 1.0;  // a weight for now: how big a hit it is
                    weights += c.burst / c.cooldown;
                }
                kit.casts.push_back(c);
            }
            // Each hit's size follows its weight; together, cast on cooldown and landing as often as
            // they should, they deliver the abilities' share of the enemy's damage on average.
            for (auto& c : kit.casts)
                if (c.burst > 0) c.burst = kit.abilityShare * c.burst / weights / c.land;
            if (weights <= 0) kit.abilityShare = 0;
            enemyKits_[p] = std::move(kit);
        }
        // Crowd control keeps real games' rate: each of their own lands with the chance that keeps it,
        // and teammates' (the random crowd control drawn for the fight) fill whatever is left.
        if (kitCcRate > 0 && ccRate_ > 0) {
            const double chance = std::min(1.0, ccRate_ / kitCcRate);
            for (auto& [p, kit] : enemyKits_)
                for (auto& c : kit.casts) c.ccChance = c.cc.empty() ? 0.0 : chance;
            const double keep = std::max(0.0, 1.0 - kitCcRate / ccRate_);
            cc_.erase(std::remove_if(cc_.begin(), cc_.end(), [&](const auto&) { return !abilityRng_.chance(keep); }),
                      cc_.end());
        }
    }

    // How much of the enemies' attention is on you: in a team fight their first spells and attacks
    // are split with your teammates, so their damage on you builds up over focus_ramp seconds.
    double focus(double now) const {
        return rules_.focusRamp > 0 ? std::min(1.0, std::max(0.0, now - engageAt_) / rules_.focusRamp) : 1.0;
    }

    // Enemies cast whatever is up and in range; returns the damage their hits deal you this step.
    double enemyCasts(double now) {
        if (enemyKits_.empty() || now <= engageAt_) return 0;
        double total = 0;
        for (auto& e : enemies_) {
            if (!e.alive) continue;
            const auto it = enemyKits_.find(e.profile);
            if (it == enemyKits_.end()) continue;
            const auto& casts = it->second.casts;
            if (e.castReady.size() != casts.size()) {  // first sight of you: abilities come up staggered
                e.castReady.clear();
                for (const auto& c : casts) e.castReady.push_back(now + abilityRng_.uniform(0, 0.5 * c.cooldown));
                continue;
            }
            for (size_t j = 0; j < casts.size(); ++j) {
                const EnemyCast& c = casts[j];
                if (now < e.castReady[j] || distTo(e) > c.range + 2 * rules_.hitbox) continue;
                e.castReady[j] = now + c.cooldown;
                // Your crowd control on it stops only its share of a team's casts.
                const double acting = now < e.ccUntil ? ccLeft_ : 1.0;
                if (!abilityRng_.chance(c.land)) continue;
                double dmg = incomingDps_ * e.damageWeight * c.burst * acting * (now < e.shrinkUntil ? 1.0 - shrink_ : 1.0) * focus(now);
                if (c.slot != 'R') dmg *= rules_.longRange(distTo(e));  // ARAM long-range cut
                burstRaw_ += dmg / throughResists_;
                if (now < reductionUntil_) dmg *= 1.0 - get(fx_, "r_reduction");
                total += dmg;
                if (!c.cc.empty() && abilityRng_.chance(c.ccChance * acting)) {
                    // Tenacity shortens it, except knock-ups.
                    const double ten = c.cc == "knockup" ? 0.0 : tenacity();
                    double inChain = -1;
                    for (const auto& [a, b] : cc_) if (a <= now) inChain = std::max(inChain, b);
                    const double keep = t_;
                    t_ = now;
                    const double dur = comboBreaker(myCombo_, myComboUntil_, now < inChain, c.ccDuration * (1.0 - ten), c.cc == "knockup");
                    t_ = keep;
                    cc_.push_back({now, now + dur});
                    if (trace_ && e.profile) {
                        TraceEvent ev;
                        ev.t = now; ev.kind = "cc"; ev.amount = cc_.back().second;
                        ev.who = e.profile->id; ev.slot = c.slot; ev.text = c.cc;
                        record(ev);
                    }
                }
            }
        }
        return total;
    }

    // Physical damage taken per point: its Armor after shred and your penetration. Black Cleaver's
    // shred builds up with each physical hit (5 stacks).
    double physMultOf(const Enemy& e) const {
        const double cleaver = get(fx_, "cleaver_shred") * std::min(e.cleaver, 5) / 5.0;
        const double armor = std::max(0.0, e.armor * (1.0 - get(fx_, "armor_shred")) * (1.0 - cleaver) * (1.0 - armorPen_) - lethality_);
        return 100.0 / (100.0 + armor) * e.amp;
    }

    Enemy spawnEnemy(const EnemyProfile* prof) {
        EnemyProfile p;
        if (prof) p = *prof;
        else { p.hp = sc_.targetHp; p.armor = sc_.targetArmor; p.mr = sc_.targetMr; p.moveSpeed = 0; p.reach = 550; }
        Enemy e;
        e.profile = prof;
        e.uid = nextUid_++;
        e.maxHp = p.hpSd > 0 ? std::max(0.5 * p.hp, targetRng_.normal(p.hp, p.hp * p.hpSd)) : p.hp;
        e.hp = e.maxHp;
        const double mr = std::max(0.0, p.mr * (1.0 - get(fx_, "mr_shred")) * (1.0 - magicPenPct_) - magicPen_);
        const double amp = damageAmp_ * p.damageTaken;
        e.armor = p.armor; e.amp = amp;
        e.physMult = physMultOf(e);
        e.magicMult = 100.0 / (100.0 + mr) * amp;
        e.trueMult = amp;
        e.moveSpeed = p.moveSpeed;
        e.reach = p.reach;
        for (const auto& it : p.items)
            if (const auto f = lib_.items.find(it); f != lib_.items.end() && get(f->second.effects, "grievous") > 0) e.antiHeal = true;
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "spawn"; ev.target = e.uid; ev.text = p.id; ev.hp = e.hp; ev.maxHp = e.maxHp;
            ev.amount = e.reach;  // how far its damage reaches, for the replay
            record(ev);
        }
        return e;
    }

    // Share of an enemy's damage that comes as a steady stream while you're in its reach.
    double streamShare(const Enemy& e) const {
        const auto it = enemyKits_.find(e.profile);
        return it == enemyKits_.end() ? 1.0 : 1.0 - it->second.abilityShare;
    }

    bool inCc(double t) const {
        for (const auto& [a, b] : cc_)
            if (t >= a && t < b) return true;
        return false;
    }

    double freeTime(double t) const {
        bool moved = true;
        while (moved) {
            moved = false;
            for (const auto& [a, b] : cc_)
                if (t >= a && t < b) { t = b; moved = true; }
        }
        return t;
    }

    int nearestAlive(Vec from) const {
        int best = -1;
        double bd = 1e18;
        for (size_t i = 0; i < enemies_.size(); ++i) {
            if (!enemies_[i].alive) continue;
            const double d = len(enemies_[i].pos - from);
            if (d < bd) { bd = d; best = static_cast<int>(i); }
        }
        return best;
    }

    // Centre-to-centre distance at which two champions touch or an attack connects.
    double attackReach() const { return attackRange_ + 2 * rules_.hitbox; }
    double distTo(const Enemy& e) const { return len(e.pos - me_); }

    // How close you need to be to the target to use ability a on it.
    double needRange(const Ability& a) const {
        const Geometry& g = a.geo;
        if (g.selfBuff || g.shape == Shape::Single) return (g.selfBuff ? attackRange_ : g.range) + 2 * rules_.hitbox;
        if (g.shape == Shape::Circle) return (g.onSelf ? g.radius : g.range + 0.6 * g.radius) + rules_.hitbox;
        if (g.move != Move::None) return g.range + rules_.hitbox;
        return g.range * 0.8 + rules_.hitbox;  // skillshots: thrown from a bit inside their range
    }

    // Moves everyone and applies the enemies' damage up to time t, in small steps.
    // Returns true if you died.
    bool advance(double t) {
        if (dead_) return true;
        t = std::min(t, duration_);
        while (posClock_ < t - 1e-9) {
            const double dt = std::min(kStep, t - posClock_);
            const double now = posClock_ + dt;
            for (auto& e : enemies_)
                if (!e.alive && now >= e.respawnAt) respawn(e, now);
            if (dieAt_ >= 0 && now >= dieAt_) {  // the borrowed time is up
                dieAt_ = -1;
                posClock_ = now;
                die(now);
                return true;
            }
            if (reviveAt_ >= 0 && now >= reviveAt_) {
                reviveAt_ = -1;
                myHp_ = reviveFrac_ * maxHp_;
                recordSelf(now, "revive");
                if (augRevive_) {  // Hellbent: back with Adaptive Force and Omnivamp
                    augRevive_ = false;
                    addAdaptive(get(fx_, "revive_af"));
                    omnivamp_ += get(fx_, "revive_vamp");
                }
            }
            moveEnemies(now, dt);
            if (!inCc(posClock_) && posClock_ >= busyUntil_) moveMe(dt);
            tickAuras(now);
            // Damage taken: each enemy hits you only while you're within its reach.
            double dps = 0, rawTick = 0;  // rawTick: this tick's damage before your resists and reductions
            if (now > engageAt_) {
                double share = 0;
                for (const auto& e : enemies_)
                    if (e.alive && distTo(e) <= e.reach + 2 * rules_.hitbox)
                        // Fewer enemies than a real team each stand in for several champions; your
                        // crowd control stops just one of them (all of it in a five-enemy fight).
                        share += e.damageWeight * (now < e.ccUntil ? ccLeft_ : 1.0) * (now < e.shrinkUntil ? 1.0 - shrink_ : 1.0) *
                                 streamShare(e);
                dps = incomingDps_ * share * focus(now);
                rawTick = dps * dt / throughResists_;
                if (now < reductionUntil_) dps *= 1.0 - get(fx_, "r_reduction");
                exposureSum_ += share * dt;
                exposureTime_ += dt;
            }
            posClock_ = now;
            if (now >= nextInvuln_) {  // Divine Intervention: a star lands every so often
                invulnUntil_ = std::max(invulnUntil_, now + get(fx_, "invuln_duration"));
                nextInvuln_ += get(fx_, "invuln_every");
            }
            burstRaw_ = 0;
            double burst = enemyCasts(now);
            rawTick += burstRaw_;
            if (now < invulnUntil_) dps = burst = 0;
            if (dps <= 0 && burst <= 0) res_.mitigated += rawTick;  // invulnerable
            if (dps > 0 || burst > 0) {
                const double lost = absorb(dps * dt + burst, now);
                // Everything the enemies threw at you that didn't come off your Health.
                res_.mitigated += std::max(0.0, rawTick - std::min(lost, myHp_));
                if (lost >= myHp_) {
                    const double at = burst > 0 ? now : now - dt + myHp_ / dps;
                    res_.damageTaken += myHp_;
                    myHp_ = 0;
                    if (cheatDeath(at)) continue;
                    die(at);
                    return true;
                }
                myHp_ -= lost;
                res_.damageTaken += lost;
                lifeline(now);
                afterDamageTaken(now, dps * dt + burst);
                recordSelf(now);
            }
            recordPositions(now, false);
        }
        return false;
    }

    void respawn(Enemy& e, double now) {
        const double saved = t_;
        t_ = now;
        e = spawnEnemy(e.profile);
        t_ = saved;
        // The next enemy steps in from just beyond its reach (the rest of its team is already
        // in the fight, not back at the start line).
        e.home = {me_.x + std::min(sc_.startDistance, std::max(e.reach, 550.0) + 250.0), std::clamp(moveRng_.normal(0, sc_.enemySpread), -rules_.laneHalfWidth,
                                                         rules_.laneHalfWidth)};
        e.pos = e.home;
        if (primary_ < 0 || !enemies_[static_cast<size_t>(primary_)].alive) {
            primary_ = nearestAlive(me_);
            recordFocus();
        }
    }

    void clampLane(Vec& p) const { p.y = std::clamp(p.y, -rules_.laneHalfWidth, rules_.laneHalfWidth); }

    void moveEnemies(double now, double dt) {
        for (auto& e : enemies_) {
            if (!e.alive || e.moveSpeed <= 0) continue;
            if (now < e.ccUntil || now < e.rootUntil) { e.vel = {0, 0}; continue; }
            const Vec toMe = me_ - e.pos;
            const Vec dir = unit(toMe, {-1, 0});
            const Vec side{-dir.y, dir.x};
            if (now >= e.strafeUntil) {  // a new sidestep every so often
                e.strafe = moveRng_.uniform(-0.6, 0.6);
                e.strafeUntil = now + moveRng_.uniform(0.4, 1.2);
            }
            Vec v{0, 0};
            if (now < e.dodgeUntil) {
                v = e.dodgeVel;
            } else {
                const double d = len(toMe);
                const double want = std::max(e.reach * 0.85, 2 * rules_.hitbox);
                if (now < engageAt_) v = (e.home - e.pos) * 2.0;  // hold position until the fight starts
                else if (d > want + 25) v = dir * e.moveSpeed;
                else if (e.reach >= 300 && d < want - 200) v = dir * (-0.45 * e.moveSpeed);  // ranged: back off between attacks
                v = v + side * (e.strafe * e.moveSpeed);
                const double sp = len(v);
                if (sp > e.moveSpeed) v = v * (e.moveSpeed / sp);
            }
            if (now < e.slowUntil) v = v * (1.0 - e.slow);
            e.vel = v;
            e.pos = e.pos + v * dt;
            clampLane(e.pos);
        }
    }

    void moveMe(double dt) {
        if (!hasPrimary()) return;
        const Enemy& tgt = P();
        const Vec toT = tgt.pos - me_;
        const double d = len(toT);
        const double want = std::max(wantRange_ - 15, 2 * rules_.hitbox);
        Vec v{0, 0};
        if (d > want) {
            v = unit(toT) * effMs();
        } else if (attackRange_ >= 300) {
            // Ranged: step back from anyone short-ranged who is getting close, if the target stays in range.
            for (const auto& e : enemies_) {
                if (!e.alive || e.reach >= attackRange_) continue;
                const Vec away = me_ - e.pos;
                if (len(away) < e.reach + 2 * rules_.hitbox + 80 && d < attackReach() - 60) {
                    v = unit(away) * (0.8 * effMs());
                    break;
                }
            }
        }
        const double step = std::min(len(v) * dt, std::max(0.0, d - 2 * rules_.hitbox));
        me_ = me_ + unit(v, {0, 0}) * step;
        clampLane(me_);
        me_.x = std::max(me_.x, -1200.0);  // your own tower: no retreating past it
    }

    void recordPositions(double t, bool force) {
        if (!trace_ || (!force && t + 1e-9 < nextPosAt_)) return;
        nextPosAt_ = t + kPosEvery;
        TraceEvent ev;
        ev.t = t; ev.kind = "pos";
        ev.pos = {-1, me_.x, me_.y};
        for (const auto& e : enemies_)
            if (e.alive) { ev.pos.push_back(e.uid); ev.pos.push_back(e.pos.x); ev.pos.push_back(e.pos.y); }
        record(ev);
    }

    double shieldLeft(double now) const {
        double left = 0;
        for (const auto& sh : shields_)
            if (now < sh.until) left += sh.amount;
        return left;
    }
    // Damage reaching you: shields take it first, the one ending soonest first.
    double absorb(double dmg, double now) {
        if (shields_.empty()) return dmg;
        std::sort(shields_.begin(), shields_.end(), [](const ShieldUp& a, const ShieldUp& b) { return a.until < b.until; });
        for (auto& sh : shields_) {
            if (now >= sh.until || sh.amount <= 0) continue;
            const double take = std::min(sh.amount, dmg);
            sh.amount -= take;
            res_.shielded += take;
            dmg -= take;
            if (dmg <= 0) break;
        }
        shields_.erase(std::remove_if(shields_.begin(), shields_.end(),
                                      [&](const ShieldUp& sh) { return now >= sh.until || sh.amount <= 1e-9; }),
                       shields_.end());
        return dmg;
    }
    void addShield(double amount, double duration, char slot) {
        if (dead_ || amount <= 0 || duration <= 0) return;
        amount *= ch_.mayhemShielding;  // Mayhem balance
        shields_.push_back({amount, t_ + duration});
        stackEvent(OnShield);
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "shield"; ev.amount = amount; ev.slot = slot; ev.lock = duration;
            record(ev);
        }
        lastSelfAt_ = -1;
        recordSelf(t_);
    }
    void lifeline(double now) {
        if (lifelineUsed_ || lifelines_.empty()) return;
        double best = 0, dur = 0;
        for (const Bag* f : lifelines_) {
            if (myHp_ >= get(*f, "lifeline_threshold") * maxHp_) continue;
            double amt = get(*f, "lifeline_flat") + get(*f, "lifeline_bonus_hp") * bonusHp_ + get(*f, "lifeline_bonus_ad") * bonusAd_ +
                         get(*f, "lifeline_max_hp") * maxHp_;
            if (ranged_ && get(*f, "shield_ranged") > 0) amt *= get(*f, "shield_ranged");
            if (get(*f, "lifeline_magic") > 0) amt *= magicShare_;  // stops magic damage only
            if (amt > best) { best = amt; dur = get(*f, "lifeline_duration"); }
        }
        if (best <= 0) return;
        lifelineUsed_ = true;
        const double keep = t_;
        t_ = now;
        addShield(best, dur, 'I');
        t_ = keep;
    }

    void heal(double amount) {
        if (dead_ || amount <= 0) return;
        amount *= (1.0 + get(fx_, "healing_received")) * ch_.mayhemHealing;  // Spirit Visage, Mayhem balance
        if (sc_.onFire) amount *= 1.0 - rules_.fireHeal;
        // Grievous Wounds: an enemy whose build applies it and who can reach you cuts your healing by 40%.
        for (const auto& e : enemies_)
            if (e.alive && e.antiHeal && distTo(e) <= e.reach + 2 * rules_.hitbox) { amount *= 1.0 - rules_.grievous; break; }
        const double got = std::min(maxHp_, myHp_ + amount) - myHp_;
        myHp_ += got;
        res_.healed += got;
        // Circle of Death: healing also hurts the nearest enemy (not the healing that damage brings back).
        if (get(fx_, "heal_to_damage") > 0 && !converting_) {
            converting_ = true;
            const int n = nearestAlive(me_);
            if (n >= 0 && distTo(enemies_[static_cast<size_t>(n)]) <= 1000)
                deal(&enemies_[static_cast<size_t>(n)], amount * get(fx_, "heal_to_damage"), DamageType::Magic, SrcItems);
            converting_ = false;
        }
        if (trace_ && got > 0) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "heal"; ev.amount = got; ev.total = res_.healed;
            record(ev);
        }
    }

    // Your ability's crowd control on an enemy: stopped (stun, knockup, charm, fear...),
    // held in place (root), slowed, or silenced (shown only).
    // Combo Breaker: an immobilize that lands outside a chain shortens by the stacks it finds, then adds one.
    double comboBreaker(int& stacks, double& until, bool chained, double duration, bool knockup) const {
        if (t_ >= until) stacks = 0;
        if (!knockup) duration *= std::pow(1.0 - rules_.comboTenacity, stacks);
        if (!chained) { ++stacks; until = t_ + rules_.comboDuration; }
        return duration;
    }
    void applyCc(Enemy& e, const Ability& a) {
        double dur = a.ccDuration;
        if (immobilizes(a)) dur = comboBreaker(e.combo, e.comboUntil, t_ < std::max(e.ccUntil, e.rootUntil), dur, a.cc == "knockup");
        const double until = t_ + dur;
        double& held = a.cc == "slow" ? e.slowUntil : a.cc == "root" ? e.rootUntil : a.cc == "silence" ? e.silenceUntil : e.ccUntil;
        res_.ccDealt += std::max(0.0, until - std::max(t_, held));
        // Only the strongest slow counts while several overlap.
        if (a.cc == "slow") e.slow = t_ < held ? std::max(e.slow, a.ccSlow) : a.ccSlow;
        held = std::max(held, until);
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "ecc"; ev.target = e.uid; ev.text = a.cc; ev.amount = until; ev.total = res_.ccDealt;
            record(ev);
        }
    }
    // Crowd control from an item or augment: the enemy can't act for a while.
    void ccEnemy(Enemy& e, double duration, const char* kind) {
        if (!e.alive || duration <= 0) return;
        duration = comboBreaker(e.combo, e.comboUntil, t_ < std::max(e.ccUntil, e.rootUntil), duration, false);
        res_.ccDealt += std::max(0.0, t_ + duration - std::max(t_, e.ccUntil));
        e.ccUntil = std::max(e.ccUntil, t_ + duration);
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "ecc"; ev.target = e.uid; ev.text = kind; ev.amount = t_ + duration; ev.total = res_.ccDealt;
            record(ev);
        }
    }
    bool executeHit_ = false;
    double ccLeft_ = 0;  // share of a stopped enemy's damage that still lands (the champions it stands in for)

    void onKill(Enemy* target) {
        ++res_.kills;
        target->alive = false;
        target->respawnAt = t_ + sc_.retargetDelay;
        stackEvent(OnKill);
        // Spiritual Purification: a takedown blasts nearby enemies for a share of their current Health.
        if (get(fx_, "kill_blast_cur_hp") > 0)
            for (Enemy* o : near(target->pos, get(fx_, "kill_blast_radius", 500)))
                deal(o, get(fx_, "kill_blast_cur_hp") * o->hp, DamageType::Magic, SrcItems);
        if (hasPrimary()) return;
        primary_ = nearestAlive(me_);
        recordFocus();
    }

    // Other living enemies within radius of a point, nearest first.
    std::vector<Enemy*> near(Vec at, double radius, const Enemy* skip = nullptr) {
        std::vector<std::pair<double, Enemy*>> found;
        for (auto& e : enemies_) {
            if (!e.alive || &e == skip) continue;
            const double d = len(e.pos - at);
            if (d <= radius + rules_.hitbox) found.push_back({d, &e});
        }
        std::sort(found.begin(), found.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        std::vector<Enemy*> out;
        for (auto& f : found) out.push_back(f.second);
        return out;
    }

    double deal(Enemy* target, double raw, DamageType type, Source src, bool physicalAttack = false) {
        if (!target || !target->alive || raw <= 0) return 0.0;
        if (firstHitAt_ < 0) firstHitAt_ = t_;
        if (src == SrcItems) {
            raw *= itemAmp_;  // Forged By The Master
            if (itemCrit_ > 0) raw *= 1.0 + crit_ * (itemCrit_ - 1.0);  // Vulnerability: expected crits
        }
        if (msDiffAmp_ > 0)  // Don't Blink: more damage the faster you are than the target
            raw *= 1.0 + std::min(0.5, msDiffAmp_ * std::max(0.0, effMs() - (target->moveSpeed > 0 ? target->moveSpeed : 345.0)));
        if (t_ < rWindowUntil_) raw *= 1.0 + rWindowAmp_;
        if (openAmp_ > 0 && t_ < firstHitAt_ + openFor_) raw *= 1.0 + openAmp_;  // First Strike
        const double mult = type == DamageType::Physical ? target->physMult
                            : type == DamageType::Magic  ? target->magicMult
                                                         : target->trueMult;
        const double dmg = std::min(target->hp, raw * mult);
        double vamp = omnivamp_ + (physicalAttack ? lifesteal_ : 0.0) + (t_ < rVampUntil_ ? get(fx_, "r_omnivamp") : 0.0);
        if (!stacks_.empty()) vamp += fullStackVamp();
        if (get(fx_, "vamp_missing") > 0)  // Ominous Pact: grows with missing Health, full at 30% Health
            vamp += get(fx_, "vamp_missing") * std::clamp((1.0 - myHp_ / maxHp_) / 0.7, 0.0, 1.0);
        heal(dmg * vamp);
        target->hp -= dmg;
        if (type == DamageType::Physical && target->cleaver < 5 && get(fx_, "cleaver_shred") > 0) {
            ++target->cleaver;
            target->physMult = physMultOf(*target);
        }
        res_.bySource[src] += dmg;
        res_.totalDamage += dmg;
        if (res_.firstHit < 0) res_.firstHit = t_;
        if (t_ < res_.firstHit + kShortFight) res_.inShort += dmg;
        if (t_ < res_.firstHit + kLongFight) res_.inLong += dmg;
        const bool isPrimary = hasPrimary() && target == &P();
        if (isPrimary) res_.primaryDamage += dmg;
        const double execute = execute_;
        double executed = 0;
        if (execute > 0 && target->hp > 0 && target->hp < execute * target->maxHp) {
            executed = target->hp;
            res_.bySource[src] += target->hp;
            res_.totalDamage += target->hp;
            if (t_ < res_.firstHit + kShortFight) res_.inShort += target->hp;
            if (t_ < res_.firstHit + kLongFight) res_.inLong += target->hp;
            if (isPrimary) res_.primaryDamage += target->hp;
            target->hp = 0;
        }
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "damage"; ev.target = target->uid; ev.source = src;
            ev.text = type == DamageType::Physical ? "physical" : type == DamageType::Magic ? "magic" : "true";
            ev.amount = dmg + executed; ev.hp = target->hp; ev.maxHp = target->maxHp;
            record(ev);
            if (target->hp <= 0) {
                ev.kind = "kill"; ev.amount = 0;
                ev.flag = executed > 0 || executeHit_;  // an execute: the killing blow scaled with missing Health
                record(ev);
            }
        }
        const Vec at = target->pos;
        if (target->hp <= 0) onKill(target);
        // Dropkick: the executed champion explodes on the enemies around it.
        if (executed > 0 && get(fx_, "exec_blast_flat") > 0) {
            const double blast = amountOf(fx_, "exec_blast_", nullptr);
            for (Enemy* o : near(at, 300)) deal(o, blast, DamageType::Magic, SrcItems);
            heal(amountOf(fx_, "exec_heal_", nullptr) * hsp_);
        }
        // Glass Cannon: extra true damage on top.
        if (trueExtra_ > 0 && type != DamageType::True && target->alive) deal(target, raw * trueExtra_, DamageType::True, src);
        return dmg;
    }

    // Dashes and blinks: move toward the target, up to the ability's reach, stopping
    // at your attack range (ranged champions keep some distance).
    void dashFor(const Geometry& g) {
        if (g.move == Move::None || !hasPrimary()) return;
        const Vec toT = P().pos - me_;
        const double d = len(toT);
        const double stopAt = attackRange_ >= 300 ? 0.8 * attackRange_ : 2 * rules_.hitbox;
        const double step = std::clamp(d - stopAt, 0.0, g.range > 0 ? g.range : 350.0);
        me_ = me_ + unit(toT) * step;
        clampLane(me_);
        recordPositions(t_, true);
    }

    bool inside(const Geometry& g, Vec q, Vec origin, Vec dir, Vec center) const {
        const double hb = rules_.hitbox;
        const Vec rel = q - origin;
        switch (g.shape) {
            case Shape::Line: {
                const double along = dot(rel, dir);
                return along >= -hb && along <= g.range + hb && std::fabs(cross(dir, rel)) <= 0.5 * g.width + hb;
            }
            case Shape::Circle: return len(q - center) <= g.radius + hb;
            case Shape::Cone: {
                const double d = len(rel);
                if (d > g.range + hb) return false;
                if (d < hb) return true;
                const double off = std::acos(std::clamp(dot(rel * (1.0 / d), dir), -1.0, 1.0));
                return off <= 0.5 * g.angle * M_PI / 180.0 + std::atan(hb / d);
            }
            case Shape::Single: return false;
        }
        return false;
    }

    struct Shot {
        std::vector<Enemy*> hits;
        bool primaryHit = false;
        Vec aim;
        double flight = 0;
    };

    // Who an ability hits: where everyone will be when it lands, with enemies who
    // see a skillshot coming sidestepping it.
    Shot shoot(const Ability& a) {
        Shot s;
        const Geometry& g = a.geo;
        Enemy* tgt = hasPrimary() ? &P() : nullptr;
        if (!tgt) return s;
        if (g.selfBuff || g.shape == Shape::Single) {
            s.aim = tgt->pos;
            if (distTo(*tgt) <= needRange(a) + 1) { s.hits.push_back(tgt); s.primaryHit = true; }
            return s;
        }
        if (g.shape == Shape::Circle && g.onSelf) {
            s.aim = me_;
            s.hits = near(me_, g.radius);
            for (Enemy* e : s.hits) s.primaryHit |= e == tgt;
            return s;
        }
        double flight = g.speed > 0 ? distTo(*tgt) / g.speed : 0.0;
        const Vec lead = tgt->pos + tgt->vel * (flight * rules_.aimLead);
        const Vec dir = unit(lead - me_);
        Vec center = lead;
        if (g.shape == Shape::Circle) {
            if (len(center - me_) > g.range) center = me_ + dir * g.range;
            flight = g.speed > 0 ? len(center - me_) / g.speed : 0.0;
        }
        s.aim = g.shape == Shape::Circle ? center : me_ + dir * g.range;
        s.flight = flight;
        // Seconds a dodging enemy has to get out of the way: it sees the cast start.
        const double window = castTimeOf(a) + flight - rules_.reactionTime;
        std::vector<std::pair<double, Enemy*>> hit;
        for (auto& e : enemies_) {
            if (!e.alive) continue;
            Vec q = e.pos + e.vel * flight;
            if (!inside(g, q, me_, dir, center)) continue;
            if (window > 0 && e.moveSpeed > 0 && moveRng_.chance(rules_.dodgeChance)) {
                Vec away = g.shape == Shape::Circle ? unit(q - center, Vec{-dir.y, dir.x})
                                                    : Vec{-dir.y, dir.x} * (cross(dir, q - me_) >= 0 ? 1.0 : -1.0);
                const double room = e.moveSpeed * window;
                q = q + away * room;
                clampLane(q);
                // Its sidestep, for the replay: the part during the cast at once, the rest while it flies.
                e.dodgeVel = away * e.moveSpeed;
                e.dodgeUntil = t_ + flight;
                e.pos = e.pos + away * (e.moveSpeed * std::max(0.0, std::min(window, castTimeOf(a) - rules_.reactionTime)));
                clampLane(e.pos);
                if (inside(g, q, me_, dir, center)) hit.push_back({dot(q - me_, dir), &e});
            } else {
                hit.push_back({dot(q - me_, dir), &e});
            }
        }
        if (g.shape == Shape::Line && g.stops && hit.size() > 1) {
            std::sort(hit.begin(), hit.end(), [](const auto& x, const auto& y) { return x.first < y.first; });
            hit.resize(1);
        }
        for (auto& [d, e] : hit) {
            s.hits.push_back(e);
            s.primaryHit |= e == tgt;
        }
        // The main target first, so item procs land on it.
        std::stable_partition(s.hits.begin(), s.hits.end(), [&](Enemy* e) { return e == tgt; });
        return s;
    }

    double hitRaw(const Hit& h, const Enemy& e) const {
        double v = scaled(h.scaling);
        switch (h.target) {
            case HitTarget::MaxHp: v *= e.maxHp; break;
            case HitTarget::CurrentHp: v *= e.hp; break;
            case HitTarget::MissingHp: v *= (e.maxHp - e.hp); break;
            case HitTarget::Flat: break;
        }
        return v * h.weight;
    }

    // Expected multiplier when abilities can crit (Jeweled Gauntlet).
    double abilityCritFactor() const {
        if (get(fx_, "abilities_crit") <= 0) return 1.0;
        return 1.0 + crit_ * (get(fx_, "ability_crit_damage", rules_.critMult) - 1.0);
    }

    void onAbilityDamage(Enemy* e, bool first) {
        // Burns (Liandry's, Blackfire): one full burn per target per burn duration.
        const double burnDur = get(fx_, "burn_duration");
        if (burnDur > 0 && e->alive && t_ >= e->burnUntil) {
            const double perSec = get(fx_, "burn_max_hp") * e->maxHp + get(fx_, "burn_flat") + get(fx_, "burn_ap") * ap_;
            e->burnUntil = t_ + burnDur;
            deal(e, perSec * burnDur, DamageType::Magic, SrcItems);
        }
        // Infernal Conduit: a stacking burn that also shortens basic ability cooldowns.
        const double conduitDur = get(fx_, "conduit_duration");
        if (conduitDur > 0 && e->alive && t_ >= e->conduitAt) {
            e->conduitAt = t_ + 1.0;
            deal(e, get(fx_, "conduit_ap") * ap_ + get(fx_, "conduit_ad") * bonusAd_, DamageType::Magic, SrcItems);
            reduceCooldowns(get(fx_, "conduit_cdr_per_tick") * conduitDur, 0.0, false);
        }
        if (!first) return;
        for (auto& p : abilityProcs_) {
            if (t_ < p.readyAt || !e->alive) continue;
            p.readyAt = t_ + get(*p.fx, "proc_cd");
            const double dmg = get(*p.fx, "proc_flat") + get(*p.fx, "proc_ap") * ap_;
            deal(e, dmg, DamageType::Magic, SrcItems);
            int extra = static_cast<int>(get(*p.fx, "proc_targets", 1)) - 1;
            for (Enemy* s : near(e->pos, 600, e)) {
                if (extra-- <= 0) break;
                deal(s, dmg, DamageType::Magic, SrcItems);
            }
        }
        if (hasMissile_ && t_ >= missile_.readyAt && e->alive) {
            missile_.readyAt = t_ + get(*missile_.fx, "missile_cd");
            deal(e, get(*missile_.fx, "missile_count") * get(*missile_.fx, "missile_max_hp") * e->maxHp,
                 DamageType::True, SrcItems);
        }
    }

    void castAbility(size_t idx, double castTime) {
        const Ability& a = ch_.abilities[idx];
        const Source src = a.slot == 'Q' ? SrcQ : a.slot == 'W' ? SrcW : a.slot == 'E' ? SrcE : SrcR;
        tickStacks();
        dashFor(a.geo);
        const Shot shot = shoot(a);
        // Augments on this ability (spell_bind): more damage, more targets, a second cast, healing, fear.
        double spellAmp = 1, extraTargets = 0, extraAmp = 0, recast = 0, spellVamp = 0, fear = 0, fearRadius = 0;
        for (const auto& bd : bound_) {
            if (bd.idx != idx) continue;
            const Bag& f = *bd.fx;
            spellAmp += get(f, "spell_amp");
            extraTargets += get(f, "spell_extra_targets");
            extraAmp = std::max(extraAmp, get(f, "spell_extra_amp"));
            recast += get(f, "spell_recast");
            spellVamp += get(f, "spell_vamp");
            fear = std::max(fear, std::min(get(f, "spell_fear"), a.cooldown / 20.0));
            fearRadius = std::max(fearRadius, get(f, "spell_fear_radius"));
        }
        const double amp = abilityAmp_ * abilityCritFactor() * spellAmp;
        if (trace_) {
            TraceEvent ev;
            ev.t = t_ - castTime; ev.kind = "cast"; ev.slot = a.slot; ev.amount = castTime; ev.flag = shot.primaryHit;
            ev.lock = a.lock;
            ev.target = hasPrimary() ? P().uid : -1;
            const Geometry& g = a.geo;
            ev.text = g.selfBuff ? "buff" : g.shape == Shape::Line ? "line" : g.shape == Shape::Cone ? "cone"
                      : g.shape == Shape::Circle ? (g.onSelf ? "self" : "circle") : "single";
            ev.x = shot.aim.x; ev.y = shot.aim.y; ev.flight = shot.flight;
            record(ev);
        }
        if (!a.shield.empty()) addShield(scaled(a.shield) * hsp_, a.shieldDuration, a.slot);
        if (!a.heal.empty()) heal(scaled(a.heal) * hsp_);
        // Tripleshot, Spell Split: the ability also hits a few more enemies near the target, for less.
        std::vector<std::pair<Enemy*, double>> targets;
        for (Enemy* e : shot.hits) targets.push_back({e, 1.0});
        if (extraTargets > 0 && shot.primaryHit) {
            int left = static_cast<int>(extraTargets + 0.5);
            for (Enemy* o : near(shot.hits.front()->pos, 500, shot.hits.front())) {
                if (left <= 0) break;
                if (std::find(shot.hits.begin(), shot.hits.end(), o) != shot.hits.end()) continue;
                targets.push_back({o, extraAmp});
                --left;
            }
        }
        double dealt = 0;
        snipeHit_ = false;
        bool first = true;
        for (auto& [e, w] : targets) {
            const double from = distTo(*e);
            for (const auto& h : a.hits) {
                double raw = hitRaw(h, *e) * amp * w;
                if (!h.perSecond && a.slot != 'R') raw *= rules_.longRange(from);  // ARAM long-range cut
                if (h.perSecond) {
                    // Damage over time lasts its duration, but no longer than the ability's
                    // cooldown: a recast replaces it (and channels stop other actions anyway).
                    raw *= std::min(a.duration > 0 ? a.duration : rules_.dotDuration, cooldownOf(a));
                }
                executeHit_ = h.target == HitTarget::MissingHp;
                dealt += deal(e, raw, h.type, src);
                executeHit_ = false;
            }
            if (!a.hits.empty()) {
                snipeHit_ |= from > get(fx_, "snipe_range", 600);
                if (e->alive) trigger(OnAbility, e);
            }
            if (!a.cc.empty() && e->alive) {
                applyCc(*e, a);
                if (immobilizes(a)) trigger(OnImmobilize, e);
            }
            onAbilityDamage(e, first);
            if (first && !a.hits.empty() && e->alive) passivesOn(e, false);
            first = false;
        }
        if (!targets.empty() && !a.hits.empty()) stackEvent(OnAbility);
        if (!targets.empty() && immobilizes(a)) stackEvent(OnImmobilize);
        // Echo Cast: a copy of the ability goes off again.
        if (recast > 0)
            for (auto& [e, w] : targets)
                for (const auto& h : a.hits)
                    if (e->alive && !h.perSecond) dealt += deal(e, hitRaw(h, *e) * amp * w * recast, h.type, src);
        if (spellVamp > 0) heal(dealt * spellVamp * hsp_);  // Siphon
        if (fear > 0)  // Terror
            for (Enemy* e : near(me_, fearRadius)) ccEnemy(*e, fear, "fear");
        Enemy* hitOne = shot.primaryHit && hasPrimary() ? &P() : nullptr;
        if (a.geo.move != Move::None) trigger(OnDash, hitOne);
        for (const auto& bd : bound_)
            if (bd.idx == idx)
                for (auto& tr : trigs_)
                    if (tr.fx == bd.fx && static_cast<int>(get(*tr.fx, "trig_on")) == OnBound) fireTrig(tr, hitOne, 1.0);
        if (a.lock > 0)  // Don't Change the Channel: a shield for every second of channeling
            for (auto& tr : trigs_)
                if (static_cast<int>(get(*tr.fx, "trig_on")) == OnChannel) fireTrig(tr, nullptr, a.lock, a.lock + 0.5);
        if (a.slot == 'R') onUltimate(shot.hits);
        passivesCast();
        if (spellblade_ && t_ >= spellbladeReady_) {
            spellbladeArmed_ = true;
            spellbladeArmedAt_ = t_;
        }
    }

    // Poro Charge (Poro Stampede's quest reward): waves of Poros charge down the lane at the enemy
    // team, one more wave per feeding milestone. Each wave is a wide, slow skillshot that can be
    // dodged; a champion already hit takes reduced damage from later waves.
    void poroCharge() {
        const Bag& f = *poro_;
        const double fed = get(f, "poros_fed");
        int waves = 0;
        for (double need : {5, 12, 20, 30, 44, 63, 90, 129, 187, 275}) waves += fed >= need;
        if (!waves) return;
        const double lv = (sc_.level - 1) / 17.0;
        const double dmg = get(f, "poro_min") + (get(f, "poro_max") - get(f, "poro_min")) * lv + get(f, "poro_per_fed") * fed;
        Ability a;
        a.castTime = 0.25;
        a.geo.shape = Shape::Line;
        a.geo.range = get(f, "poro_range");
        a.geo.width = get(f, "poro_width");
        a.geo.speed = get(f, "poro_speed");
        std::vector<int> hitBefore;
        for (int w = 0; w < waves && hasPrimary(); ++w) {
            const Shot shot = shoot(a);
            if (trace_) {
                TraceEvent ev;
                ev.t = t_ + w * get(f, "poro_wave_gap"); ev.kind = "poro"; ev.amount = w + 1; ev.flag = shot.primaryHit;
                ev.x = shot.aim.x; ev.y = shot.aim.y; ev.flight = shot.flight;
                record(ev);
            }
            for (Enemy* e : shot.hits) {
                const bool again = std::find(hitBefore.begin(), hitBefore.end(), e->uid) != hitBefore.end();
                deal(e, dmg * (again ? get(f, "poro_repeat") : 1.0), DamageType::Physical, SrcItems);
                if (!again) hitBefore.push_back(e->uid);
            }
        }
    }

    // Navori and Mystic Punch: attacks shorten ability cooldowns.
    void reduceCooldowns(double flat, double pct, bool includeR) {
        for (size_t i = 0; i < readyAt_.size(); ++i) {
            if (ch_.abilities[i].slot == 'R' && !includeR) continue;
            if (readyAt_[i] > t_ && readyAt_[i] < 1e17) {
                double remaining = readyAt_[i] - t_;
                remaining = std::max(0.0, remaining * (1.0 - pct) - flat);
                readyAt_[i] = t_ + remaining;
            }
        }
    }

    void applyOnHit(Enemy* e, double scale) {
        if (!e || !e->alive) return;
        double magic = get(fx_, "onhit_magic") + get(fx_, "onhit_magic_ap") * ap_;
        if (ch_.resource == 1 && get(fx_, "onhit_mana") > 0)  // Juiced: a share of max mana (less when ranged)
            magic += get(fx_, "onhit_mana") * maxMana_ * (ranged_ ? get(fx_, "onhit_mana_ranged", 1.0) : 1.0);
        deal(e, scale * magic, DamageType::Magic, SrcItems);
        double phys = get(fx_, "onhit_phys") + get(fx_, "onhit_cur_hp") * e->hp + get(fx_, "onhit_own_hp") * maxHp_ +
                      get(fx_, "onhit_phys_ap") * ap_;
        deal(e, scale * phys, DamageType::Physical, SrcItems, true);
    }

    void die(double at) {
        dead_ = true;
        res_.died = true;
        res_.timeAlive = at;
        myHp_ = 0;
        recordSelf(at, "death");
        recordPositions(at, true);
    }

    // Lethal damage at time `at`: true if a passive or the ultimate keeps the champion going.
    bool cheatDeath(double at) {
        if (kitCheatDeath(at)) return true;
        // Hellbent: revive once, a few seconds later, with a share of max Health.
        if (augReviveUsed_ || get(fx_, "revive_frac") <= 0) return false;
        augReviveUsed_ = augRevive_ = true;
        reviveFrac_ = get(fx_, "revive_frac");
        invulnUntil_ = reviveAt_ = at + get(fx_, "revive_delay");
        cc_.push_back({at, reviveAt_});
        recordSelf(at, "defy");
        return true;
    }
    bool kitCheatDeath(double at) {
        if (deathUsed_ || (ch_.deathAct <= 0 && ch_.reviveFrac <= 0)) return false;
        deathUsed_ = true;
        if (ch_.deathNeedsR) {
            size_t r = ch_.abilities.size();
            for (size_t i = 0; i < ch_.abilities.size(); ++i)
                if (ch_.abilities[i].slot == 'R') r = i;
            if (r == ch_.abilities.size() || readyAt_[r] > at) return false;
            readyAt_[r] = at + cooldownOf(ch_.abilities[r]);
        }
        if (!rng_.chance(ch_.deathChance)) return false;
        if (ch_.deathAct > 0) {  // keeps fighting, then dies
            invulnUntil_ = dieAt_ = at + ch_.deathAct;
            myHp_ = 1;
        } else {  // down (can't act or be hurt), then back with some Health
            reviveFrac_ = ch_.reviveFrac;
            invulnUntil_ = reviveAt_ = at + ch_.reviveDelay;
            cc_.push_back({at, at + ch_.reviveDelay});
        }
        recordSelf(at, "defy");
        return true;
    }

    // Attack wind-up at the current attack speed: the base wind-up, moved toward its share
    // of the faster attack by the champion's wind-up modifier.
    double windupTime() const {
        const double base = ch_.windup / ch_.as;
        return base + (ch_.windup / attackSpeed_ - base) * ch_.windupMod;
    }
    double castTimeOf(const Ability& a) const {
        return a.castFromAttack > 0 ? a.castFromAttack * windupTime() : a.castTime;
    }

    void basicAttack(double windup = 0) {
        tickStacks();
        Enemy* e = &P();
        ++attacks_;
        const int every = static_cast<int>(get(fx_, "crit_every"));  // Jhin's fourth shot always crits
        const bool crit = (every > 0 && attacks_ % every == 0) || rng_.chance(crit_);
        const double critMult = rules_.critMult + critDamage_;
        if (trace_) {
            TraceEvent ev;
            ev.t = t_; ev.kind = "attack"; ev.target = e->uid; ev.flag = crit; ev.amount = windup;
            record(ev);
        }
        const double hit = deal(e, ad_ * (crit ? critMult : 1.0), DamageType::Physical, SrcAttack, true);
        if (crit) heal(hit * get(fx_, "crit_lifesteal"));  // Soul Siphon
        applyOnHit(e, 1.0);
        if (crit && get(fx_, "crit_onhit_extra") > 0) applyOnHit(e, get(fx_, "crit_onhit_extra"));  // Double Tap
        if (shrink_ > 0) e->shrinkUntil = t_ + get(fx_, "shrink_duration");
        // Typhoon: a missile at a second enemy, for part of the attack plus on-hit.
        if (get(fx_, "typhoon_ad") > 0)
            for (Enemy* o : near(me_, attackReach() + 300, e)) {
                deal(o, get(fx_, "typhoon_ad") * ad_ * (crit ? critMult : 1.0), DamageType::Physical, SrcItems, true);
                applyOnHit(o, 1.0);
                break;
            }
        trigger(OnAttack, e);
        if (crit) trigger(OnCrit, e);
        stackEvent(OnAttack);
        if (crit) stackEvent(OnCrit);
        if (get(fx_, "phantom_every") > 0 && attacks_ % static_cast<int>(get(fx_, "phantom_every")) == 0)
            applyOnHit(e, 1.0);
        if (hasKraken_ && ++kraken_.counter >= static_cast<int>(get(*kraken_.fx, "kraken_every")) && e->alive) {
            kraken_.counter = 0;
            const double missing = 1.0 - e->hp / e->maxHp;
            deal(e, get(*kraken_.fx, "kraken_damage") * (1.0 + get(*kraken_.fx, "kraken_missing_amp") * missing),
                 DamageType::Physical, SrcItems);
        }
        if (hasStorm_ && ++storm_.counter >= static_cast<int>(get(*storm_.fx, "storm_every")) && e->alive) {
            storm_.counter = 0;
            deal(e, get(*storm_.fx, "storm_magic"), DamageType::Magic, SrcItems);
        }
        // Heartsteel: a charged attack per target, on its own per-target cooldown.
        if (get(fx_, "heartsteel_cd") > 0 && t_ >= e->heartsteelAt && e->alive) {
            e->heartsteelAt = t_ + get(fx_, "heartsteel_cd");
            deal(e, get(fx_, "heartsteel_flat") + get(fx_, "heartsteel_own_hp") * maxHp_, DamageType::Physical, SrcItems);
        }
        if (hasEclipse_ && t_ >= eclipse_.readyAt && e->alive) {
            eclipse_.readyAt = t_ + get(*eclipse_.fx, "maxhp_proc_cd");
            deal(e, get(*eclipse_.fx, "maxhp_proc") * e->maxHp, DamageType::Physical, SrcItems);
            const Bag& f = *eclipse_.fx;
            addShield((get(f, "proc_shield_flat") + get(f, "proc_shield_bonus_ad") * bonusAd_) *
                          (ranged_ && get(f, "shield_ranged") > 0 ? get(f, "shield_ranged") : 1.0),
                      get(f, "proc_shield_duration"), 'I');
        }
        if (spellbladeArmed_ && t_ - spellbladeArmedAt_ <= rules_.spellbladeWindow && e->alive) {
            const Bag& f = *spellblade_;
            const double dmg = get(f, "spellblade_base_ad") * baseAd_ + get(f, "spellblade_bonus_ad") * bonusAd_ +
                               get(f, "spellblade_ap") * ap_;
            deal(e, dmg, get(f, "spellblade_magic") > 0 ? DamageType::Magic : DamageType::Physical, SrcItems);
            spellbladeArmed_ = false;
            spellbladeReady_ = t_ + get(f, "spellblade_cd");
        }
        // Dual Wield: a second, weaker bolt with partial on-hit.
        if (get(fx_, "second_bolt") > 0 && e->alive) {
            deal(e, get(fx_, "second_bolt") * ad_ * (crit ? critMult : 1.0), DamageType::Physical, SrcItems, true);
            applyOnHit(e, get(fx_, "second_bolt_onhit"));
        }
        if (!ranged_ && get(fx_, "cleave_ad") > 0)
            for (Enemy* s : near(e->pos, 350, e)) deal(s, get(fx_, "cleave_ad") * ad_, DamageType::Physical, SrcItems);
        if (ranged_ && get(fx_, "bolts") > 0) {
            int bolts = static_cast<int>(get(fx_, "bolts"));
            for (Enemy* s : near(me_, attackRange_ + rules_.hitbox, e)) {
                if (bolts-- <= 0) break;
                deal(s, get(fx_, "bolts_ad") * ad_ * (rng_.chance(crit_) ? critMult : 1.0), DamageType::Physical,
                     SrcItems, true);
            }
        }
        for (const Ability* a : onhitAbilities_) {
            if (attacks_ % a->onhitEvery != 0 || !e->alive) continue;
            const Source src = a->slot == 'Q' ? SrcQ : a->slot == 'W' ? SrcW : a->slot == 'E' ? SrcE : SrcR;
            if (trace_) {
                TraceEvent ev;
                ev.t = t_; ev.kind = "proc"; ev.slot = a->slot; ev.target = e->uid;
                record(ev);
            }
            for (const auto& h : a->hits) deal(e, hitRaw(h, *e) * abilityAmp_, h.type, src);
        }
        if (e->alive) passivesOn(e, true);
        reduceCooldowns(get(fx_, "attack_cdr_flat"), get(fx_, "attack_cdr_pct"), false);
    }

    // The champion's passive: an attack (attack = true) or an ability hit landed on e.
    void passivesOn(Enemy* e, bool attack) {
        for (size_t i = 0; i < ch_.passives.size() && e->alive; ++i) {
            const Passive& p = ch_.passives[i];
            PassiveState& st = passiveState_[i];
            using T = Passive::Trigger;
            if (attack ? p.trigger == T::Ability : (p.trigger == T::Attack || p.trigger == T::AfterAbility)) continue;
            double& ready = p.perTarget ? st.targetReady[e->uid] : st.readyAt;
            if (t_ < ready) continue;
            if (p.belowHp > 0 && e->hp > p.belowHp * e->maxHp) continue;
            if (p.trigger == T::AfterAbility) {
                if (st.charges <= 0) continue;
                --st.charges;
            } else if (++st.count < p.every) {
                continue;
            }
            st.count = 0;
            if (p.cooldown > 0) ready = t_ + p.cooldown;
            if (trace_) {
                TraceEvent ev;
                ev.t = t_; ev.kind = "proc"; ev.slot = 'P'; ev.target = e->uid;
                record(ev);
            }
            std::vector<Enemy*> targets{e};
            if (p.aoe)
                for (Enemy* o : near(e->pos, 350, e)) targets.push_back(o);
            for (Enemy* t : targets)
                for (const auto& h : p.hits)
                    if (t->alive) deal(t, hitRaw(h, *t), h.type, SrcPassive);
        }
    }
    // Abilities charge "after using an Ability" passives (Riven, Zoe, Lucian...).
    void passivesCast() {
        for (size_t i = 0; i < ch_.passives.size(); ++i) {
            const Passive& p = ch_.passives[i];
            if (p.trigger != Passive::Trigger::AfterAbility) continue;
            PassiveState& st = passiveState_[i];
            st.charges = std::min(p.maxCharges, st.charges + p.charges);
        }
    }
    struct PassiveState { int count = 0, charges = 0; double readyAt = 0; std::map<int, double> targetReady; };
    std::vector<PassiveState> passiveState_;

    void tickAuras(double until) {
        if (until <= auraClock_) return;
        const double dt = until - auraClock_;
        auraClock_ = until;
        // Unending Despair: drains bonus Health from everyone in range on a short cooldown.
        if (get(fx_, "drain_cd") > 0)
            for (Enemy* e : near(me_, get(fx_, "drain_range")))
                deal(e, get(fx_, "drain_bonus_hp") * bonusHp_ / get(fx_, "drain_cd") * dt, DamageType::Magic, SrcItems);
        if (auraDps_ <= 0 && auraHits_.empty()) return;
        // Auras burn whoever stands close: item auras (Sunfire) reach 325, ability
        // auras their own radius.
        if (auraDps_ > 0)
            for (Enemy* e : near(me_, 325)) deal(e, auraDps_ * dt, DamageType::Magic, SrcItems);
        for (const auto& [a, h] : auraHits_) {
            const Source src = a->slot == 'Q' ? SrcQ : a->slot == 'W' ? SrcW : a->slot == 'E' ? SrcE : SrcR;
            Vec at;
            if (!auraCenter(*a, at)) continue;
            for (Enemy* e : near(at, auraRadius(*a))) deal(e, hitRaw(*h, *e) * abilityAmp_ * dt, h->type, src);
        }
        if (trace_) traceToggles();
    }
    static double auraRadius(const Ability& a) {
        if (a.toggle && a.geo.shape == Shape::Circle) return a.geo.radius;
        return a.geo.shape == Shape::Circle && a.geo.onSelf ? a.geo.radius : 350.0;
    }
    // Where an aura burns: around you, or for a placed toggle (Anivia R) on your target
    // while it stands within cast range.
    bool auraCenter(const Ability& a, Vec& at) {
        at = me_;
        if (!a.toggle || a.geo.onSelf || a.geo.shape != Shape::Circle) return true;
        if (!hasPrimary() || distTo(P()) > a.geo.range + a.geo.radius) return false;
        at = P().pos;
        return true;
    }
    // The replay shows a toggle switching on (a cast, then its ring stays up) when an enemy comes
    // into its reach, and off once nobody has been there for a second and a half.
    std::map<char, double> toggleSeen_;
    std::set<char> toggleOn_;
    void traceToggles() {
        for (const Ability& a : ch_.abilities) {
            if (!a.toggle) continue;
            Vec at;
            if (auraCenter(a, at) && !near(at, auraRadius(a)).empty()) toggleSeen_[a.slot] = t_;
            const bool on = toggleSeen_.count(a.slot) && t_ - toggleSeen_[a.slot] < 1.5;
            if (on == static_cast<bool>(toggleOn_.count(a.slot))) continue;
            if (on) toggleOn_.insert(a.slot); else toggleOn_.erase(a.slot);
            TraceEvent ev;
            const bool placed = !a.geo.onSelf && hasPrimary();
            ev.t = t_; ev.kind = "toggle"; ev.slot = a.slot; ev.flag = on; ev.amount = auraRadius(a);
            if (placed) ev.target = P().uid;
            record(ev);
            if (!on) continue;
            TraceEvent cast;
            cast.t = t_; cast.kind = "cast"; cast.slot = a.slot; cast.flag = true; cast.text = placed ? "circle" : "self";
            cast.x = placed ? P().pos.x : me_.x; cast.y = placed ? P().pos.y : me_.y;
            if (placed) cast.target = P().uid;
            record(cast);
        }
    }

    // Ability haste on one ability: the build's, plus haste for that slot, dashes or the
    // augment on it; Ult Bot puts all of it (half again) on the ultimate.
    double hasteFor(const Ability& a) const {
        double h = ah_;
        h += a.slot == 'Q' ? get(fx_, "ah_q") : a.slot == 'W' ? get(fx_, "ah_w") : a.slot == 'E' ? get(fx_, "ah_e") : get(fx_, "ah_r");
        if (a.geo.move != Move::None) h += get(fx_, "ah_dash");
        for (const auto& bd : bound_)
            if (bd.idx < ch_.abilities.size() && &ch_.abilities[bd.idx] == &a) h += get(*bd.fx, "spell_ah");
        if (a.slot != 'R' && t_ < rBasicAhUntil_) h += get(fx_, "r_basic_ah");
        if (ultOnlyHaste_) h = a.slot == 'R' ? 1.5 * h : 0.0;
        return h;
    }
    double cooldownOf(const Ability& a) const { return a.cooldown * (1.0 - cdr_) * 100.0 / (100.0 + hasteFor(a)); }

    // ---- Augment mechanics -------------------------------------------------------------
    enum TrigOn { OnAttack = 1, OnAbility, OnHit, OnCrit, OnImmobilize, OnDash, OnTimer, OnKill, OnShield, OnBound, OnChannel, OnTaken };

    // An amount from "<p>flat", "<p>ap", "<p>bonus_ad"... keys (target-based ones need a target).
    double amountOf(const Bag& f, const std::string& p, const Enemy* e) const {
        double v = get(f, p + "flat") + get(f, p + "ap") * ap_ + get(f, p + "ad") * ad_ + get(f, p + "bonus_ad") * bonusAd_ +
                   get(f, p + "own_hp") * maxHp_ + get(f, p + "bonus_hp") * bonusHp_ +
                   get(f, p + "bonus_armor") * bonusArmor_ + get(f, p + "bonus_mr") * bonusMr_;
        if (e) v += get(f, p + "max_hp") * e->maxHp + get(f, p + "cur_hp") * e->hp + get(f, p + "missing_hp") * (e->maxHp - e->hp);
        return v;
    }
    DamageType typeOf(double code) const {
        const int c = static_cast<int>(code);
        if (c == 3) return bonusAd_ > ap_ ? DamageType::Physical : DamageType::Magic;  // adaptive
        return c == 0 ? DamageType::Physical : c == 1 ? DamageType::Magic : DamageType::True;
    }

    void trigger(int kind, Enemy* e) {
        for (auto& tr : trigs_) {
            const int on = static_cast<int>(get(*tr.fx, "trig_on"));
            if (on == kind || (on == OnHit && (kind == OnAttack || kind == OnAbility))) fireTrig(tr, e, 1.0);
        }
    }
    // One triggered effect: damage to the target (and enemies around it, or around you), on-hit
    // effects, crowd control, a heal and a shield, on its cooldown (per target when per_target).
    bool fireTrig(Trig& tr, Enemy* e, double scale, double shieldFor = 0) {
        const Bag& f = *tr.fx;
        if (e && !e->alive) return false;
        const bool perTarget = e && get(f, "trig_per_target") > 0;
        double& ready = perTarget ? tr.perTarget[e->uid] : tr.readyAt;
        if (t_ < ready) return false;
        if (get(f, "trig_below") > 0 && (!e || e->hp > get(f, "trig_below") * e->maxHp)) return false;
        if (get(f, "trig_min_range") > 0 && (!e || distTo(*e) < get(f, "trig_min_range"))) return false;
        if (++tr.counter < static_cast<int>(get(f, "trig_every", 1))) return false;
        tr.counter = 0;
        ready = t_ + get(f, "trig_cd");
        scale *= get(f, "trig_scale", 1.0) * get(f, "trig_chance", 1.0);
        std::vector<Enemy*> hit;
        if (get(f, "trig_around_me") > 0) {
            hit = near(me_, get(f, "trig_around_me"));
        } else if (e) {
            hit.push_back(e);
            if (get(f, "trig_radius") > 0)
                for (Enemy* o : near(e->pos, get(f, "trig_radius"), e)) hit.push_back(o);
        }
        const double count = get(f, "trig_count", 1) + get(f, "trig_count_per_crit") * crit_;
        const double critF = get(f, "trig_can_crit") > 0 ? 1.0 + crit_ * (rules_.critMult + critDamage_ - 1.0) : 1.0;
        const DamageType type = typeOf(get(f, "trig_type", 1));
        const double onhit = get(f, "trig_onhit"), cc = get(f, "trig_cc");
        for (Enemy* h : hit) {
            if (!h->alive) continue;
            const double dmg = amountOf(f, "trig_", h) * scale * count * critF;
            if (dmg > 0) deal(h, dmg, type, SrcItems);
            if (onhit > 0) applyOnHit(h, onhit * count);
            if (cc > 0) ccEnemy(*h, cc, "stun");
        }
        const double shield = amountOf(f, "trig_shield_", nullptr) * scale * hsp_;
        if (shield > 0) addShield(shield, std::max(shieldFor, get(f, "trig_shield_duration")), 'I');
        const double heal_ = (amountOf(f, "trig_heal_", nullptr) + get(f, "trig_heal_missing") * (maxHp_ - myHp_)) * scale * hsp_;
        if (heal_ > 0) heal(heal_);
        return true;
    }

    void stackEvent(int kind) {
        for (auto& s : stacks_) {
            const Bag& f = *s.fx;
            const int on = static_cast<int>(get(f, s.p + "on"));
            if (on != kind && !(on == OnHit && (kind == OnAttack || kind == OnAbility))) continue;
            expireStack(s);
            if (t_ < s.readyAt) continue;
            s.readyAt = t_ + get(f, s.p + "cd");
            const double dur = get(f, s.p + "duration");
            s.expire = dur > 0 ? t_ + dur : -1;  // every stack refreshes; none: they last the fight
            if (s.n >= get(f, s.p + "max")) continue;
            ++s.n;
            double ap = get(f, s.p + "ap"), ad = get(f, s.p + "ad");
            const double as = get(f, s.p + "as"), ms = get(f, s.p + "ms"), af = get(f, s.p + "af");
            ap_ += ap; bonusAd_ += ad; ad_ += ad;
            if (af > 0) addAdaptive(af, &ap, &ad);
            s.ap += ap; s.ad += ad; s.as += as; s.ms += ms;
            tempAs_ += as;
            moveSpeed_ += ms;
            if (as != 0 || (ms != 0 && msToAs_ > 0)) updateAs();
        }
    }
    void expireStack(Stack& s) {
        if (s.n == 0 || s.expire < 0 || t_ < s.expire) return;
        ap_ -= s.ap; bonusAd_ -= s.ad; ad_ -= s.ad; tempAs_ -= s.as; moveSpeed_ -= s.ms;
        const double ready = s.readyAt;
        s = Stack{s.fx, s.p};
        s.readyAt = ready;
        updateAs();
    }
    void tickStacks() { for (auto& s : stacks_) expireStack(s); }
    double fullStackVamp() const {  // Conqueror: heals at full stacks
        double v = 0;
        for (const auto& s : stacks_)
            if (s.n > 0 && s.n >= get(*s.fx, s.p + "max")) v += get(*s.fx, s.p + "full_vamp");
        return v;
    }

    // Damage reached you at `now`: low-Health heals (Dawnbringer's Resolve) and damage-taken triggers.
    void afterDamageTaken(double now, double taken) {
        const double keep = t_;
        t_ = now;
        if (get(fx_, "low_heal_max_hp") > 0 && myHp_ < get(fx_, "low_heal_threshold") * maxHp_ && now >= lowHealReady_) {
            lowHealReady_ = now + get(fx_, "low_heal_cd");
            heal(get(fx_, "low_heal_max_hp") * maxHp_);
        }
        for (auto& tr : trigs_) {
            if (static_cast<int>(get(*tr.fx, "trig_on")) != OnTaken) continue;
            tr.taken += taken;
            if (tr.taken < get(*tr.fx, "trig_taken")) continue;
            tr.taken = 0;
            fireTrig(tr, nullptr, 1.0);
        }
        t_ = keep;
    }

    // Your crowd control immunity from now until `until`: crowd control on you in that window is dropped.
    void clearCc(double from, double until) {
        for (auto& [a, b] : cc_)
            if (a >= from && a < until) a = std::min(b, until);
        cc_.erase(std::remove_if(cc_.begin(), cc_.end(), [](const auto& c) { return c.first >= c.second; }), cc_.end());
    }

    // Augments that act when you cast your ultimate.
    void onUltimate(const std::vector<Enemy*>& hits) {
        const Bag& f = fx_;
        if (get(f, "r_invuln") > 0 && t_ >= rInvulnReady_) {  // Can't Touch This
            rInvulnReady_ = t_ + get(f, "r_invuln_cd");
            invulnUntil_ = std::max(invulnUntil_, t_ + get(f, "r_invuln"));
        }
        if (get(f, "r_shield_max_hp") > 0 && t_ >= rBuffReady_) {  // Final Form
            rBuffReady_ = t_ + get(f, "r_buff_cd");
            addShield(get(f, "r_shield_max_hp") * maxHp_, get(f, "r_buff_duration"), 'R');
            rVampUntil_ = t_ + get(f, "r_buff_duration");
        }
        if (get(f, "r_reduction") > 0 && t_ >= rReductionReady_) {  // Stuck In Here With Me
            rReductionReady_ = t_ + get(f, "r_reduction_cd");
            reductionUntil_ = t_ + get(f, "r_reduction_duration");
        }
        if (get(f, "r_reset_basics") > 0 && t_ >= rAwakenReady_) {  // Ultimate Awakening
            rAwakenReady_ = t_ + get(f, "r_awaken_cd");
            rBasicAhUntil_ = t_ + get(f, "r_basic_ah_duration");
            for (size_t i = 0; i < readyAt_.size(); ++i)
                if (ch_.abilities[i].slot != 'R' && readyAt_[i] < 1e17) readyAt_[i] = std::min(readyAt_[i], t_);
        }
        if (get(f, "r_window") > 0 && t_ >= rWindowReady_) {  // It's Killing Time, Surge Field
            rWindowReady_ = t_ + get(f, "r_window_cd");
            rWindowUntil_ = t_ + get(f, "r_window");
        }
        if (get(f, "r_cc") > 0 && t_ >= rCcReady_ && !hits.empty()) {  // Fey Magic
            rCcReady_ = t_ + get(f, "r_cc_cd");
            for (Enemy* e : hits) ccEnemy(*e, get(f, "r_cc"), "polymorph");
        }
        if (get(f, "r_unstoppable") > 0 && t_ >= rUnstopReady_) {  // Ultimate Unstoppable
            rUnstopReady_ = t_ + get(f, "r_unstoppable_cd");
            clearCc(t_, t_ + get(f, "r_unstoppable"));
        }
    }

    // After a cast's cooldown starts: refunds and costs.
    void afterCast(size_t i) {
        const Ability& a = ch_.abilities[i];
        if (a.slot == 'R' && get(fx_, "r_refresh_cd") > 0 && t_ >= rRefreshReady_) {  // Ultimate Revolution
            rRefreshReady_ = t_ + get(fx_, "r_refresh_cd");
            readyAt_[i] = t_ + 1.0;
        }
        if (snipeHit_ && a.slot != 'R' && get(fx_, "snipe_refund") > 0)  // Skilled Sniper
            readyAt_[i] = t_ + (readyAt_[i] - t_) * (1.0 - get(fx_, "snipe_refund"));
        if (get(fx_, "archmage") > 0) {  // Archmage: another ability's cooldown comes down
            size_t pick = readyAt_.size();
            for (size_t j = 0; j < readyAt_.size(); ++j)
                if (j != i && ch_.abilities[j].slot != 'R' && readyAt_[j] > t_ && readyAt_[j] < 1e17 &&
                    (pick == readyAt_.size() || readyAt_[j] > readyAt_[pick]))
                    pick = j;
            if (pick < readyAt_.size())
                readyAt_[pick] = std::max(t_, readyAt_[pick] - get(fx_, "archmage") * cooldownOf(a));
        }
        if (get(fx_, "cast_hp_cost") > 0) {  // Ominous Pact: casts cost current Health
            myHp_ -= get(fx_, "cast_hp_cost") * myHp_;
            recordSelf(t_);
        }
    }

};

Result Fight::run() {
    res_.duration = duration_;
    if (trace_) {
        trace_->engageAt = engageAt_;
        trace_->maxHp = maxHp_;
        for (const auto* e : team_) trace_->team.push_back(e->id);
        // Each crowd control on you is one enemy's ability: name which, for the replay.
        std::vector<std::pair<std::string, std::pair<char, std::string>>> sources;
        for (const auto* p : team_)
            if (const ChampionKit* k = lib_.find(p->id))
                for (const auto& h : k->hardCc) sources.push_back({p->id, h});
        size_t n = 0;
        for (const auto& [a, b] : cc_) {
            TraceEvent ev;
            ev.t = a; ev.kind = "cc"; ev.amount = b; ev.text = "stun";
            if (!sources.empty()) {
                const auto& s = sources[n++ % sources.size()];
                ev.who = s.first; ev.slot = s.second.first; ev.text = s.second.second;
            }
            record(ev);
        }
        recordFocus();
        recordSelf(0);
    }
    for (size_t i = 0; i < ch_.abilities.size(); ++i)
        if (ch_.abilities[i].slot == 'R' && (!rUp_ || noUlt_)) readyAt_[i] = 1e18;
    // Shields you start the fight with (Big Brain, Mountain Soul).
    const double startShield = amountOf(fx_, "start_shield_", nullptr);
    if (startShield > 0) addShield(startShield, duration_ + 1, 'I');
    while (true) {
        // Crowd control: you can't act or move, but everyone else keeps going.
        const double free = std::min(freeTime(t_), duration_);
        if (advance(free)) break;
        t_ = std::max(t_, free);
        if (advance(t_) || t_ >= duration_) break;

        // Switch to a much closer enemy when the target is out of reach (it ran or kited).
        if (hasPrimary() && distTo(P()) > attackReach() + 100) {
            const int near = nearestAlive(me_);
            if (near >= 0 && near != primary_ && distTo(enemies_[static_cast<size_t>(near)]) < distTo(P()) - 200) {
                primary_ = near;
                recordFocus();
            }
        }
        if (!hasPrimary()) {
            primary_ = nearestAlive(me_);
            if (primary_ < 0) {  // everyone is down: wait for the next one to walk in
                double next = duration_;
                for (const auto& e : enemies_) next = std::min(next, e.respawnAt);
                t_ = std::max(t_ + kStep, next);
                continue;
            }
            recordFocus();
        }

        // Cast the first ready ability that reaches the target; otherwise walk
        // until it (or your attack) does.
        wantRange_ = attackReach();
        bool cast = false, waiting = false, holding = false;
        for (size_t i : order_) {
            if (readyAt_[i] > t_) continue;
            const Ability& a = ch_.abilities[i];
            if (!affordable(a, t_)) continue;  // out of mana or energy: wait for it to come back
            const double need = needRange(a);
            if (distTo(P()) > need) {
                wantRange_ = std::min(wantRange_, need);
                // Nearly in range of an ability earlier in the combo: close in for it
                // rather than casting the later ones first.
                if (distTo(P()) - need < 400) holding = true;
                waiting = true;
                continue;
            }
            if (holding) continue;
            // Casting and attacking never overlap: the cast winds up, fires, and a channel
            // holds the caster for its lock before anything else can start.
            const double ct = castTimeOf(a);
            busyUntil_ = t_ + ct;
            t_ += ct;
            if (t_ >= duration_ || advance(t_)) break;
            if (!hasPrimary()) primary_ = nearestAlive(me_);
            spend(costOf(a), t_ - ct);
            if (primary_ >= 0) castAbility(i, ct);
            readyAt_[i] = t_ + cooldownOf(a);
            afterCast(i);
            if (a.lock > 0) {
                busyUntil_ = t_ + a.lock;
                t_ = std::min(t_ + a.lock, duration_);
                if (advance(t_)) break;
            }
            nextAttack_ = a.attackReset ? t_ : std::max(nextAttack_, t_);
            cast = true;
            break;
        }
        if (dead_ || t_ >= duration_) break;
        if (cast) continue;

        for (auto& p : actives_) {
            if (t_ >= p.readyAt && hasPrimary() && distTo(P()) <= 700) {
                p.readyAt = t_ + get(*p.fx, "active_cd") * 100.0 / (100.0 + get(fx_, "item_haste"));
                deal(&P(), get(*p.fx, "active_flat") + get(*p.fx, "active_ap") * ap_, DamageType::Magic, SrcItems);
            }
        }
        // Augments that go off on their own every so often (Ok Boomerang, FireFox...).
        for (auto& tr : trigs_) {
            if (static_cast<int>(get(*tr.fx, "trig_on")) != OnTimer || t_ < tr.readyAt || !hasPrimary()) continue;
            const double around = get(*tr.fx, "trig_around_me");
            if (around > 0 ? near(me_, around).empty() : distTo(P()) > get(*tr.fx, "trig_range", 700)) continue;
            tickStacks();
            fireTrig(tr, &P(), 1.0);
        }
        if (!hasPrimary()) continue;
        if (poro_ && t_ >= poroReady_ && hasPrimary() && distTo(P()) <= 0.8 * get(*poro_, "poro_range")) {
            poroReady_ = t_ + get(*poro_, "poro_cd");
            poroCharge();
        }
        if (!hasPrimary()) continue;

        const bool inRange = distTo(P()) <= attackReach();
        if (nextAttack_ > t_ || !inRange) {
            double nt = inRange ? nextAttack_ : t_ + kStep;
            if (waiting) nt = std::min(nt, t_ + kStep);
            for (size_t i : order_) {
                const Ability& a = ch_.abilities[i];
                const double ready = std::max(readyAt_[i], affordable(a, t_) || manaRegen_ <= 0
                                                               ? readyAt_[i]
                                                               : t_ + (costOf(a) - manaAt(t_)) / manaRegen_);
                if (ready > t_) nt = std::min(nt, ready);
            }
            t_ = std::max(nt, t_ + 1e-9);
            continue;
        }
        // An attack winds up before it lands and can't be mixed with a cast; once it fires,
        // the rest of the attack timer is free for casting (or walking).
        const double start = t_, wu = windupTime();
        busyUntil_ = t_ + wu;
        t_ += wu;
        if (t_ >= duration_ || advance(t_)) break;
        nextAttack_ = start + 1.0 / attackSpeed_;
        if (!hasPrimary()) continue;  // the target fell during the wind-up
        basicAttack(wu);
    }
    if (!dead_) {
        advance(duration_);
        if (!dead_) res_.timeAlive = duration_;
    }
    // A fight that lasts until you die ends when you do.
    if (sc_.untilDeath && dead_) res_.duration = std::max(res_.timeAlive, 0.5);
    res_.exposure = exposureTime_ > 0 ? exposureSum_ / exposureTime_ : 0.0;
    if (trace_) {
        lastSelfAt_ = -1;
        recordSelf(dead_ ? res_.timeAlive : duration_);
        TraceEvent ev;
        // After a death that ends the fight, the replay runs on a few seconds for the enemies' dance.
        ev.t = sc_.untilDeath && dead_ ? res_.timeAlive + kDanceTail : duration_; ev.kind = "end";
        // Crowd control is drawn for the longest possible fight; drop what falls after the end.
        auto& evs = trace_->events;
        evs.erase(std::remove_if(evs.begin(), evs.end(), [&](const TraceEvent& x) { return x.t > ev.t; }), evs.end());
        record(ev);
        std::stable_sort(trace_->events.begin(), trace_->events.end(),
                         [](const TraceEvent& a, const TraceEvent& b) { return a.t < b.t; });
    }
    return res_;
}

}  // namespace

// How much of the enemies' damage can reach this champion, on average over a fight
// (fights with no items, so every build sees the same scaling).
double meanExposure(const Library& lib, const ChampionKit& c, const Scenario& sc) {
    double sum = 0;
    const int n = 48;
    for (int i = 0; i < n; ++i) sum += Fight(lib, c, Build{}, sc, 1000000 + static_cast<uint64_t>(i)).run().exposure;
    return sum / n;
}

std::vector<Result> runTrials(const Library& lib, const ChampionKit& champ, const Build& build, const Scenario& sc,
                              uint64_t firstTrial, int count) {
    lib.validate(build);
    std::vector<Result> out;
    out.reserve(static_cast<size_t>(std::max(0, count)));
    for (int i = 0; i < count; ++i)
        out.push_back(Fight(lib, champ, build, sc, firstTrial + static_cast<uint64_t>(i)).run());
    return out;
}

FightTrace traceFight(const Library& lib, const ChampionKit& champ, const Build& build, const Scenario& sc,
                      uint64_t trial) {
    lib.validate(build);
    FightTrace trace;
    trace.result = Fight(lib, champ, build, sc, trial, &trace).run();
    return trace;
}

Summary summarize(const std::vector<Result>& results) {
    Summary s;
    s.trials = static_cast<int>(results.size());
    if (results.empty()) return s;
    std::vector<double> dps;
    dps.reserve(results.size());
    double single = 0, kpm = 0, total = 0;
    for (const auto& r : results) {
        s.shortDps += r.inShort / kShortFight;
        s.longDps += r.inLong / kLongFight;
        dps.push_back(r.totalDamage / r.duration);
        single += r.primaryDamage / r.duration;
        kpm += r.kills / r.duration * 60.0;
        s.survivalRate += r.died ? 0.0 : 1.0;
        s.meanTimeAlive += r.timeAlive;
        s.damageTakenPerSec += r.timeAlive > 0 ? r.damageTaken / r.timeAlive : 0.0;
        s.damageTaken += r.damageTaken;
        s.damageMitigated += r.mitigated;
        s.healing += r.healed;
        s.ccSeconds += r.ccDealt;
        total += r.totalDamage;
        for (int i = 0; i < SrcCount; ++i) s.shareBySource[i] += r.bySource[i];
    }
    const double n = static_cast<double>(dps.size());
    s.meanDps = std::accumulate(dps.begin(), dps.end(), 0.0) / n;
    double var = 0;
    for (double x : dps) var += (x - s.meanDps) * (x - s.meanDps);
    var /= std::max(1.0, n - 1.0);
    s.ci95 = 1.96 * std::sqrt(var / n);
    std::sort(dps.begin(), dps.end());
    auto pct = [&](double p) { return dps[static_cast<size_t>(std::min(n - 1.0, std::floor(p * (n - 1.0))))]; };
    s.p5 = pct(0.05);
    s.median = pct(0.5);
    s.p95 = pct(0.95);
    s.singleTargetDps = single / n;
    s.killsPerMinute = kpm / n;
    s.survivalRate /= n;
    s.meanTimeAlive /= n;
    s.damageTakenPerSec /= n;
    s.damageTaken /= n;
    s.damageMitigated /= n;
    s.healing /= n;
    s.ccSeconds /= n;
    s.shortDps /= n;
    s.longDps /= n;
    if (total > 0)
        for (auto& x : s.shareBySource) x /= total;
    return s;
}

// ---------------------------------------------------------------------------
// Build optimizer
// ---------------------------------------------------------------------------

bool parseMetric(const std::string& name, Metric& out) {
    static const std::pair<const char*, Metric> names[] = {{"damage", Metric::Damage}, {"taken", Metric::Taken},
        {"mitigated", Metric::Mitigated}, {"healing", Metric::Healing}, {"cc", Metric::Cc}};
    for (const auto& [n, m] : names)
        if (name == n) { out = m; return true; }
    return false;
}

double metricOf(const Result& r, Metric m) {
    switch (m) {
        case Metric::Taken: return r.damageTaken;
        case Metric::Mitigated: return r.mitigated;
        case Metric::Healing: return r.healed;
        case Metric::Cc: return r.ccDealt;
        default: return r.totalDamage / r.duration;
    }
}

double metricOf(const Summary& s, Metric m) {
    switch (m) {
        case Metric::Taken: return s.damageTaken;
        case Metric::Mitigated: return s.damageMitigated;
        case Metric::Healing: return s.healing;
        case Metric::Cc: return s.ccSeconds;
        default: return s.meanDps;
    }
}

std::vector<std::string> fittingRoles(const ChampionKit& c) {
    // AP or AD kit, from the summed ability ratios; close calls get both.
    const bool ap = c.apRatios >= 0.5 * c.adRatios && c.apRatios > 0;
    const bool ad = c.adRatios >= 0.5 * c.apRatios || (c.apRatios == 0 && c.adRatios == 0);
    std::set<std::string> r;
    auto add = [&](std::initializer_list<const char*> xs) { for (auto x : xs) r.insert(x); };
    if (ap) add({"ap", "ap_onhit", "ap_tank"});
    if (ad) {
        if (c.role == "marksman") add({"crit", "onhit", "ad", "lethality"});
        else if (c.role == "assassin") add({"lethality", "ad", "crit", "ability_ad"});
        else if (c.role == "fighter") add({"bruiser", "ad", "lethality", "onhit", "ability_ad"});
        else if (c.role == "tank") add({"bruiser", "tank"});
        else add({"lethality", "ad", "crit", "ability_ad"});
    }
    if (c.role == "marksman") add({"onhit"});
    if (c.role == "tank" || c.role == "fighter" || c.role == "support") add({"tank"});
    return {r.begin(), r.end()};
}

namespace {

double score(const Library& lib, const ChampionKit& c, const Build& b, const Scenario& sc, int trials,
             Metric m = Metric::Damage) {
    double sum = 0;
    for (const auto& r : runTrials(lib, c, b, sc, 0, trials)) sum += metricOf(r, m);
    return sum / trials;
}

// Runs fn(i) for i in [0, n) on up to `threads` threads.
template <class F>
void parallelFor(int n, int threads, F fn) {
#ifdef __EMSCRIPTEN__
    threads = 1;
#endif
    threads = std::max(1, std::min(threads, n));
    if (threads == 1) {
        for (int i = 0; i < n; ++i) fn(i);
        return;
    }
#ifndef __EMSCRIPTEN__
    std::vector<std::thread> pool;
    for (int t = 0; t < threads; ++t)
        pool.emplace_back([&, t] {
            for (int i = t; i < n; i += threads) fn(i);
        });
    for (auto& th : pool) th.join();
#endif
}

// Whether an item shares a unique group (Last Whisper, Hydra...) with one already in the build.
bool clashes(const Library& lib, const std::vector<std::string>& items, const std::string& item) {
    const std::string& g = lib.items.at(item).group;
    if (g.empty()) return false;
    for (const auto& i : items)
        if (lib.items.at(i).group == g) return true;
    return false;
}

void combinations(int n, int k, int start, std::vector<int>& cur, std::vector<std::vector<int>>& out) {
    if (static_cast<int>(cur.size()) == k) { out.push_back(cur); return; }
    for (int i = start; i <= n - (k - static_cast<int>(cur.size())); ++i) {
        cur.push_back(i);
        combinations(n, k, i + 1, cur, out);
        cur.pop_back();
    }
}

struct ItemShortlist {
    std::string boots;                    // the best boots on their own
    std::vector<std::string> allBoots;    // every boots option that fits
    std::vector<std::string> pool;        // legendaries worth trying together
    Build greedy;                         // boots plus the best legendary added one slot at a time
};

// The quick search's first step: build greedily, one item at a time, and keep the runners-up.
ItemShortlist shortlistItems(const Library& lib, const ChampionKit& c, const Scenario& sc, int threads, Metric metric) {
    const OptimizerSettings& os = lib.optimizer;
    std::vector<std::string> boots, legendaries;
    const auto roles = fittingRoles(c);
    for (const auto& [k, e] : lib.items) {
        bool fits = !os.fittingItemsOnly;
        for (const auto& r : e.roles) fits |= std::find(roles.begin(), roles.end(), r) != roles.end();
        if (fits) (e.slot == "boots" ? boots : legendaries).push_back(k);
    }
    if (boots.empty() || static_cast<int>(legendaries.size()) < os.legendarySlots)
        throw std::runtime_error("not enough fitting items for " + c.name);
    const int screen = os.screenTrials * 3;

    // 1. Greedy: add the item that helps most, one slot at a time. Remember the
    //    runners-up at every step: they are the candidates for the full search.
    Build greedy;
    std::set<std::string> candidates;
    std::vector<double> sc1(std::max(boots.size(), legendaries.size()));
    parallelFor(static_cast<int>(boots.size()), threads,
                [&](int i) { sc1[i] = score(lib, c, Build{{boots[i]}, {}}, sc, screen, metric); });
    std::string bestBoots = boots[std::max_element(sc1.begin(), sc1.begin() + boots.size()) - sc1.begin()];
    greedy.items.push_back(bestBoots);
    auto addGreedily = [&](Build& g, Metric m) {
        for (int slot = 0; slot < os.legendarySlots; ++slot) {
            std::vector<std::pair<double, std::string>> scored(legendaries.size());
            parallelFor(static_cast<int>(legendaries.size()), threads, [&](int i) {
                Build b = g;
                if (std::find(b.items.begin(), b.items.end(), legendaries[i]) != b.items.end() ||
                    clashes(lib, b.items, legendaries[i])) {
                    scored[i] = {-1, legendaries[i]};
                    return;
                }
                b.items.push_back(legendaries[i]);
                scored[i] = {score(lib, c, b, sc, screen, m), legendaries[i]};
            });
            std::sort(scored.rbegin(), scored.rend());
            g.items.push_back(scored[0].second);
            const int keep = std::max(3, os.candidates / os.legendarySlots + 1);
            for (int i = 0; i < keep && i < static_cast<int>(scored.size()); ++i) candidates.insert(scored[i].second);
        }
    };
    addGreedily(greedy, metric);
    // Healing, mitigation and crowd control pile up the longer you stay alive, which a build of one or
    // two items can't show; the items that keep you up longest (most damage taken) are candidates too.
    Build sturdy{{bestBoots}, {}};
    if (metric == Metric::Healing || metric == Metric::Mitigated || metric == Metric::Cc) addGreedily(sturdy, Metric::Taken);
    std::vector<std::string> pool(candidates.begin(), candidates.end());
    // Keep the pool to the configured size, preferring the greedy picks.
    if (static_cast<int>(pool.size()) > os.candidates) {
        std::vector<std::string> trimmed(greedy.items.begin() + 1, greedy.items.end());
        for (const auto& p : std::vector<std::string>(sturdy.items.begin() + 1, sturdy.items.end()))
            if (std::find(trimmed.begin(), trimmed.end(), p) == trimmed.end()) trimmed.push_back(p);
        for (const auto& p : pool)
            if (static_cast<int>(trimmed.size()) < os.candidates &&
                std::find(trimmed.begin(), trimmed.end(), p) == trimmed.end())
                trimmed.push_back(p);
        pool = trimmed;
    }

    return {bestBoots, boots, pool, greedy};
}

}  // namespace

namespace {

// One build in the smart search, with its running total over fights [0, n).
struct Arm {
    Build build;
    double sum = 0;
    int n = 0;
    double mean() const { return n ? sum / n : -1; }
};

// Plays each arm's fights up to `trials` (only the ones it hasn't played yet), then sorts best first.
void race(const Library& lib, const ChampionKit& c, const Scenario& sc, std::vector<Arm>& arms, int trials,
          int threads, Metric metric) {
    parallelFor(static_cast<int>(arms.size()), threads, [&](int i) {
        Arm& a = arms[i];
        if (a.n >= trials) return;
        for (const auto& r : runTrials(lib, c, a.build, sc, static_cast<uint64_t>(a.n), trials - a.n)) a.sum += metricOf(r, metric);
        a.n = trials;
    });
    std::stable_sort(arms.begin(), arms.end(), [](const Arm& a, const Arm& b) { return a.mean() > b.mean(); });
}

std::vector<Ranked> smartOptimize(const Library& lib, const ChampionKit& c, const Scenario& sc, int threads, int top,
                                  Metric metric) {
    const OptimizerSettings& os = lib.optimizer;
    // The quick search's greedy pass gives the boots, the item shortlist and a starting build.
    Library wide = lib;
    wide.optimizer.smart = false;
    wide.optimizer.candidates = os.smartItems;
    const ItemShortlist sl = shortlistItems(wide, c, sc, threads, metric);
    const int screen = os.screenTrials * 3;

    // Augment shortlist: augments added greedily to the greedy build, one slot at a time (so
    // augments that only pay off together are found), keeping the runners-up at every step.
    const std::vector<std::string> augs = lib.augmentsFor(c);
    std::vector<std::string> augPool, topAugs;
    const int keepAugs = std::max(2, os.smartAugs / std::max(1, os.augmentSlots) + 1);
    for (int slot = 0; slot < os.augmentSlots && slot < static_cast<int>(augs.size()); ++slot) {
        std::vector<std::pair<double, std::string>> scored(augs.size());
        parallelFor(static_cast<int>(augs.size()), threads, [&](int i) {
            if (std::find(topAugs.begin(), topAugs.end(), augs[i]) != topAugs.end()) { scored[i] = {-1, augs[i]}; return; }
            Build b = sl.greedy;
            b.augments = topAugs;
            b.augments.push_back(augs[i]);
            scored[i] = {score(lib, c, b, sc, screen, metric), augs[i]};
        });
        std::sort(scored.rbegin(), scored.rend());
        topAugs.push_back(scored[0].second);
        for (int i = 0; i < keepAugs && i < static_cast<int>(scored.size()); ++i)
            if (scored[i].first >= 0 && std::find(augPool.begin(), augPool.end(), scored[i].second) == augPool.end())
                augPool.push_back(scored[i].second);
    }
    const int augK = static_cast<int>(topAugs.size());

    // Item sets: every combination of the shortlist, with the boots and the best single augments.
    std::vector<std::vector<int>> combos;
    std::vector<int> cur;
    combinations(static_cast<int>(sl.pool.size()), std::min(os.legendarySlots, static_cast<int>(sl.pool.size())), 0, cur, combos);
    std::vector<Arm> itemSets;
    for (const auto& combo : combos) {
        Build b{{sl.boots}, topAugs};
        bool ok = true;
        for (int j : combo) {
            if (clashes(lib, b.items, sl.pool[j])) { ok = false; break; }
            b.items.push_back(sl.pool[j]);
        }
        if (ok) itemSets.push_back({b});
    }
    race(lib, c, sc, itemSets, os.screenTrials, threads, metric);
    if (static_cast<int>(itemSets.size()) > os.smartItemSets) itemSets.resize(static_cast<size_t>(os.smartItemSets));

    // Augment sets: every combination of the augment shortlist, on the best item set.
    std::vector<std::vector<int>> augCombos;
    cur.clear();
    combinations(static_cast<int>(augPool.size()), augK, 0, cur, augCombos);
    std::vector<Arm> augSets;
    for (const auto& combo : augCombos) {
        Build b = itemSets.front().build;
        b.augments.clear();
        for (int j : combo) b.augments.push_back(augPool[j]);
        augSets.push_back({b});
    }
    race(lib, c, sc, augSets, os.screenTrials, threads, metric);
    if (static_cast<int>(augSets.size()) > os.smartAugSets) augSets.resize(static_cast<size_t>(os.smartAugSets));

    // Every shortlisted item set with every shortlisted augment set, plus every boots option on the
    // leading items, raced with successive halving. Fights 0..n are shared, so each round only adds new ones.
    std::vector<Arm> arms;
    std::set<std::pair<std::vector<std::string>, std::vector<std::string>>> seen;
    auto add = [&](const Build& b) { if (seen.insert({b.items, b.augments}).second) arms.push_back({b}); };
    for (const auto& is : itemSets)
        for (const auto& as : augSets) add(Build{is.build.items, as.build.augments});
    for (const auto& bt : sl.allBoots)
        for (const auto& as : augSets) {
            Build b{itemSets.front().build.items, as.build.augments};
            b.items[0] = bt;
            add(b);
        }
    // The quick search's best builds race too, so the smart search never does worse than it.
    Library quick = lib;
    quick.optimizer.smart = false;
    for (const auto& r : optimize(quick, c, sc, threads, os.smartFinalists, metric)) add(r.build);
    const int finalists = std::max(os.smartFinalists, top);
    for (int trials = os.smartStartTrials; static_cast<int>(arms.size()) > finalists && trials < os.smartFinalTrials;
         trials *= os.smartKeep) {
        race(lib, c, sc, arms, trials, threads, metric);
        arms.resize(static_cast<size_t>(std::max(finalists, static_cast<int>(arms.size()) / os.smartKeep)));
    }
    if (static_cast<int>(arms.size()) > finalists) arms.resize(static_cast<size_t>(finalists));
    std::vector<Ranked> ranked(arms.size());
    parallelFor(static_cast<int>(arms.size()), threads, [&](int i) {
        ranked[i] = {arms[i].build, summarize(runTrials(lib, c, arms[i].build, sc, 0, os.smartFinalTrials))};
    });
    std::sort(ranked.begin(), ranked.end(),
              [&](const Ranked& a, const Ranked& b) { return metricOf(a.summary, metric) > metricOf(b.summary, metric); });
    if (static_cast<int>(ranked.size()) > top) ranked.resize(static_cast<size_t>(top));
    return ranked;
}

}  // namespace

std::vector<Ranked> optimize(const Library& lib, const ChampionKit& c, const Scenario& sc, int threads, int top, Metric metric) {
    const OptimizerSettings& os = lib.optimizer;
    if (os.smart) return smartOptimize(lib, c, sc, threads, top, metric);
    const ItemShortlist sl = shortlistItems(lib, c, sc, threads, metric);
    const std::string& bestBoots = sl.boots;
    const std::vector<std::string>& boots = sl.allBoots;
    const std::vector<std::string>& pool = sl.pool;
    const int screen = os.screenTrials * 3;
    // 2. Every combination of the candidates, with the greedy boots.
    std::vector<std::vector<int>> combos;
    std::vector<int> cur;
    const int k = std::min(os.legendarySlots, static_cast<int>(pool.size()));
    combinations(static_cast<int>(pool.size()), k, 0, cur, combos);
    std::vector<std::pair<double, int>> results(combos.size());
    parallelFor(static_cast<int>(combos.size()), threads, [&](int i) {
        Build b{{bestBoots}, {}};
        for (int j : combos[i]) {
            if (clashes(lib, b.items, pool[j])) { results[i] = {-1, i}; return; }
            b.items.push_back(pool[j]);
        }
        results[i] = {score(lib, c, b, sc, os.screenTrials, metric), i};
    });
    std::sort(results.rbegin(), results.rend());

    // 3. Augments, greedily, on the best item build.
    Build best{{bestBoots}, {}};
    for (int j : combos[results[0].second]) best.items.push_back(pool[j]);
    std::vector<std::string> augs = lib.augmentsFor(c);
    std::vector<std::string> chosenAugs;
    for (int slot = 0; slot < os.augmentSlots && slot < static_cast<int>(augs.size()); ++slot) {
        std::vector<std::pair<double, std::string>> scored(augs.size());
        parallelFor(static_cast<int>(augs.size()), threads, [&](int i) {
            if (std::find(chosenAugs.begin(), chosenAugs.end(), augs[i]) != chosenAugs.end()) {
                scored[i] = {-1, augs[i]};
                return;
            }
            Build b = best;
            b.augments = chosenAugs;
            b.augments.push_back(augs[i]);
            scored[i] = {score(lib, c, b, sc, screen, metric), augs[i]};
        });
        std::sort(scored.rbegin(), scored.rend());
        chosenAugs.push_back(scored[0].second);
    }

    // 4. Finalists: the top item builds with those augments, every boots option on
    //    the leader, all re-run with many more fights.
    std::vector<Build> finalists;
    for (int i = 0; i < os.finalists && i < static_cast<int>(results.size()); ++i) {
        Build b{{bestBoots}, chosenAugs};
        for (int j : combos[results[i].second]) b.items.push_back(pool[j]);
        finalists.push_back(b);
    }
    for (const auto& bt : boots) {
        if (bt == bestBoots) continue;
        Build b = finalists.front();
        b.items[0] = bt;
        finalists.push_back(b);
    }
    std::vector<Ranked> ranked(finalists.size());
    parallelFor(static_cast<int>(finalists.size()), threads, [&](int i) {
        ranked[i] = {finalists[i], summarize(runTrials(lib, c, finalists[i], sc, 0, os.finalTrials))};
    });
    std::sort(ranked.begin(), ranked.end(),
              [&](const Ranked& a, const Ranked& b) { return metricOf(a.summary, metric) > metricOf(b.summary, metric); });
    if (static_cast<int>(ranked.size()) > top) ranked.resize(static_cast<size_t>(top));
    return ranked;
}

Build popularBuild(const Library& lib, const ChampionKit& champ) {
    Build b;
    if (!lib.enemyPool.isObject()) return b;
    for (const auto& e : lib.enemyPool["enemies"].arr) {
        if (static_cast<int>(e["champion_id"].asNumber(0)) != champ.championId) continue;
        for (const auto& x : e["build"]["items"].arr) b.items.push_back(x.asString());
        for (const auto& x : e["build"]["augments"].arr) b.augments.push_back(x.asString());
        break;
    }
    return b;
}

namespace {
// "Lulu:items=a+b:augs=c+d": how a champion is named in Library::enemyTeam.
std::string teamEntry(const TeamPick& m) {
    std::string s = m.first->id;
    auto add = [&](const char* key, const std::vector<std::string>& list) {
        if (list.empty()) return;
        s += std::string(":") + key + "=";
        for (size_t i = 0; i < list.size(); ++i) s += (i ? "+" : "") + list[i];
    };
    add("items", m.second.items);
    add("augs", m.second.augments);
    return s;
}
}  // namespace

std::vector<TeamPick> defaultEnemyTeam(const Library& lib, const std::vector<TeamPick>& allies) {
    std::vector<TeamPick> out;
    if (allies.empty()) return out;
    Library open = lib;
    open.enemyTeam.clear();
    std::vector<EnemyProfile> pool = open.scenarioFor(*allies.front().first).enemies;
    std::stable_sort(pool.begin(), pool.end(), [](const EnemyProfile& a, const EnemyProfile& b) { return a.weight > b.weight; });
    for (const auto& e : pool) {
        if (out.size() >= 5) break;
        bool mine = false;
        for (const auto& [k, b] : allies) mine = mine || k->championId == e.championId;
        const ChampionKit* k = lib.find(std::to_string(e.championId));
        if (mine || !k) continue;
        out.push_back({k, popularBuild(lib, *k)});
    }
    return out;
}

TeamResult runTeam(const Library& lib, const std::vector<TeamPick>& allies, const std::vector<TeamPick>& enemies, int trials) {
    TeamResult out;
    if (allies.empty() || enemies.empty() || trials <= 0) return out;
    for (const auto& [a, ab] : allies)
        for (const auto& [e, eb] : enemies)
            if (a->championId == e->championId) throw std::runtime_error(a->name + " can't be on both teams");
    // Every champion plays its own fight against the other team (the same model as a single
    // champion's fight, with those five as the enemies). That gives, fight by fight, how much
    // damage per second it deals to them and how much damage it takes before it goes down.
    struct Side {
        const std::vector<TeamPick>* picks;
        std::vector<TeamMember>* members;
        std::vector<std::vector<Result>> res;
    };
    Side sides[2] = {{&allies, &out.members, {}}, {&enemies, &out.foes, {}}};
    for (int s = 0; s < 2; ++s) {
        Library vs = lib;
        vs.enemyTeam.clear();
        for (const auto& m : *sides[1 - s].picks) vs.enemyTeam.push_back(teamEntry(m));
        for (const auto& [k, b] : *sides[s].picks) {
            TeamMember m;
            m.kit = k;
            m.build = b;
            m.scenario = vs.scenarioFor(*k);
            sides[s].res.push_back(runTrials(vs, *k, b, m.scenario, 0, trials));
            m.summary = summarize(sides[s].res.back());
            sides[s].members->push_back(std::move(m));
        }
        double sum = 0;
        for (const auto& m : *sides[s].members) sum += m.summary.meanDps;
        for (auto& m : *sides[s].members) m.share = sum > 0 ? m.summary.meanDps / sum : 0.0;
        (s ? out.enemyDps : out.teamDps) = sum;
    }
    // Then the teams trade that damage at once; a champion who's down deals no more, and a
    // side wins when the other has nobody left standing.
    // The champions' own fights count every hit on every enemy, so raw damage per second runs
    // far above what a teamfight's front line actually soaks. Both teams' damage is scaled by
    // the same factor, so the damage everyone takes per second is what it takes in its own
    // (real-game calibrated) fight: that sets how long fights last, not who wins them.
    double taken = 0, dealt = out.teamDps + out.enemyDps;
    for (const auto* list : {&out.members, &out.foes})
        for (const auto& m : *list) taken += m.summary.damageTakenPerSec;
    out.damageScale = dealt > 0 ? std::min(1.0, taken / dealt) : 1.0;
    // Each side's damage spreads over the other side's champions who are still up, in the
    // shares each takes of its team's damage in real games (front-liners soak the most).
    std::vector<double> soak[2];
    for (int s = 0; s < 2; ++s)
        for (const auto& m : *sides[s].members) soak[s].push_back(m.kit->hasCn ? std::max(0.02, m.kit->cnTakenShare) : 0.2);
    const double cap = 120;
    std::vector<double> lengths;
    std::vector<std::vector<TeamEvent>> timelines;
    std::vector<double> alive[2] = {std::vector<double>(out.members.size(), 0), std::vector<double>(out.foes.size(), 0)};
    std::vector<int> survived[2] = {std::vector<int>(out.members.size(), 0), std::vector<int>(out.foes.size(), 0)};
    double wins = 0;
    for (int t = 0; t < trials; ++t) {
        std::vector<double> hp[2], dps[2];
        std::vector<bool> up[2];
        for (int s = 0; s < 2; ++s)
            for (const auto& r : sides[s].res) {
                const Result& x = r[static_cast<size_t>(t)];
                dps[s].push_back(x.timeAlive > 0 ? out.damageScale * x.totalDamage / x.timeAlive : 0.0);
                hp[s].push_back(std::max(1.0, x.damageTaken + x.shielded));
                up[s].push_back(true);
            }
        std::vector<TeamEvent> events;
        double now = 0;
        auto standing = [&](int s) { return std::count(up[s].begin(), up[s].end(), true) > 0; };
        while (standing(0) && standing(1) && now < cap) {
            // Damage each champion still up takes per second right now.
            std::vector<double> in[2];
            double dt = cap - now;
            for (int s = 0; s < 2; ++s) {
                double rate = 0, w = 0;
                for (size_t i = 0; i < up[1 - s].size(); ++i) if (up[1 - s][i]) rate += dps[1 - s][i];
                for (size_t i = 0; i < up[s].size(); ++i) if (up[s][i]) w += soak[s][i];
                in[s].assign(up[s].size(), 0.0);
                for (size_t i = 0; i < up[s].size(); ++i)
                    if (up[s][i] && w > 0) {
                        in[s][i] = rate * soak[s][i] / w;
                        if (in[s][i] > 0) dt = std::min(dt, hp[s][i] / in[s][i]);
                    }
            }
            now += dt;
            for (int s = 0; s < 2; ++s)
                for (size_t i = 0; i < up[s].size(); ++i) {
                    if (!up[s][i]) continue;
                    hp[s][i] -= in[s][i] * dt;
                    if (hp[s][i] <= 1e-6 * std::max(1.0, in[s][i])) {
                        up[s][i] = false;
                        alive[s][i] += now;
                        events.push_back({now, s, i});
                    }
                }
        }
        for (int s = 0; s < 2; ++s)
            for (size_t i = 0; i < up[s].size(); ++i)
                if (up[s][i]) {
                    alive[s][i] += now;
                    survived[s][i] += 1;
                }
        const bool won = standing(0) && !standing(1), lost = !standing(0) && standing(1);
        wins += won ? 1.0 : lost ? 0.0 : 0.5;
        lengths.push_back(now);
        timelines.push_back(std::move(events));
    }
    out.winRate = wins / trials;
    std::vector<double> sorted = lengths;
    std::nth_element(sorted.begin(), sorted.begin() + static_cast<long>(sorted.size() / 2), sorted.end());
    out.fightLength = sorted[sorted.size() / 2];
    // A typical fight to show: the median-length one.
    size_t pick = 0;
    for (size_t t = 0; t < lengths.size(); ++t)
        if (std::abs(lengths[t] - out.fightLength) < std::abs(lengths[pick] - out.fightLength)) pick = t;
    out.timeline = timelines[pick];
    for (int s = 0; s < 2; ++s) {
        auto& m = s ? out.foes : out.members;
        for (size_t i = 0; i < m.size(); ++i) {
            m[i].teamTimeAlive = alive[s][i] / trials;
            m[i].teamSurvival = static_cast<double>(survived[s][i]) / trials;
        }
    }
    return out;
}

}  // namespace mayhem
