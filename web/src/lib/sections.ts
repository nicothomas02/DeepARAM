import { text } from "./content";

// The site's tabs. Each one shows the work of one project thread; `pr` is the pull
// request that adds that thread's data to the repo.
export const sections = [
  {
    href: "/stats",
    label: text("tab./stats.label", "My Stats"),
    body: text("tab./stats.body", "Your own Mayhem games: win rate, champions, augments and recent matches."),
    pr: 2,
  },
  {
    href: "/tier-list",
    label: text("tab./tier-list.label", "Tier List"),
    body: text("tab./tier-list.body", "Champion and augment win rates and duo synergy, patch by patch."),
    pr: 5,
  },
  {
    href: "/simulator",
    label: text("tab./simulator.label", "Simulator"),
    body: text("tab./simulator.body", "Simulated teamfights, simulated builds and fight replays for every champion."),
    pr: 4,
  },
  {
    href: "/patches",
    label: text("tab./patches.label", "Patches"),
    body: text("tab./patches.body", "What every patch changed: augments added, removed and tuned, and the champions that moved most."),
    pr: 0,
  },
  {
    href: "/pbe",
    label: text("tab./pbe.label", "PBE"),
    body: text("tab./pbe.body", "Mayhem Season 3 changes from the test server."),
    pr: 1,
  },
];

