//! Which Mayhem headliner this game has, found by the app itself (Nico 2026-11-24 and 2026-11-28: no input in game).
//!
//! The match data has no headliner field (RC probe 2026-11-24, DeepARAM-PC research/headliner-probe), so the app
//! reads what the headliner shows, strongest signal first. A port of the old PC app's live-window/headliner.py:
//!   1. the start-of-game announcement: a text line that is just the headliner's name (the card area's reads in the
//!      first 90 s, and the HUD strip);
//!   2. K/DA's HUD panel, "COLLECT ALL CARDS", top right the whole game (seen on NicoPC 2026-11-28, Riven game);
//!   3. Pentakill's own cards on offer (HEAVY / POWER / THRASH / DOOM, client ids 3170-3173);
//!   4. Superfans' level cap of 21: anyone at level 20 or more.
//!
//! Every detection says how it was found. Nothing is guessed from win rates.

/// (key, the name the engine takes, names the announcement may use)
const HEADLINERS: &[(&str, &str, &[&str])] = &[
    ("debonair", "Debonair", &["debonair"]),
    ("commandline", "Command Line", &["commandline"]),
    ("maestro", "Maestro", &["maestro"]),
    ("heartsteel", "HEARTSTEEL", &["heartsteel"]),
    ("kda", "K/DA", &["kda"]),
    ("superfans", "Superfans", &["superfans"]),
    ("pentakill", "Pentakill", &["pentakill"]),
    ("truedamage", "True Damage", &["truedamage"]),
    ("spacegroove", "Space Groove", &["spacegroove", "disco"]),
    ("beeband", "The Bee Band", &["thebeeband", "beeband"]),
    ("cafecuties", "Cafe Cuties", &["cafecuties"]),
    ("arcade", "Arcade", &["arcade", "bitrush"]),
    ("lailusion", "La Ilusion", &["lailusion"]),
];

/// Pentakill's own augment cards (client ids): only that headliner offers them.
const PENTAKILL_CARDS: [i64; 4] = [3170, 3171, 3172, 3173];

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.len().abs_diff(b.len()) > 2 {
        return 9;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            cur.push((prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + usize::from(ca != cb)));
        }
        prev = cur;
    }
    prev[b.len()]
}

/// The headliner a text line names, when the line is (almost) only that name. Short names (K/DA, Disco) must match
/// exactly; longer ones allow one misread letter (two from 10 letters).
pub fn from_line(text: &str) -> Option<&'static str> {
    let n = norm(text);
    if n == "collectallcards" || distance(&n, "collectallcards") <= 2 {
        return Some("K/DA");
    }
    if n.len() < 3 || n.len() > 16 {
        return None;
    }
    HEADLINERS.iter().find_map(|(_, name, aliases)| {
        aliases
            .iter()
            .any(|a| n == *a || (a.len() >= 7 && distance(&n, a) <= if a.len() >= 10 { 2 } else { 1 }))
            .then_some(*name)
    })
}

/// One game's headliner and how it was found.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct Detector {
    pub name: Option<&'static str>,
    pub how: Option<&'static str>,
}

impl Detector {
    fn set(&mut self, name: &'static str, how: &'static str) {
        if self.name.is_none() {
            self.name = Some(name);
            self.how = Some(how);
        }
    }

    /// Text lines read off the screen (the card area or the HUD strip).
    pub fn lines<'a>(&mut self, texts: impl IntoIterator<Item = &'a str>) {
        for t in texts {
            if let Some(h) = from_line(t) {
                self.set(h, if h == "K/DA" && norm(t).len() > 6 { "K/DA's card panel" } else { "announcement" });
            }
        }
    }

    /// The cards on offer.
    pub fn cards(&mut self, ids: &[i64]) {
        if ids.iter().any(|a| PENTAKILL_CARDS.contains(a)) {
            self.set("Pentakill", "its own cards");
        }
    }

    /// The highest level anyone in the game has.
    pub fn top_level(&mut self, level: u64) {
        if level >= 20 {
            self.set("Superfans", "level 20 or more");
        }
    }

    /// The tracker's view of it.
    pub fn for_tracker(&self) -> augtrack::Headliner {
        match self.name {
            Some("Pentakill") => augtrack::Headliner::Pentakill,
            Some("Superfans") => augtrack::Headliner::Superfans,
            Some("K/DA") => augtrack::Headliner::Kda,
            _ => augtrack::Headliner::None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_the_announcement() {
        assert_eq!(from_line("K/DA"), Some("K/DA"));
        assert_eq!(from_line("Command Line"), Some("Command Line"));
        assert_eq!(from_line("HEARTSTEEL"), Some("HEARTSTEEL"));
        assert_eq!(from_line("HEARTSTEFL"), Some("HEARTSTEEL"));
        assert_eq!(from_line("Disco"), Some("Space Groove"));
        assert_eq!(from_line("KDA is here tonight"), None);
        assert_eq!(from_line("Archmage"), None);
        assert_eq!(from_line("Kda1"), None);
    }

    #[test]
    fn kda_from_its_card_panel() {
        let mut d = Detector::default();
        d.lines(["45 vs 42", "COLLECT ALL CARDS", "REWARD"]);
        assert_eq!(d.name, Some("K/DA"));
        assert_eq!(d.how, Some("K/DA's card panel"));
        assert_eq!(d.for_tracker(), augtrack::Headliner::Kda);
        assert_eq!(from_line("COLLECT ALL CARD5"), Some("K/DA"));
    }

    #[test]
    fn pentakill_cards_and_superfans_levels() {
        let mut d = Detector::default();
        d.cards(&[1001, 3171, 1002]);
        assert_eq!(d.name, Some("Pentakill"));
        let mut d = Detector::default();
        d.top_level(19);
        assert_eq!(d.name, None);
        d.top_level(20);
        assert_eq!(d.name, Some("Superfans"));
    }

    #[test]
    fn the_first_signal_stays() {
        let mut d = Detector::default();
        d.lines(["Debonair"]);
        d.top_level(20);
        assert_eq!(d.name, Some("Debonair"));
    }
}
