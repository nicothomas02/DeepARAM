// Sanity checks for the all-champion simulator. Exits non-zero on any failure.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "../src/champ.hpp"

using namespace mayhem;

static int failures = 0;
#define CHECK(cond, msg)                                              \
    do {                                                              \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++failures; } \
        else std::printf("ok:   %s\n", msg);                          \
    } while (0)

static double meanDps(const Library& lib, const ChampionKit& c, const Build& b, const Scenario& sc, int n = 1500) {
    return summarize(runTrials(lib, c, b, sc, 0, n)).meanDps;
}

static bool has(const std::vector<std::string>& v, const char* x) { return std::find(v.begin(), v.end(), x) != v.end(); }

int main(int argc, char** argv) {
    const Library lib = Library::load(argc > 1 ? argv[1] : "data/mayhem_rules.json");

    CHECK(lib.champions.size() >= 170, "loads every champion (170+)");
    CHECK(lib.items.size() >= 80 && lib.augments.size() >= 10, "loads items and augments");
    size_t withAbilities = 0;
    for (const auto& c : lib.champions) withAbilities += c.abilities.empty() ? 0 : 1;
    CHECK(withAbilities >= 165, "almost every champion has damaging abilities");

    const ChampionKit* ahri = lib.find("Ahri");
    const ChampionKit* jinx = lib.find("jinx");
    const ChampionKit* lux = lib.find("99");
    CHECK(ahri && jinx && lux, "finds champions by id, name or number");
    if (!ahri || !jinx || !lux) return 1;

    const Scenario sc = lib.scenarioFor(*ahri);
    bool selfFree = true;
    for (const auto& e : sc.enemies) selfFree &= e.championId != ahri->championId;
    CHECK(selfFree && sc.enemies.size() > 100, "enemy pool has 100+ champions and never the champion itself");

    const Build naked{{}, {}};
    const Build cap{{"rabadons"}, {}};
    auto a = runTrials(lib, *ahri, cap, sc, 0, 400);
    auto b1 = runTrials(lib, *ahri, cap, sc, 0, 200);
    auto b2 = runTrials(lib, *ahri, cap, sc, 200, 200);
    bool same = true;
    for (size_t i = 0; i < 200; ++i) {
        same &= a[i].totalDamage == b1[i].totalDamage;
        same &= a[i + 200].totalDamage == b2[i].totalDamage;
    }
    CHECK(same, "results do not depend on how trials are split across workers");

    bool sane = true;
    for (const auto& r : a) sane &= r.totalDamage >= r.primaryDamage && r.primaryDamage >= 0 && r.duration > 0;
    CHECK(sane, "total damage >= single-target damage >= 0");

    CHECK(meanDps(lib, *ahri, cap, sc) > meanDps(lib, *ahri, naked, sc), "an AP item adds damage to an AP champion");
    const Scenario jsc = lib.scenarioFor(*jinx);
    CHECK(meanDps(lib, *jinx, Build{{"infinity_edge"}, {}}, jsc) > meanDps(lib, *jinx, Build{{"rabadons"}, {}}, jsc),
          "a marksman gets more from Infinity Edge than from Rabadon's");

    Scenario dummies = sc;
    dummies.fixedTarget = true;
    Scenario tanky = dummies;
    tanky.targetArmor = tanky.targetMr = 300;
    CHECK(meanDps(lib, *ahri, cap, tanky) < meanDps(lib, *ahri, cap, dummies), "more resists means less damage");

    Scenario peaceful = sc;
    peaceful.enemyDpsMean = peaceful.enemyDpsSd = 0;
    CHECK(summarize(runTrials(lib, *ahri, naked, peaceful, 0, 500)).survivalRate == 1.0,
          "nobody dies without enemy damage");

    ChampionKit nerfed = *ahri;
    nerfed.damageDealt = 0.8;
    CHECK(meanDps(lib, nerfed, cap, sc) < meanDps(lib, *ahri, cap, sc), "Mayhem damage-dealt nerfs lower damage");

    const auto luxRoles = fittingRoles(*lux), jinxRoles = fittingRoles(*jinx);
    CHECK(has(luxRoles, "ap") && !has(luxRoles, "crit"), "Lux searches AP items, not crit");
    CHECK(has(jinxRoles, "crit") && has(jinxRoles, "onhit"), "Jinx searches crit and on-hit items");

    Library quick = lib;
    quick.optimizer.screenTrials = 24;
    quick.optimizer.finalTrials = 400;
    quick.optimizer.candidates = 8;
    quick.optimizer.finalists = 4;
    const auto ranked = optimize(quick, *ahri, sc, 2, 3);
    const Build manual{{"sorcerers", "rabadons", "void_staff", "shadowflame", "stormsurge", "horizon_focus"}, {}};
    const double manualDps = meanDps(quick, *ahri, manual, sc, 400);
    CHECK(!ranked.empty() && ranked.front().build.items.size() == 6 && ranked.front().build.augments.size() == 4,
          "optimizer returns boots, five legendaries and four augments");
    CHECK(!ranked.empty() && ranked.front().summary.meanDps >= manualDps,
          "optimized build beats a hand-picked AP build without augments");

    const FightTrace tr = traceFight(lib, *ahri, cap, sc, 7);
    const Result plain = runTrials(lib, *ahri, cap, sc, 7, 1).front();
    double traced = 0;
    bool ordered = true, cast = false;
    for (size_t i = 0; i < tr.events.size(); ++i) {
        const auto& e = tr.events[i];
        if (e.kind == "damage") traced += e.amount;
        cast |= e.kind == "cast";
        if (i) ordered &= e.t >= tr.events[i - 1].t;
    }
    CHECK(tr.result.totalDamage == plain.totalDamage && std::abs(traced - plain.totalDamage) < 1e-6 * plain.totalDamage,
          "a recorded fight matches the same fight unrecorded, and its damage events add up");
    CHECK(ordered && cast && !tr.events.empty() && tr.events.back().kind == "end", "fight recordings are in time order");

    {
        Library harsh = Library::load(argc > 1 ? argv[1] : "data/mayhem_rules.json", {{"enemy_damage_scale", 3.0}});
        CHECK(summarize(runTrials(harsh, *harsh.find("Ahri"), cap, harsh.scenarioFor(*harsh.find("Ahri")), 0, 800)).meanTimeAlive <
                  summarize(runTrials(lib, *ahri, cap, sc, 0, 800)).meanTimeAlive,
              "tripling enemy damage shortens how long you live");
        Library picked = lib;
        picked.enemyTeam = {"Malphite:hp=6000:armor=300", "Brand"};
        const Scenario psc = picked.scenarioFor(*ahri);
        bool ok = psc.enemies.size() == 2 && psc.teamSize == 2;
        for (const auto& e : psc.enemies) if (e.id == "Malphite") ok &= e.hp == 6000 && e.armor == 300;
        CHECK(ok, "a picked enemy team uses exactly those champions with their changed stats");
        bool rejected = false;
        try { Library::load(argc > 1 ? argv[1] : "data/mayhem_rules.json", {{"not_a_setting", 1}}); } catch (...) { rejected = true; }
        CHECK(rejected, "unknown settings are rejected");
    }

    {
        // Fights last until the champion dies; Karthus keeps fighting after his death.
        const Result r = runTrials(lib, *ahri, cap, sc, 3, 1).front();
        CHECK(r.died && std::abs(r.duration - r.timeAlive) < 1e-9, "a fight ends when the champion dies");
        const ChampionKit* karthus = lib.find("Karthus");
        const Scenario ksc = lib.scenarioFor(*karthus);
        ChampionKit mortal = *karthus;
        mortal.deathAct = 0;
        CHECK(summarize(runTrials(lib, *karthus, cap, ksc, 0, 300)).meanTimeAlive >
                  summarize(runTrials(lib, mortal, cap, ksc, 0, 300)).meanTimeAlive + 5,
              "Karthus fights on after dying");
        CHECK(sc.teamSize == 1, "one enemy by default");
        // Enemies come with their most popular build; a listed build replaces it, and listed
        // stats replace what the build gives.
        bool built = true;
        for (const auto& e : sc.enemies) built &= e.items.size() == 6 && e.augments.size() == 4;
        CHECK(built, "every enemy has six items and four augments by default");
        Library geared = lib;
        geared.enemyTeam = {"Malphite:items=warmogs:augs="};
        const ChampionKit& malph = *lib.find("Malphite");
        const Effect& wm = lib.items.at("warmogs");
        const double g = 17 * (0.7025 + 0.0175 * 17);
        const double hpPct = wm.effects.count("hp_pct") ? wm.effects.at("hp_pct") : 0.0;
        const Scenario gsc = geared.scenarioFor(*ahri);
        CHECK(gsc.enemies.size() == 1 &&
                  std::abs(gsc.enemies[0].hp - (malph.hp + malph.hpG * g + lib.rules.mayhemHp(18, malph.ranged) + wm.stats.at("hp")) * (1 + hpPct)) < 1e-6,
              "an enemy's listed items replace its build");
        geared.enemyTeam = {"Malphite:hp=4000:items=warmogs"};
        CHECK(geared.scenarioFor(*ahri).enemies[0].hp == 4000, "a listed Health replaces what the build gives");
        Library young = Library::load(argc > 1 ? argv[1] : "data/mayhem_rules.json", {{"enemy_level", 1}});
        young.enemyTeam = {"Malphite"};
        geared.enemyTeam = {"Malphite"};
        CHECK(young.scenarioFor(*ahri).enemies[0].hp < geared.scenarioFor(*ahri).enemies[0].hp,
              "lower-level enemies have less Health");
    }

    {
        std::string first;
        for (const auto& e : tr.events)
            if (e.kind == "cast" && first.size() < 2) first += e.slot;
        CHECK(ahri->combo == "EQRW" && first == "EQ", "Ahri opens with her recommended combo (E, then Q)");
        bool badCombo = false;
        ChampionKit k = *ahri;
        try { Library::setCombo(k, "QQW"); } catch (...) { badCombo = true; }
        CHECK(badCombo, "a combo repeating an ability is rejected");
    }

    {
        // Positions: skillshots that enemies dodge more often land less, everyone stays
        // on the lane, and a melee champion only attacks from melee range.
        const char* rules = argc > 1 ? argv[1] : "data/mayhem_rules.json";
        const Library sharp = Library::load(rules, {{"dodge_chance", 0.0}});
        const Library slippery = Library::load(rules, {{"dodge_chance", 1.0}});
        const ChampionKit& sl = *sharp.find("Lux");
        CHECK(meanDps(sharp, sl, cap, sharp.scenarioFor(sl), 600) >
                  meanDps(slippery, *slippery.find("Lux"), cap, slippery.scenarioFor(*slippery.find("Lux")), 600),
              "skillshots land less when enemies dodge more");

        const ChampionKit* garen = lib.find("Garen");
        const FightTrace gt = traceFight(lib, *garen, Build{{"trinity"}, {}}, lib.scenarioFor(*garen), 3);
        bool onLane = true, melee = true;
        int attacks = 0;
        std::vector<double> last;  // latest positions
        int focus = -1;
        for (const auto& e : gt.events) {
            if (e.kind == "pos") {
                last = e.pos;
                for (size_t i = 0; i + 2 < e.pos.size(); i += 3) onLane &= std::fabs(e.pos[i + 2]) <= 551;
            }
            if (e.kind == "focus") focus = e.target;
            if (e.kind == "attack" && last.size() >= 3) {
                ++attacks;
                for (size_t i = 3; i + 2 < last.size(); i += 3)
                    if (static_cast<int>(last[i]) == e.target)
                        melee &= std::hypot(last[i + 1] - last[1], last[i + 2] - last[2]) <= garen->attackRange + 130 + 80;
            }
        }
        (void)focus;
        CHECK(onLane, "everyone stays on the lane");
        CHECK(attacks > 0 && melee, "a melee champion attacks only from melee range");

        // Attacks and casts never overlap: an attack's wind-up ends where it lands, a cast holds
        // from its start through its cast time and any channel.
        bool apart = true, windups = true;
        for (const char* who : {"MissFortune", "Ezreal", "Garen", "Katarina"}) {
            const ChampionKit& k = *lib.find(who);
            const FightTrace ft = traceFight(lib, k, cap, lib.scenarioFor(k), 5);
            std::vector<std::pair<double, double>> busy;
            for (const auto& e : ft.events) {
                if (e.kind == "attack") {
                    busy.push_back({e.t - e.amount, e.t});
                    windups &= e.amount > 0.05 && e.amount < 1.0;
                }
                if (e.kind == "cast") busy.push_back({e.t, e.t + e.amount + e.lock});
            }
            std::sort(busy.begin(), busy.end());
            for (size_t i = 1; i < busy.size(); ++i) apart &= busy[i].first >= busy[i - 1].second - 1e-6;
        }
        CHECK(windups, "attacks wind up before they land");
        CHECK(apart, "a champion never attacks and casts at the same time");

        // Garen's Decisive Strike resets his attack timer: some attack starts sooner after the one
        // before than his attack speed allows on its own.
        const Library calm = Library::load(rules, {{"enemy_damage_scale", 0.05}});
        const ChampionKit& gk = *calm.find("Garen");
        const FightTrace rt = traceFight(calm, gk, Build{{"trinity"}, {}}, calm.scenarioFor(gk), 2);
        std::vector<double> starts;
        for (const auto& e : rt.events)
            if (e.kind == "attack") starts.push_back(e.t - e.amount);
        std::vector<double> gaps;
        for (size_t i = 1; i < starts.size(); ++i) gaps.push_back(starts[i] - starts[i - 1]);
        std::sort(gaps.begin(), gaps.end());
        const bool reset = gaps.size() > 4 && gaps.front() < 0.95 * gaps[gaps.size() / 2];
        CHECK(reset, "an attack-reset ability lets the next attack start right away");

        // Your crowd control lands on enemies, and enemies' crowd control on you says what it is.
        const ChampionKit& leona = *calm.find("Leona");
        const FightTrace lt = traceFight(calm, leona, cap, calm.scenarioFor(leona), 4);
        bool stuns = false, named = true;
        for (const auto& e : lt.events) {
            stuns |= e.kind == "ecc" && e.text == "stun";
            if (e.kind == "cc") named &= !e.text.empty();
        }
        CHECK(stuns && named, "crowd control is recorded with its kind, on enemies and on you");

        // Toggles stay on while enemies are in reach, and the replay sees them switch on.
        for (const char* n : {"Singed", "Karthus", "Amumu", "Anivia"}) {
            const ChampionKit& tk = *calm.find(n);
            bool always = false;
            for (const auto& ab : tk.abilities) always |= ab.toggle && ab.aura;
            bool shown = false;
            for (const auto& e : traceFight(calm, tk, cap, calm.scenarioFor(tk), 4).events) shown |= e.kind == "toggle" && e.flag;
            CHECK(always && shown, (std::string(n) + "'s toggle stays on and shows in the replay").c_str());
        }

        // Shields: Lux's W shields her, and Sterak's Gage shields you when you drop low.
        const ChampionKit& lux = *calm.find("Lux");
        const FightTrace xt = traceFight(calm, lux, cap, calm.scenarioFor(lux), 3);
        bool luxShield = false;
        for (const auto& e : xt.events) luxShield |= e.kind == "shield" && e.slot == 'W' && e.amount > 0;
        CHECK(luxShield, "a shielding ability shields you when cast");
        const ChampionKit& dar = *lib.find("Darius");
        const Scenario dsc = lib.scenarioFor(dar);
        double shielded = 0;
        for (const auto& r : runTrials(lib, dar, Build{{"steraks"}, {}}, dsc, 0, 40)) shielded += r.shielded;
        CHECK(shielded > 0, "Sterak's Gage shields you when your Health drops low");

        // Passives: Darius's Hemorrhage and Caitlyn's Headshot add their own damage.
        for (const char* who : {"Darius", "Caitlyn"}) {
            const ChampionKit& k = *lib.find(who);
            double passive = 0;
            for (const auto& r : runTrials(lib, k, cap, lib.scenarioFor(k), 0, 40)) passive += r.bySource[SrcPassive];
            const std::string msg = std::string(who) + "'s passive deals damage";
            CHECK(!k.passives.empty() && passive > 0, msg.c_str());
        }
    }

    {
        // Enemies' builds and level decide how hard they hit: the same fight is over sooner
        // against level 18 enemies with their full builds than against level 1 enemies.
        const char* rules = argc > 1 ? argv[1] : "data/mayhem_rules.json";
        Library strong = Library::load(rules, {{"enemy_level", 18}});
        Library weak = Library::load(rules, {{"enemy_level", 1}});
        strong.enemyTeam = weak.enemyTeam = {"Malphite:items=:augs="};
        const double weakPower = weak.scenarioFor(*ahri).enemies[0].power;
        weak.enemyTeam = {"Malphite"};
        strong.enemyTeam = {"Malphite"};
        CHECK(strong.scenarioFor(*ahri).enemies[0].power > 1.0 && weakPower < strong.scenarioFor(*ahri).enemies[0].power,
              "enemies with their full build at level 18 hit harder than real games' average");
        auto alive = [&](const Library& l) {
            double t = 0;
            for (const auto& r : runTrials(l, *ahri, cap, l.scenarioFor(*ahri), 0, 200)) t += r.timeAlive;
            return t;
        };
        CHECK(alive(strong) < alive(weak), "you last longer against low-level enemies");
    }

    {
        // Each champion only gets the augments it can be offered in Mayhem.
        const auto ap = lib.augmentsFor(*ahri), ad = lib.augmentsFor(*jinx);
        CHECK(ap.size() > 40 && ap.size() < lib.augments.size(), "Ahri's augment pool is her own, not every augment");
        CHECK(has(ap, "adapt") && !has(ad, "adapt") && has(ad, "critical_rhythm") && !has(ap, "critical_rhythm"),
              "pools differ per champion (Adapt for Ahri, Critical Rhythm for Jinx)");

        // Augment mechanics: on-attack procs, stacks, stat conversions and revives.
        const Build ie{{"infinity_edge"}, {}};
        const Scenario jsc = lib.scenarioFor(*jinx);
        auto with = [](Build b, const char* aug) { b.augments.push_back(aug); return b; };
        CHECK(meanDps(lib, *jinx, with(ie, "light_em_up"), jsc, 600) > meanDps(lib, *jinx, ie, jsc, 600),
              "Light 'Em Up's every-fourth-attack burst adds damage");
        CHECK(meanDps(lib, *jinx, with(ie, "critical_rhythm"), jsc, 600) > meanDps(lib, *jinx, ie, jsc, 600),
              "Critical Rhythm's attack speed stacks add damage");
        CHECK(meanDps(lib, *ahri, with(cap, "marksmage"), sc, 600) > meanDps(lib, *ahri, cap, sc, 600),
              "Marksmage turns AP into attack damage");
        CHECK(summarize(runTrials(lib, *ahri, with(cap, "hellbent"), sc, 0, 400)).meanTimeAlive >
                  summarize(runTrials(lib, *ahri, cap, sc, 0, 400)).meanTimeAlive,
              "Hellbent's revive keeps you fighting longer");
    }

    {
        // Stat and stacking passives: Veigar's AP stacks add damage.
        const ChampionKit* veigar = lib.find("Veigar");
        CHECK(veigar && !veigar->kitStats.empty(), "Veigar has his Phenomenal Evil stacks");
        if (veigar) {
            ChampionKit plain = *veigar;
            plain.kitStats.clear();
            const Scenario vsc = lib.scenarioFor(*veigar);
            CHECK(meanDps(lib, *veigar, cap, vsc, 600) > meanDps(lib, plain, cap, vsc, 600),
                  "Veigar's AP stacks add damage");
        }
    }

    {
        // Kit fixes from the client's spell data: an ability's on-attack passive, a cast's
        // attack-speed buff, and a tooltip number that is per second.
        const ChampionKit* kennen = lib.find("Kennen");
        CHECK(kennen && !kennen->passives.empty(), "Kennen's Electrical Surge procs on his attacks");
        if (kennen) {
            ChampionKit noRush = *kennen;
            for (auto& a : noRush.abilities) a.buffAs = 0;
            const Scenario ksc = lib.scenarioFor(*kennen);
            CHECK(meanDps(lib, *kennen, cap, ksc, 600) > meanDps(lib, noRush, cap, ksc, 600),
                  "Lightning Rush's attack speed adds damage");
        }
        const ChampionKit* mundo = lib.find("DrMundo");
        CHECK(mundo && !mundo->abilities[1].hits.empty() && mundo->abilities[1].hits[0].perSecond,
              "Heart Zapper deals its damage every second");
    }

    {
        // Mana and energy: casts cost them, so a free-casting copy does more damage.
        CHECK(lux->resource == 1 && lux->mana > 0 && lux->abilities[0].cost > 0, "Lux has mana and her abilities cost it");
        const ChampionKit* zed = lib.find("Zed");
        CHECK(zed && zed->resource == 2, "Zed uses energy");
        ChampionKit free = *lux;
        free.resource = 0;
        const Scenario lsc = lib.scenarioFor(*lux);
        CHECK(meanDps(lib, free, cap, lsc, 600) > meanDps(lib, *lux, cap, lsc, 600), "running out of mana costs damage");
    }

    {
        // Enemies use their own abilities: Leona's stuns on you are her Q, E or R.
        Library vs = Library::load(argc > 1 ? argv[1] : "data/mayhem_rules.json");
        vs.enemyTeam = {"Leona"};
        const Scenario lsc = vs.scenarioFor(*ahri);
        bool hers = false, others = false;
        for (uint64_t trial = 0; trial < 60; ++trial)
            for (const auto& ev : traceFight(vs, *ahri, cap, lsc, trial).events)
                if (ev.kind == "cc" && ev.who == "Leona") {
                    hers |= ev.slot == 'Q' || ev.slot == 'E' || ev.slot == 'R';
                    others |= ev.slot == 'W';
                }
        CHECK(hers && !others, "Leona crowd controls you with her own stuns");
    }

    {
        // 5v5: the same two teams give the same odds whichever side you're on.
        auto pick = [&](const char* n) { const ChampionKit* k = lib.find(n); return TeamPick{k, popularBuild(lib, *k)}; };
        const std::vector<TeamPick> a = {pick("Jinx"), pick("Lulu"), pick("Leona"), pick("Ahri"), pick("Darius")};
        const std::vector<TeamPick> b = {pick("Ashe"), pick("MissFortune"), pick("Teemo"), pick("Brand"), pick("Caitlyn")};
        const TeamResult ab = runTeam(lib, a, b, 120), ba = runTeam(lib, b, a, 120);
        CHECK(std::abs(ab.winRate + ba.winRate - 1.0) < 1e-9, "5v5 odds are the same from either side");
        CHECK(ab.members.size() == 5 && ab.foes.size() == 5 && ab.fightLength > 0, "5v5 reports both teams");
        CHECK(defaultEnemyTeam(lib, a).size() == 5, "5v5 picks five enemies when none are given");
    }

    bool threw = false;
    try { runTrials(lib, *ahri, Build{{"not_an_item"}, {}}, sc, 0, 1); } catch (...) { threw = true; }
    CHECK(threw, "unknown item ids are rejected");

    std::printf("\n%s (%d failure%s)\n", failures ? "FAILED" : "PASSED", failures, failures == 1 ? "" : "s");
    return failures ? 1 : 0;
}
