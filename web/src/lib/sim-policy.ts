// The Simulator is a fun tool only for now (Nico, 2026-11-20): it doesn't yet represent real games, so nothing that
// ranks, recommends or rates builds and augments may lean on it. While this is false, champion pages leave out the
// Simulator-made panels (Best upgrades, Build for your augments, Early/mid/late game, the boots step in core
// builds) and the Tier List leaves out the Weapon of Destiny and Pentakill tabs. The data side has the same switch
// in data/estimates/synergy_checks.py (USE_SIMULATOR). Flip both to bring them back.
export const SIMULATOR_IN_STATS = false;
