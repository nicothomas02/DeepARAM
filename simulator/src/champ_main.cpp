// Command-line front end for the all-champion simulator.
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "champ.hpp"

#ifndef MAYHEM_DEFAULT_RULES
#define MAYHEM_DEFAULT_RULES "data/mayhem_rules.json"
#endif

using namespace mayhem;

namespace {

void usage() {
    std::cout <<
R"(ARAM Mayhem all-champion simulator

Usage: mayhem_sim [options]

  --champ NAME        champion to simulate (name or id, e.g. Ahri, MissFortune, 103)
  --items a,b,...     simulate this build instead of searching for the best one
  --augs a,b,...      augments for --items
  --all               find the best build for every champion and compare with
                      real-game damage shares
  --kit NAME          show what the simulator read from a champion's abilities
  --any-items         search every item, not just ones that fit the champion
  --search MODE       quick (the default) or smart: a wider search of items and
                      augments together that races the builds and keeps the best,
                      about 3x slower (optimizer.smart in the rules file)
  --list              list champions, items and augments
  --trials N          fights per build in the final comparison
  --seed N            RNG seed
  --threads N         worker threads (default: all cores)
  --rules PATH        rules file (default )" MAYHEM_DEFAULT_RULES R"()
  --game-data DIR     champions, items and augments from DIR instead of next to the
                      rules file (data/pbe: the PBE patch)
  --json              print results as JSON
  --trace FILE        with --champ: also write one typical fight (the median-DPS
                      one of 200) of the best or given build, for the animated replay
  --trace-dir DIR     with --all: write a replay trace for every champion's best build
  --set k=v,k=v       change fight or model settings (--list --json shows them all),
                      e.g. --set level=13,fight_mean=12,enemy_damage_scale=1.5
  --team a,b,...      fight exactly these enemy champions; change one's stats with
                      Name:hp=5000:armor=250 (hp, armor, mr, damage_share, phys_share,
                      cc, damage_taken); add items and augments with
                      Name:items=warmogs+thornmail:augs=goliath (their HP, armor, MR)
  --allies a,b,c,d    with --champ: a 5v5 with these four allies (each with its most
                      popular build, or Name:items=a+b:augs=c+d); --items/--augs set
                      yours (default: your most popular build); --team names the five
                      enemies the same way (default: the five most likely enemies)
  --combo EQRW        with --champ: cast order when several abilities are ready
                      (default: the champion's recommended combo, data/combos.json)
  --metric M          what the build search ranks by: damage (per second, the default), or per
                      fight taken (damage taken), mitigated, healing, or cc (seconds dealt)
  --list --json       champions, items, augments, settings and the enemy pool as JSON
  --help              show this help
)";
}

std::vector<std::string> splitList(const std::string& s) {
    std::vector<std::string> out;
    std::stringstream ss(s);
    std::string part;
    while (std::getline(ss, part, ','))
        if (!part.empty()) out.push_back(part);
    return out;
}

std::string join(const std::vector<std::string>& v, const char* sep = ", ") {
    std::string out;
    for (size_t i = 0; i < v.size(); ++i) out += (i ? sep : "") + v[i];
    return out;
}

std::string jsonStr(const std::string& s) {
    std::string out = "\"";
    for (char ch : s) {
        if (ch == '"' || ch == '\\') out += '\\';
        out += ch;
    }
    return out + "\"";
}

std::string buildNames(const Library& lib, const Build& b) {
    std::vector<std::string> items, augs;
    for (const auto& i : b.items) items.push_back(lib.items.at(i).name);
    for (const auto& a : b.augments) augs.push_back(lib.augments.at(a).name);
    return join(items) + (augs.empty() ? "" : " | " + join(augs));
}

std::string buildJson(const Build& b) {
    std::string s = "{\"items\": [";
    for (size_t i = 0; i < b.items.size(); ++i) s += (i ? ", " : "") + jsonStr(b.items[i]);
    s += "], \"augments\": [";
    for (size_t i = 0; i < b.augments.size(); ++i) s += (i ? ", " : "") + jsonStr(b.augments[i]);
    return s + "]}";
}

std::string summaryJson(const Summary& s);

std::string num(double v) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.3f", v);
    std::string s = buf;
    while (s.back() == '0') s.pop_back();
    if (s.back() == '.') s.pop_back();
    return s == "-0" ? "0" : s;
}

// The fight with the median DPS (or the chosen measure) out of the first 200, so a replay shows a typical fight.
// Among the few fights nearest the median, the first where the ultimate is cast wins, so a replay shows it.
FightTrace typicalFight(const Library& lib, const ChampionKit& c, const Build& b, const Scenario& sc, Metric metric,
                        uint64_t& trial) {
    const auto res = runTrials(lib, c, b, sc, 0, 200);
    std::vector<std::pair<double, size_t>> dps;
    for (size_t i = 0; i < res.size(); ++i) dps.push_back({metricOf(res[i], metric), i});
    std::sort(dps.begin(), dps.end());
    const size_t mid = dps.size() / 2;
    bool hasR = false;
    for (const auto& a : c.abilities) hasR = hasR || a.slot == 'R';
    FightTrace first;
    for (size_t k = 0; k < (hasR ? 9u : 1u) && k <= 2 * mid; ++k) {
        const size_t at = k % 2 ? mid + (k + 1) / 2 : mid - k / 2;
        if (at >= dps.size()) continue;
        FightTrace tr = traceFight(lib, c, b, sc, dps[at].second);
        if (k == 0) trial = dps[at].second;
        bool r = !hasR;
        for (const auto& e : tr.events) r = r || (e.kind == "cast" && e.slot == 'R');
        if (r) { trial = dps[at].second; return tr; }
        if (k == 0) first = std::move(tr);
    }
    return first;
}

// Writes a fight trace for the replay viewer (viewer/). Short keys keep the files small.
bool writeTrace(const Library& lib, const ChampionKit& c, const Build& b, const Scenario& sc, const Summary& summary,
                const std::string& path, Metric metric = Metric::Damage) {
    uint64_t trial = 0;
    const FightTrace tr = typicalFight(lib, c, b, sc, metric, trial);
    std::ostringstream o;
    o << "{\"champion\": " << jsonStr(c.id) << ", \"name\": " << jsonStr(c.name) << ", \"key\": " << c.championId
      << ", \"role\": " << jsonStr(c.role) << ", \"ranged\": " << (c.ranged ? "true" : "false")
      << ", \"range\": " << num(c.attackRange) << ", \"parse_quality\": " << jsonStr(c.parseQuality);
    o << ",\n \"build\": {\"items\": [";
    for (size_t i = 0; i < b.items.size(); ++i)
        o << (i ? ", " : "") << "{\"key\": " << jsonStr(b.items[i]) << ", \"id\": " << lib.items.at(b.items[i]).id
          << ", \"name\": " << jsonStr(lib.items.at(b.items[i]).name) << "}";
    o << "], \"augments\": [";
    for (size_t i = 0; i < b.augments.size(); ++i)
        o << (i ? ", " : "") << "{\"key\": " << jsonStr(b.augments[i]) << ", \"id\": " << lib.augments.at(b.augments[i]).id << ", \"name\": "
          << jsonStr(lib.augments.at(b.augments[i]).name) << ", \"rarity\": " << jsonStr(lib.augments.at(b.augments[i]).rarity) << "}";
    o << "]},\n \"abilities\": [";
    for (size_t i = 0; i < c.abilities.size(); ++i) {
        const Ability& a = c.abilities[i];
        o << (i ? ", " : "") << "{\"slot\": \"" << a.slot << "\", \"name\": " << jsonStr(a.name)
          << ", \"cooldown\": " << num(a.cooldown);
        if (i < tr.cooldowns.size()) o << ", \"build_cooldown\": " << num(tr.cooldowns[i]);
        o << ", \"passive\": " << (a.aura || a.onhitEvery > 0 ? "true" : "false")
          << ", \"range\": " << num(a.geo.range) << ", \"radius\": " << num(a.geo.radius)
          << ", \"width\": " << num(a.geo.width) << ", \"angle\": " << num(a.geo.angle)
          << ", \"speed\": " << num(a.geo.speed) << "}";
    }
    o << "],\n \"summary\": " << summaryJson(summary);
    o << ",\n \"fight\": {\"trial\": " << trial << ", \"seed\": " << sc.seed << ", \"duration\": " << num(tr.result.duration)
      << ", \"engage_at\": " << num(tr.engageAt) << ", \"max_hp\": " << num(tr.maxHp)
      << ", \"died\": " << (tr.result.died ? "true" : "false") << ", \"time_alive\": " << num(tr.result.timeAlive)
      << ", \"total_damage\": " << num(tr.result.totalDamage) << ", \"damage_taken\": " << num(tr.result.damageTaken)
      << ", \"damage_mitigated\": " << num(tr.result.mitigated) << ", \"healing\": " << num(tr.result.healed)
      << ", \"cc_seconds\": " << num(tr.result.ccDealt) << ", \"kills\": " << tr.result.kills << ", \"team\": [";
    for (size_t i = 0; i < tr.team.size(); ++i) o << (i ? ", " : "") << jsonStr(tr.team[i]);
    o << "]},\n \"sources\": [";
    for (int i = 0; i < SrcCount; ++i) o << (i ? ", " : "") << jsonStr(kSourceNames[i]);
    o << "],\n \"events\": [";
    for (size_t i = 0; i < tr.events.size(); ++i) {
        const TraceEvent& e = tr.events[i];
        o << (i ? ",\n  " : "\n  ") << "{\"t\": " << num(e.t) << ", \"k\": \"" << e.kind << "\"";
        if (e.target >= 0) o << ", \"u\": " << e.target;
        if (e.slot) o << ", \"s\": \"" << e.slot << "\"";
        if (!e.text.empty()) o << ", \"x\": " << jsonStr(e.text);
        if (e.source >= 0) o << ", \"src\": " << e.source;
        if (e.amount != 0) o << ", \"a\": " << num(e.amount);
        if (e.lock > 0) o << ", \"l\": " << num(e.lock);
        if (!e.who.empty()) o << ", \"c\": " << jsonStr(e.who);
        if (e.kind == "spawn" || e.kind == "damage" || e.kind == "kill" || e.kind == "self" || e.kind == "death")
            o << ", \"hp\": " << num(e.hp) << ", \"max\": " << num(e.maxHp);
        if (e.shield > 0) o << ", \"sh\": " << num(e.shield);
        if (e.kind == "self" || e.kind == "death") o << ", \"tk\": " << std::lround(e.taken) << ", \"mt\": " << std::lround(e.mitigated);
        if (e.total > 0) o << ", \"tot\": " << num(e.total);
        if (e.flag) o << ", \"f\": 1";
        if (e.kind == "cast" || e.kind == "poro") o << ", \"ax\": " << std::lround(e.x) << ", \"ay\": " << std::lround(e.y) << ", \"fl\": " << num(e.flight);
        if (!e.pos.empty()) {
            o << ", \"p\": [";  // uid, x, y for everyone standing; uid -1 is the champion
            for (size_t j = 0; j < e.pos.size(); ++j) o << (j ? "," : "") << std::lround(e.pos[j]);
            o << "]";
        }
        o << "}";
    }
    o << "\n]}\n";
    std::FILE* f = std::fopen(path.c_str(), "w");
    if (!f) { std::cerr << "cannot write " << path << "\n"; return false; }
    const std::string out = o.str();
    std::fwrite(out.data(), 1, out.size(), f);
    std::fclose(f);
    return true;
}

std::string summaryJson(const Summary& s) {
    char buf[768];
    std::snprintf(buf, sizeof buf,
                  "{\"mean_dps\": %.1f, \"ci95\": %.1f, \"p5\": %.1f, \"median\": %.1f, \"p95\": %.1f, "
                  "\"single_target_dps\": %.1f, \"kills_per_minute\": %.3f, \"survival_rate\": %.4f, "
                  "\"time_alive\": %.2f, \"damage_taken_per_s\": %.1f, \"dps_short_fight\": %.1f, \"dps_long_fight\": %.1f, "
                  "\"damage_taken\": %.0f, \"damage_mitigated\": %.0f, \"healing\": %.0f, \"cc_seconds\": %.2f, \"share_by_source\": {",
                  s.meanDps, s.ci95, s.p5, s.median, s.p95, s.singleTargetDps, s.killsPerMinute, s.survivalRate,
                  s.meanTimeAlive, s.damageTakenPerSec, s.shortDps, s.longDps, s.damageTaken, s.damageMitigated, s.healing,
                  s.ccSeconds);
    std::string out = buf;
    for (int i = 0; i < SrcCount; ++i) {
        std::snprintf(buf, sizeof buf, "%s\"%s\": %.4f", i ? ", " : "", kSourceNames[i], s.shareBySource[i]);
        out += buf;
    }
    return out + "}}";
}

void printKit(const ChampionKit& c) {
    std::printf("%s (%s, %s, parse quality: %s)\n", c.name.c_str(), c.role.c_str(), c.ranged ? "ranged" : "melee",
                c.parseQuality.c_str());
    std::printf("Mayhem: damage dealt x%.2f, taken x%.2f, ability haste %+.0f, attack speed %+.1f%%\n", c.damageDealt,
                c.damageTaken, c.mayhemAh, c.mayhemAs * 100);
    if (c.hasCn)
        std::printf("Real Mayhem games: %.1f%% of team damage, %.1f%% of damage taken, %.1f%% win rate\n",
                    c.cnDamageShare * 100, c.cnTakenShare * 100, c.cnWinRate * 100);
    for (const auto& a : c.abilities) {
        std::printf("  %c %-28s cd %5.1fs  %s%s\n", a.slot, a.name.c_str(), a.cooldown,
                    a.area == Area::Aoe ? "area" : a.area == Area::Line ? "line" : "single target",
                    a.aura ? ", always on" : "");
        for (const auto& h : a.hits) {
            std::string scale;
            for (const auto& [k, v] : h.scaling) {
                char b[64];
                std::snprintf(b, sizeof b, "%s%g %s", scale.empty() ? "" : " + ", v, k == "const" ? "" : k.c_str());
                scale += b;
            }
            const char* type = h.type == DamageType::Physical ? "physical" : h.type == DamageType::Magic ? "magic" : "true";
            const char* tgt = h.target == HitTarget::MaxHp       ? " x target max HP"
                              : h.target == HitTarget::CurrentHp ? " x target current HP"
                              : h.target == HitTarget::MissingHp ? " x target missing HP"
                                                                 : "";
            std::printf("      %-8s %s%s%s  (weight %.2f)\n", type, scale.c_str(), tgt, h.perSecond ? " per second" : "",
                        h.weight);
        }
    }
}

void printRanked(const Library& lib, const ChampionKit& c, const std::vector<Ranked>& ranked) {
    std::printf("\n%s: best builds (mean DPS over the whole fight; dying early counts against a build)\n\n",
                c.name.c_str());
    std::printf("%-4s %7s %6s %7s %8s  %s\n", "#", "DPS", "+-95%", "Kills/m", "Survives", "Build");
    int i = 0;
    for (const auto& r : ranked) {
        std::printf("%-4d %7.0f %6.0f %7.2f %7.0f%%  %s\n", ++i, r.summary.meanDps, r.summary.ci95,
                    r.summary.killsPerMinute, r.summary.survivalRate * 100, buildNames(lib, r.build).c_str());
    }
    if (!ranked.empty()) {
        std::printf("\nDamage by source for #1:");
        for (int s = 0; s < SrcCount; ++s)
            if (ranked[0].summary.shareBySource[s] > 0.005)
                std::printf("  %s %.0f%%", kSourceNames[s], ranked[0].summary.shareBySource[s] * 100);
        std::printf("\n");
    }
}

double spearman(std::vector<double> a, std::vector<double> b) {
    auto ranks = [](const std::vector<double>& v) {
        std::vector<size_t> idx(v.size());
        for (size_t i = 0; i < idx.size(); ++i) idx[i] = i;
        std::sort(idx.begin(), idx.end(), [&](size_t x, size_t y) { return v[x] < v[y]; });
        std::vector<double> r(v.size());
        for (size_t i = 0; i < idx.size(); ++i) r[idx[i]] = static_cast<double>(i);
        return r;
    };
    const auto ra = ranks(a), rb = ranks(b);
    const double n = static_cast<double>(a.size());
    double d2 = 0;
    for (size_t i = 0; i < a.size(); ++i) d2 += (ra[i] - rb[i]) * (ra[i] - rb[i]);
    return 1.0 - 6.0 * d2 / (n * (n * n - 1.0));
}

}  // namespace

int main(int argc, char** argv) {
    std::string rulesPath = MAYHEM_DEFAULT_RULES, gameDir, champName, kitName;
    std::vector<std::string> items, augs;
    bool all = false, asJson = false, list = false, customBuild = false, anyItems = false, smartSearch = false;
    std::string tracePath, traceDir, combo;
    Metric metric = Metric::Damage;
    Library::Settings settings;
    std::vector<std::string> team, allies;
    int trials = 0;
    long long seed = -1;
#ifdef __EMSCRIPTEN__
    int threads = 1;
#else
    int threads = static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
#endif
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc) { std::cerr << a << " needs a value\n"; std::exit(2); }
            return argv[++i];
        };
        if (a == "--help" || a == "-h") { usage(); return 0; }
        else if (a == "--rules") rulesPath = next();
        else if (a == "--game-data") gameDir = next();
        else if (a == "--champ") champName = next();
        else if (a == "--kit") kitName = next();
        else if (a == "--items") { items = splitList(next()); customBuild = true; }
        else if (a == "--augs") augs = splitList(next());
        else if (a == "--all") all = true;
        else if (a == "--any-items") anyItems = true;
        else if (a == "--search") {
            const std::string m = next();
            if (m != "quick" && m != "smart") { std::cerr << "--search must be quick or smart, got " << m << "\n"; return 2; }
            smartSearch = m == "smart";
        }
        else if (a == "--list") list = true;
        else if (a == "--json") asJson = true;
        else if (a == "--trace") tracePath = next();
        else if (a == "--trace-dir") traceDir = next();
        else if (a == "--team") team = splitList(next());
        else if (a == "--allies") allies = splitList(next());
        else if (a == "--combo") combo = next();
        else if (a == "--metric") {
            const std::string m = next();
            if (!parseMetric(m, metric)) { std::cerr << "--metric must be damage, taken, mitigated, healing or cc, got " << m << "\n"; return 2; }
        }
        else if (a == "--set") {
            for (const auto& kv : splitList(next())) {
                const auto eq = kv.find('=');
                if (eq == std::string::npos) { std::cerr << "--set needs key=value, got " << kv << "\n"; return 2; }
                try {
                    settings[kv.substr(0, eq)] = std::stod(kv.substr(eq + 1));
                } catch (...) { std::cerr << "--set " << kv << ": not a number\n"; return 2; }
            }
        }
        else if (a == "--trials" || a == "--seed" || a == "--threads") {
            const std::string v = next();
            long long n = 0;
            try {
                size_t used = 0;
                n = std::stoll(v, &used);
                if (used != v.size() || n < 0 || (a != "--seed" && n > 100000000)) throw std::out_of_range(v);
            } catch (...) { std::cerr << a << " " << v << ": not a number in range\n"; return 2; }
            if (a == "--trials") trials = static_cast<int>(n);
            else if (a == "--seed") seed = n;
            else threads = std::max(1, static_cast<int>(n));
        }
        else { std::cerr << "unknown option " << a << "\n"; usage(); return 2; }
    }

    Library lib;
    try {
        lib = Library::load(rulesPath, settings, gameDir);
        lib.enemyTeam = team;
        if (!combo.empty()) {
            if (champName.empty()) throw std::runtime_error("--combo needs --champ");
            const ChampionKit* c = lib.find(champName);
            if (c) Library::setCombo(lib.champions[static_cast<size_t>(c - lib.champions.data())], combo);
        }
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
    if (trials > 0) lib.optimizer.finalTrials = lib.optimizer.smartFinalTrials = trials;
    if (anyItems) lib.optimizer.fittingItemsOnly = false;
    lib.optimizer.smart = smartSearch;
    if (seed >= 0) lib.scenario.seed = static_cast<uint64_t>(seed);

    if (list && asJson) {
        std::printf("{\"champions\": [");
        for (size_t i = 0; i < lib.champions.size(); ++i) {
            const auto& c = lib.champions[i];
            std::string pool;
            for (const auto& a : lib.augmentsFor(c, false)) pool += (pool.empty() ? "" : ", ") + jsonStr(a);
            std::printf("%s{\"id\": %s, \"key\": %d, \"name\": %s, \"role\": %s, \"ranged\": %s, \"combo\": %s, \"augments\": [%s]}",
                        i ? ", " : "", jsonStr(c.id).c_str(), c.championId, jsonStr(c.name).c_str(), jsonStr(c.role).c_str(),
                        c.ranged ? "true" : "false", jsonStr(c.combo).c_str(), pool.c_str());
        }
        auto effects = [&](const std::map<std::string, Effect>& m) {
            bool first = true;
            for (const auto& [k, e] : m) {
                std::string roles;
                for (size_t i = 0; i < e.roles.size(); ++i) roles += (i ? ", " : "") + jsonStr(e.roles[i]);
                std::printf("%s{\"key\": %s, \"id\": %d, \"name\": %s, \"slot\": %s, \"rarity\": %s, \"roles\": [%s], \"modeled\": %s%s}",
                            first ? "" : ", ", jsonStr(k).c_str(), e.id, jsonStr(e.name).c_str(), jsonStr(e.slot).c_str(),
                            jsonStr(e.rarity).c_str(), roles.c_str(), e.stats.empty() && e.effects.empty() ? "false" : "true",
                            e.group.empty() ? "" : (", \"group\": " + jsonStr(e.group)).c_str());
                first = false;
            }
        };
        std::printf("],\n \"items\": [");
        effects(lib.items);
        std::printf("],\n \"augments\": [");
        effects(lib.augments);
        const Scenario& sc = lib.scenario;
        const Rules& r = lib.rules;
        const auto dummy = lib.averageEnemy(sc.enemyLevel);
        const std::map<std::string, double> defaults = {
            {"level", sc.level}, {"enemy_level", sc.enemyLevel}, {"fight_mean", sc.fightMean}, {"fight_sd", sc.fightSd}, {"fight_min", sc.fightMin},
            {"fight_max", sc.fightMax}, {"engage_min", sc.engageMin}, {"engage_max", sc.engageMax},
            {"until_death", sc.untilDeath ? 1.0 : 0.0}, {"on_fire", sc.onFire ? 1.0 : 0.0},
            {"random_respawn", sc.randomRespawn ? 1.0 : 0.0}, {"fight_cap", sc.fightCap},
            {"team_size", sc.teamSizeRule > 0 ? sc.teamSizeRule : 5},
            {"enemy_damage_scale", 1}, {"cc_scale", 1}, {"cc_min", sc.ccMin}, {"cc_max", sc.ccMax},
            {"start_distance", sc.startDistance}, {"enemy_spread", sc.enemySpread}, {"r_ready_chance", sc.rReadyChance},
            {"retarget_delay", sc.retargetDelay}, {"fixed_target", 0}, {"target_hp", dummy[0]},
            {"target_armor", dummy[1]}, {"target_mr", dummy[2]}, {"dodge_chance", r.dodgeChance},
            {"reaction_time", r.reactionTime}, {"aim_lead", r.aimLead}, {"combo_order", r.comboOrder}};
        std::printf("],\n \"settings\": [");
        bool first = true;
        for (const auto& [k, desc] : Library::settingKeys()) {
            std::printf("%s{\"key\": %s, \"default\": %s, \"description\": %s}", first ? "" : ", ", jsonStr(k).c_str(),
                        num(defaults.at(k)).c_str(), jsonStr(desc).c_str());
            first = false;
        }
        std::printf("],\n \"enemies\": [");
        Scenario pool = lib.scenario;
        if (lib.enemyPool.isObject()) pool.applyEnemyPool(lib.enemyPool);
        for (auto& e : pool.enemies) lib.equipEnemy(e, pool.enemyLevel);
        auto names = [](const std::vector<std::string>& v) {
            std::string o = "[";
            for (size_t j = 0; j < v.size(); ++j) o += (j ? ", " : "") + jsonStr(v[j]);
            return o + "]";
        };
        for (size_t i = 0; i < pool.enemies.size(); ++i) {
            const auto& e = pool.enemies[i];
            const auto it = lib.mayhemDamageTaken.find(e.championId);
            std::printf("%s{\"id\": %s, \"name\": %s, \"weight\": %s, \"hp\": %s, \"armor\": %s, \"mr\": %s, "
                        "\"damage_share\": %s, \"phys_share\": %s, \"cc\": %s, \"damage_taken\": %s, \"items\": %s, "
                        "\"augments\": %s, \"damage_power\": %s}",
                        i ? ", " : "", jsonStr(e.id).c_str(), jsonStr(e.name).c_str(), num(e.weight).c_str(),
                        num(e.hp).c_str(), num(e.armor).c_str(), num(e.mr).c_str(), num(e.damageShare).c_str(),
                        num(e.physShare).c_str(), num(e.cc).c_str(),
                        num(it != lib.mayhemDamageTaken.end() ? it->second : e.damageTaken).c_str(),
                        names(e.items).c_str(), names(e.augments).c_str(), num(e.power).c_str());
        }
        std::printf("]}\n");
        return 0;
    }
    if (list) {
        std::printf("Champions (%zu):\n", lib.champions.size());
        for (const auto& c : lib.champions) std::printf("  %-14s %-9s parse %s\n", c.id.c_str(), c.role.c_str(), c.parseQuality.c_str());
        std::printf("\nItems:\n");
        for (const auto& [k, e] : lib.items) std::printf("  %-20s %-30s %s\n", k.c_str(), e.name.c_str(), e.confidence.c_str());
        std::printf("\nAugments:\n");
        for (const auto& [k, e] : lib.augments) std::printf("  %-20s %-22s %-9s %s\n", k.c_str(), e.name.c_str(), e.rarity.c_str(), e.confidence.c_str());
        return 0;
    }
    if (!kitName.empty()) {
        const ChampionKit* c = lib.find(kitName);
        if (!c) { std::cerr << "unknown champion " << kitName << "\n"; return 2; }
        printKit(*c);
        return 0;
    }

    try {
        if (!champName.empty()) {
            const ChampionKit* c = lib.find(champName);
            if (!c) { std::cerr << "unknown champion " << champName << "\n"; return 2; }
            if (!allies.empty()) {
                // "Lulu" or "Lulu:items=a+b:augs=c+d", each with its most popular build unless given.
                auto pickOf = [&](const std::string& entry) {
                    std::vector<std::string> parts;
                    std::stringstream ss(entry);
                    for (std::string p; std::getline(ss, p, ':');) parts.push_back(p);
                    const ChampionKit* k = parts.empty() ? nullptr : lib.find(parts[0]);
                    if (!k) throw std::runtime_error("unknown champion '" + entry + "'");
                    Build b = popularBuild(lib, *k);
                    for (size_t j = 1; j < parts.size(); ++j) {
                        const auto eq = parts[j].find('=');
                        const std::string key = parts[j].substr(0, eq), val = eq == std::string::npos ? "" : parts[j].substr(eq + 1);
                        std::vector<std::string> list;
                        std::stringstream vs(val);
                        for (std::string x; std::getline(vs, x, '+');) if (!x.empty()) list.push_back(x);
                        if (key == "items") b.items = list;
                        else if (key == "augs") b.augments = list;
                        else throw std::runtime_error(k->name + ": use items= or augs=");
                    }
                    lib.validate(b);
                    return TeamPick{k, b};
                };
                std::vector<TeamPick> mine, theirs;
                Build own = customBuild ? Build{items, augs} : popularBuild(lib, *c);
                lib.validate(own);
                mine.push_back({c, own});
                for (const auto& entry : allies) mine.push_back(pickOf(entry));
                for (const auto& entry : team) theirs.push_back(pickOf(entry));
                // Mayhem has no duplicate champions on a team.
                for (const auto* side : {&mine, &theirs})
                    for (size_t x = 0; x < side->size(); ++x)
                        for (size_t y = x + 1; y < side->size(); ++y)
                            if ((*side)[x].first == (*side)[y].first)
                                throw std::runtime_error((*side)[x].first->name + " is on the same team twice");
                lib.enemyTeam.clear();
                if (theirs.empty()) theirs = defaultEnemyTeam(lib, mine);
                const int n = trials > 0 ? trials : 300;
                const TeamResult tr = runTeam(lib, mine, theirs, n);
                if (!tracePath.empty() &&
                    !writeTrace(lib, *c, tr.members.front().build, tr.members.front().scenario, tr.members.front().summary, tracePath))
                    return 1;
                if (asJson) {
                    std::printf("{\"mode\": \"team\", \"win_rate\": %.4f, \"fight_length\": %.2f, \"team_dps\": %.1f, \"enemy_dps\": %.1f",
                                tr.winRate, tr.fightLength, tr.teamDps, tr.enemyDps);
                    for (int s = 0; s < 2; ++s) {
                        const auto& list = s ? tr.foes : tr.members;
                        std::printf(", \"%s\": [", s ? "enemies" : "members");
                        for (size_t i = 0; i < list.size(); ++i) {
                            const auto& m = list[i];
                            std::printf("%s{\"champion\": %s, \"name\": %s, \"role\": %s, \"share\": %.4f, \"time_alive\": %.2f, "
                                        "\"survival\": %.4f, \"build\": %s, \"summary\": %s}",
                                        i ? ", " : "", jsonStr(m.kit->id).c_str(), jsonStr(m.kit->name).c_str(),
                                        jsonStr(m.kit->role).c_str(), m.share, m.teamTimeAlive, m.teamSurvival,
                                        buildJson(m.build).c_str(), summaryJson(m.summary).c_str());
                        }
                        std::printf("]");
                    }
                    std::printf(", \"timeline\": [");
                    for (size_t i = 0; i < tr.timeline.size(); ++i) {
                        const auto& e = tr.timeline[i];
                        const auto& who = (e.side ? tr.foes : tr.members)[e.index];
                        std::printf("%s{\"t\": %.2f, \"side\": \"%s\", \"champion\": %s}", i ? ", " : "", e.t,
                                    e.side ? "enemy" : "ally", jsonStr(who.kit->id).c_str());
                    }
                    std::printf("]}\n");
                } else {
                    std::printf("5v5: your team wins %.0f%% of fights; a fight lasts %.1f s (median).\n", tr.winRate * 100,
                                tr.fightLength);
                    std::printf("Your team deals %.0f damage per second, the enemy team %.0f.\n", tr.teamDps, tr.enemyDps);
                    for (int s = 0; s < 2; ++s) {
                        std::printf("\n%s\n", s ? "Enemy team" : "Your team");
                        for (const auto& m : s ? tr.foes : tr.members)
                            std::printf("  %-14s %6.0f DPS %5.1f%% of the team's damage, standing %4.1f s, survives %3.0f%%  %s\n",
                                        m.kit->id.c_str(), m.summary.meanDps, m.share * 100, m.teamTimeAlive,
                                        m.teamSurvival * 100, buildNames(lib, m.build).c_str());
                    }
                    std::printf("\nA typical fight:");
                    for (const auto& e : tr.timeline)
                        std::printf(" %.1fs %s%s;", e.t, e.side ? "enemy " : "", (e.side ? tr.foes : tr.members)[e.index].kit->id.c_str());
                    std::printf("\n");
                }
                return 0;
            }
            const Scenario sc = lib.scenarioFor(*c);
            std::vector<Ranked> ranked;
            if (customBuild) {
                Build b{items, augs};
                lib.validate(b);
                const int n = lib.optimizer.finalTrials;
#ifdef __EMSCRIPTEN__
                // No threads in the browser build: the page runs the simulator in a Web Worker.
                const std::vector<Result> res = runTrials(lib, *c, b, sc, 0, n);
#else
                std::vector<Result> res(static_cast<size_t>(n));
                std::vector<std::thread> pool;
                const int t = std::max(1, std::min(threads, n));
                for (int w = 0; w < t; ++w)
                    pool.emplace_back([&, w] {
                        const int from = n * w / t, to = n * (w + 1) / t;
                        auto part = runTrials(lib, *c, b, sc, static_cast<uint64_t>(from), to - from);
                        std::copy(part.begin(), part.end(), res.begin() + from);
                    });
                for (auto& th : pool) th.join();
#endif
                ranked.push_back({b, summarize(res)});
            } else {
                ranked = optimize(lib, *c, sc, threads, 5, metric);
            }
            if (!tracePath.empty() && !writeTrace(lib, *c, ranked.front().build, sc, ranked.front().summary, tracePath, metric))
                return 1;
            if (asJson) {
                std::printf("{\"champion\": %s, \"builds\": [", jsonStr(c->id).c_str());
                for (size_t i = 0; i < ranked.size(); ++i)
                    std::printf("%s{\"build\": %s, \"summary\": %s}", i ? ", " : "", buildJson(ranked[i].build).c_str(),
                                summaryJson(ranked[i].summary).c_str());
                std::printf("]}\n");
            } else {
                printKit(*c);
                printRanked(lib, *c, ranked);
            }
            return 0;
        }

        if (all) {
            struct Row { const ChampionKit* c; Ranked best; };
            std::vector<Row> rows(lib.champions.size());
            std::atomic<size_t> nextIdx{0};
            std::mutex logMu;
            std::vector<std::thread> pool;
            for (int w = 0; w < threads; ++w)
                pool.emplace_back([&] {
                    for (size_t i; (i = nextIdx++) < lib.champions.size();) {
                        const ChampionKit& c = lib.champions[i];
                        const auto ranked = optimize(lib, c, lib.scenarioFor(c), 1, 1);
                        rows[i] = {&c, ranked.front()};
                        if (!traceDir.empty())
                            writeTrace(lib, c, ranked.front().build, lib.scenarioFor(c), ranked.front().summary,
                                       traceDir + "/" + c.id + ".json");
                        std::lock_guard<std::mutex> lock(logMu);
                        std::fprintf(stderr, "\r%zu/%zu %-14s", i + 1, lib.champions.size(), c.id.c_str());
                    }
                });
            for (auto& th : pool) th.join();
            std::fprintf(stderr, "\n");
            std::sort(rows.begin(), rows.end(),
                      [](const Row& a, const Row& b) { return a.best.summary.meanDps > b.best.summary.meanDps; });

            // How well the simulated damage lines up with real China-server damage shares.
            std::vector<double> sim, real;
            for (const auto& r : rows)
                if (r.c->hasCn && r.c->parseQuality == "good") {
                    sim.push_back(r.best.summary.meanDps);
                    real.push_back(r.c->cnDamageShare);
                }
            const double rho = sim.size() > 2 ? spearman(sim, real) : 0.0;

            if (asJson) {
                std::printf("{\"spearman_vs_cn_damage_share\": %.3f, \"champions\": [\n", rho);
                for (size_t i = 0; i < rows.size(); ++i) {
                    const auto& r = rows[i];
                    std::printf("%s{\"champion\": %s, \"name\": %s, \"role\": %s, \"parse_quality\": %s, "
                                "\"cn_damage_share\": %s, \"build\": %s, \"summary\": %s}",
                                i ? ",\n" : "", jsonStr(r.c->id).c_str(), jsonStr(r.c->name).c_str(),
                                jsonStr(r.c->role).c_str(), jsonStr(r.c->parseQuality).c_str(),
                                r.c->hasCn ? std::to_string(r.c->cnDamageShare).c_str() : "null",
                                buildJson(r.best.build).c_str(), summaryJson(r.best.summary).c_str());
                }
                std::printf("\n]}\n");
            } else {
                std::printf("%-4s %-14s %-9s %-7s %6s %8s %7s  %s\n", "#", "Champion", "Role", "Parse", "DPS",
                            "Survives", "Real dmg", "Best build");
                int i = 0;
                for (const auto& r : rows) {
                    char cn[16] = "  -";
                    if (r.c->hasCn) std::snprintf(cn, sizeof cn, "%5.1f%%", r.c->cnDamageShare * 100);
                    std::printf("%-4d %-14s %-9s %-7s %6.0f %7.0f%% %7s  %s\n", ++i, r.c->id.c_str(), r.c->role.c_str(),
                                r.c->parseQuality.c_str(), r.best.summary.meanDps, r.best.summary.survivalRate * 100, cn,
                                buildNames(lib, r.best.build).c_str());
                }
                std::printf("\nRank correlation between simulated DPS and real-game damage share "
                            "(champions with a good parse): %.2f over %zu champions\n",
                            rho, sim.size());
            }
            return 0;
        }
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
    usage();
    return 2;
}
