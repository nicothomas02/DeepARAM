// Item tags (/items and each item page): the in-game shop's class filters, then plain-language groups of
// the shop's own categories, in five colour families. An item has a tag when the shop lists any of its
// categories for it; class tags come in as "class:<name>" (lib/items.ts itemClasses).

export type ItemTag = { key: string; label: string; group: "class" | "attack" | "magic" | "defense" | "utility"; cats: string[] };

const CLASS_TAGS: [string, string][] = [
  ["fighter", "Fighter"],
  ["marksman", "Marksman"],
  ["assassin", "Assassin"],
  ["mage", "Mage"],
  ["tank", "Tank"],
  ["support", "Support"],
];

export const ITEM_TAGS: ItemTag[] = [
  ...CLASS_TAGS.map(([key, label]): ItemTag => ({ key, label, group: "class", cats: [`class:${key}`] })),
  { key: "ad", label: "Attack damage", group: "attack", cats: ["Damage"] },
  { key: "crit", label: "Crit", group: "attack", cats: ["CriticalStrike"] },
  { key: "as", label: "Attack speed", group: "attack", cats: ["AttackSpeed"] },
  { key: "onhit", label: "On-hit", group: "attack", cats: ["OnHit"] },
  { key: "armorpen", label: "Armor pen", group: "attack", cats: ["ArmorPenetration"] },
  { key: "lifesteal", label: "Life steal", group: "attack", cats: ["LifeSteal"] },
  { key: "ap", label: "Ability power", group: "magic", cats: ["SpellDamage"] },
  { key: "magicpen", label: "Magic pen", group: "magic", cats: ["MagicPenetration"] },
  { key: "mana", label: "Mana", group: "magic", cats: ["Mana", "ManaRegen"] },
  { key: "omnivamp", label: "Omnivamp", group: "magic", cats: ["SpellVamp"] },
  { key: "health", label: "Health", group: "defense", cats: ["Health", "HealthRegen"] },
  { key: "armor", label: "Armor", group: "defense", cats: ["Armor"] },
  { key: "mr", label: "Magic resist", group: "defense", cats: ["SpellBlock", "MagicResist"] },
  { key: "tenacity", label: "Tenacity", group: "defense", cats: ["Tenacity"] },
  { key: "haste", label: "Ability haste", group: "utility", cats: ["AbilityHaste", "CooldownReduction"] },
  { key: "speed", label: "Move speed", group: "utility", cats: ["NonbootsMovement"] },
  { key: "boots", label: "Boots", group: "utility", cats: ["Boots"] },
  { key: "active", label: "Active", group: "utility", cats: ["Active"] },
  { key: "slow", label: "Slows", group: "utility", cats: ["Slow"] },
  { key: "aura", label: "Aura", group: "utility", cats: ["Aura"] },
];

export const TAG_GROUPS = [
  ["class", "Class"],
  ["attack", "Attack"],
  ["magic", "Magic"],
  ["defense", "Defense"],
  ["utility", "Utility"],
] as const;

const BY_KEY = new Map(ITEM_TAGS.map((t) => [t.key, t]));
export const itemTag = (key: string) => BY_KEY.get(key);

/** Tag keys for an item's shop categories, in ITEM_TAGS order. */
export const tagsFor = (cats: string[] = []) => ITEM_TAGS.filter((t) => t.cats.some((c) => cats.includes(c))).map((t) => t.key);
