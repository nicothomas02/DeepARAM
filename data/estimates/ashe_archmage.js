// The Ability Haste AP Ashe needs for Archmage's E <-> R loop, for every set of loop augments, R and E rank and
// Malignance's Ultimate Haste: data/estimates/ashe_archmage.json, read by web/src/lib/archmage-route.ts.
//
// Usage: node data/estimates/ashe_archmage.js   (after the calculator's data.js is rebuilt; takes a few seconds)
//
// Two readings of Archmage's random target (Nico 2026-11-24 asked to follow AramHex's AP Ashe Archmage guide, whose
// targets only hold under the first):
//   onCooldown: the refund lands only on abilities on cooldown, and Volley (W) is never cast, so E and R refund each
//               other (about 200 haste with Archmage alone at R3, as the guide says).
//   anyAbility: the refund can land on any other ability, Q included (Nico 2026-11-23); W isn't cast either.
// Mystic Punch is left out: it depends on attack speed.
global.window = global.window || {};
require("../../tools/fun/ashe-calculator/data.js");
const calc = require("../../tools/fun/ashe-calculator/calc.js");
const fs = require("fs");
const path = require("path");

const D = window.ASHE_DATA;
const ARCHMAGE = "ARAM_Archmage";
const EXTRAS = ["UltimateAwakening", "UltimateRecursion", "ARAM_Purist_Caster", "ARAM_UltimateRevolution", "ARAM_BreadAndCheese"];
const idOf = Object.fromEntries(D.augments.map((a) => [a.key, a.id]));
const RULES = { onCooldown: true, anyAbility: false };

const out = { patch: D.patch, built: new Date().toISOString().slice(0, 19) + "Z", archmage: idOf[ARCHMAGE], rules: {}, items: {} };
for (const it of D.items) out.items[it.id] = { name: it.name, price: it.price, haste: it.haste, ultHaste: it.ultHaste, limitGroups: it.limitGroups };

for (const [rule, onlyOnCooldown] of Object.entries(RULES)) {
  const sets = {};
  for (let mask = 0; mask < 1 << EXTRAS.length; mask++) {
    const extras = EXTRAS.filter((_, i) => mask & (1 << i));
    const key = extras.map((k) => idOf[k]).sort((a, b) => a - b).join("+") || "-";
    const row = {};
    for (const rRank of [2, 3])
      for (const ultItem of [0, 20]) {
        const need = [];
        for (let eRank = 1; eRank <= 5; eRank++)
          need.push(
            calc.threshold(D, { augments: [ARCHMAGE, ...extras], rRank, eRank, wRank: 0, castW: false, onlyOnCooldown, ultHaste: ultItem }, { runs: 24, step: 5 }),
          );
        row[`R${rRank}${ultItem ? "u" : ""}`] = need;
      }
    sets[key] = row;
  }
  out.rules[rule] = sets;
  console.log(rule, "done");
}
const file = path.join(__dirname, "ashe_archmage.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log("wrote", file);
