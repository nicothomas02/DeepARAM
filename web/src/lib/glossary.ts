// Plain-language meaning of every stat column label, used for table header tooltips and the
// "What do these columns mean?" list under each table. A column's own hint wins over these.
export const GLOSSARY: Record<string, string> = {
  "Win rate": "How often a team with this pick wins. 50% is even.",
  "Raw win rate": "Wins divided by games, before any adjustment for small samples.",
  "Pick rate": "Share of games where this was picked.",
  Rarity: "Silver, Gold or Prismatic. Each augment selection offers three cards of one rarity.",
  "Pick rank": "Place among all augments by how often they're picked (1 is most picked).",
  "Pick rank change": "How many places the pick rank moved since the previous patch.",
  "Damage share": "Share of the team's damage to champions this champion dealt.",
  "Damage taken": "Share of the team's damage taken that this champion soaked. Higher means more of a frontline.",
  "Kill part.": "Kill participation: share of the team's kills this champion got or assisted.",
  "Time dead": "Average time spent dead per game. Lower is better.",
  "Mean DPS": "Simulated damage per second, averaged over many fights.",
  Survives: "Share of simulated fights the champion lived through.",
  "Long-fight edge": "How much more simulated damage a champion does in long fights than short ones.",
  "Game share": "Rough share of all games in the chosen patches.",
  Roles: "The jobs this champion usually does in a team.",
  Role: "The job this champion usually does in a team.",
};

export const hintFor = (label: string, own?: string) => own ?? GLOSSARY[label];
