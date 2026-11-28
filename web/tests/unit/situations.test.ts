import { describe, expect, it } from "vitest";
import { situationFor, woundsBy, woundsFit } from "@/lib/situations";
import { situational } from "@/lib/card-score";

describe("situationFor", () => {
  it("reads when to buy an item from its own effect", () => {
    expect(situationFor("<passive>Grievous Wounds</passive> Dealing magic damage applies 40% Wounds", ["SpellDamage"])).toBe("healing");
    expect(situationFor("Shield Reaver: reduces any shields", ["Damage"])).toBe("shields");
    expect(situationFor("Remove all crowd control debuffs", ["SpellBlock", "Active"])).toBe("cc");
    expect(situationFor("Enter Stasis for 2.5 seconds.", ["Armor", "SpellDamage"])).toBe("burst");
    expect(situationFor("Receive 30% less damage from Critical Strikes.", ["Health", "Armor"])).toBe("crit");
    expect(situationFor("95 Ability Power 40% Magic Penetration", ["MagicPenetration", "SpellDamage"])).toBe("tanks");
    expect(situationFor("350 Health 45 Armor 45 Magic Resist", ["Health", "SpellBlock", "Armor"])).toBe("mixed");
    expect(situationFor("400 Health 80 Magic Resist", ["Health", "SpellBlock"])).toBe("magic");
    expect(situationFor("75 Armor 400 Mana", ["Armor", "Mana"])).toBe("physical");
  });
  it("leaves general items without a situation", () => {
    expect(situationFor("75 Attack Damage 25% Critical Strike Chance", ["CriticalStrike", "Damage"])).toBeNull();
    expect(situationFor("Restore Health to allies and deal 10% max Health true damage. 10% Heal and Shield Power", ["SpellDamage"])).toBeNull();
  });
});

describe("situational", () => {
  it("gives each situation its first items in pool order, up to the limits", () => {
    const pool = [1, 2, 3, 4, 5, 6].map((i) => ({ items: [i] }));
    const tag: Record<number, string> = { 1: "a", 2: "b", 3: "a", 4: "a", 5: "a", 6: "c" };
    expect(situational(pool, (i) => tag[i], 2, 2)).toEqual([
      { situation: "a", options: [{ items: [1] }, { items: [3] }] },
      { situation: "b", options: [{ items: [2] }] },
    ]);
  });
});

describe("woundsFit (Nico 2026-11-28: Thornmail on Nami)", () => {
  const thorn = "<passive>Thorns</passive> When struck by an Attack, deal magic damage to the attacker and apply 40% Wounds for 3 seconds if they are a champion.";
  const morello = "<passive>Grievous Wounds</passive> Dealing magic damage to champions applies 40% Wounds for 3 seconds.";
  const mortal = "<passive>Grievous Wounds</passive> Dealing physical damage applies 40% Wounds to enemy champions for 3 seconds.";
  it("reads how an item applies Wounds", () => {
    expect([woundsBy(thorn), woundsBy(morello), woundsBy(mortal), woundsBy("75 Ability Power")]).toEqual(["struck", "magic", "physical", null]);
  });
  it("keeps anti-heal only where its Wounds reach enemies", () => {
    const enchanter = { physical: false, tank: false }, tank = { physical: true, tank: true };
    expect(woundsFit(thorn, enchanter)).toBe(false);
    expect(woundsFit(morello, enchanter)).toBe(true);
    expect(woundsFit(mortal, enchanter)).toBe(false);
    expect(woundsFit(thorn, tank)).toBe(true);
    expect(woundsFit(mortal, tank)).toBe(true);
    expect(woundsFit(thorn, null)).toBe(true);
    expect(woundsFit("75 Ability Power", enchanter)).toBe(true);
  });
});
