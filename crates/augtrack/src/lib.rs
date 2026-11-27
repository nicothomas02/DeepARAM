//! Augment pick tracking for the DeepARAM desktop apps.
//!
//! League's live data has no augments, so the apps read the card titles off the player's own screen and watch where
//! left clicks land. This crate turns those reads and clicks into "which card was taken", with the rules learned from
//! live games (PC app 1.26.41-1.26.58, Nico 2026-11-27). It has no screen, mouse or OS code: the app feeds it
//!   - the game state each tick (`game`), which also says whether a screen may be up (the read window),
//!   - each screen read (`read`): augment ids found and the screen x of each title,
//!   - each left click on League's window (`click`): screen x and how far down the window (0-1).
//!
//! It reads back `picked`, `rounds`, `offer` and the `events` it emits.
//!
//! The rule above all (Nico 2026-11-27): never mark a wrong pick. A round left unknown is acceptable (the post-game
//! screen fills it), a wrong one is not. Every rule below says which live game it came from.
//!
//! Time is seconds on any monotonic clock, passed in, so the simulator (tests/sim.rs) runs it on a scripted clock.

use std::collections::HashSet;

/// Augment levels after the start screen (Mayhem: 7, 11, 15).
pub const AUG_LEVELS: [u32; 3] = [7, 11, 15];
/// Seconds a screen must stay gone after a low click (reroll strip) before it counts as closed: a reroll's new cards
/// take up to ~4 s (Yunara 2026-11-27).
pub const LOW_WAIT: f64 = 6.0;
/// A click this soon after new cards replaced a screen was aimed at the old cards (Briar 2026-11-27, La Ilusion).
pub const REACT: f64 = 0.35;

/// Pentakill's own cards (HEAVY/POWER/THRASH...): an extra screen, never an augment round.
pub fn is_band(id: i64) -> bool {
    (3170..=3176).contains(&id)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Headliner {
    None,
    Pentakill,
    Superfans,
    Kda,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zone {
    /// On a card's body (10-65% down the window)
    Pick,
    /// The reroll button under a card, which is also the card's lower edge (65-80% down)
    Reroll,
}

/// Where a click sits up the window, from clicks logged on NicoPC (Zeri 2026-11-27): picks at 27% / 40%, each card's
/// reroll button at 71-72%.
pub fn zone(y_rel: f64) -> Option<Zone> {
    if (0.1..=0.65).contains(&y_rel) {
        Some(Zone::Pick)
    } else if y_rel > 0.65 && y_rel <= 0.8 {
        Some(Zone::Reroll)
    } else {
        None
    }
}

/// The left button, sampled every few ms by the app (ingame.rs: every 40 ms), turned into clicks.
///
/// Each sample gives two bits from the OS (Windows' GetAsyncKeyState): `down`, the button is down right now, and
/// `since`, it was pressed at some point since the last sample. A quick click, pressed and released between two
/// samples, shows only in `since`. Shaco 2026-11-27 (round 3, cards 1057/1308/2018): the pick fell between two
/// 40 ms samples, no click was seen, and the round stayed unknown. The owner's old app fixed it with the same bit;
/// the desktop app's port had only `down`.
///
/// `down` alone still starts a click when `since` reads false (another program can take that bit first). The app
/// keeps sampling while no screen can be up and throws those clicks away, so an old press never counts later.
#[derive(Clone, Copy, Debug, Default)]
pub struct Button {
    down: bool,
}

impl Button {
    /// One sample. Returns true when a new click started since the last sample.
    pub fn sample(&mut self, down: bool, since: bool) -> bool {
        let new = since || (down && !self.down);
        self.down = down;
        new
    }
}

/// One read of the card area.
#[derive(Clone, Debug, Default)]
pub struct Read {
    /// Augment ids matched, left to right
    pub ids: Vec<i64>,
    /// Screen x of each id's title (same length as ids when known)
    pub xs: Vec<f64>,
    /// Copied from League's own window while it was covered (may be stale: it can open or change a screen, never
    /// close one)
    pub from_window: bool,
    /// The card area read black (exclusive Fullscreen)
    pub blank: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A screen was accepted (new or rerolled)
    Offer(Vec<i64>),
    /// A screen closed; `pick` is the card marked, if any
    Closed {
        cards: Vec<i64>,
        pick: Option<i64>,
        replaced: bool,
        cols: bool,
    },
    /// A mark was taken back (the "close" was a reroll's card flip)
    Unmark(i64),
    /// A pick was marked late (the click came just after the close was read)
    Late(i64),
}

#[derive(Clone, Debug)]
struct Click {
    cards: Vec<i64>,
    i: usize,
    at: f64,
}

#[derive(Clone, Debug)]
struct Closed {
    cards: Vec<i64>,
    at: f64,
    level: u32,
    low: bool,
    unmarked: bool,
}

#[derive(Debug, Default)]
pub struct Tracker {
    /// Augments taken this game, in order
    pub picked: Vec<i64>,
    /// Screens closed this game (Pentakill's excluded): rounds count even when the pick is unknown
    pub rounds: u32,
    /// The screen up now
    pub offer: Vec<i64>,
    /// Titles glimpsed in the last 8 s (newest first, max 4), for the round's tier
    pub glimpse: Vec<i64>,
    pub events: Vec<Event>,
    /// A screen may be up: read every `nap()` seconds
    pub window: bool,
    /// Screens owed (levels reached, start screen) not yet closed
    pub owed: u32,
    width: f64,
    reached: Vec<(u32, f64)>,
    last_lvl: u32,
    level: u32,
    dead: bool,
    was_dead: bool,
    alive_at: f64,
    game_time: f64,
    misses: u32,
    seen_at: f64,
    prev_raw: Option<Vec<i64>>,
    closed: Option<Closed>,
    close_marked: Option<i64>,
    replaced_at: f64,
    last_click: Option<Click>,
    card_clicks: Vec<(Vec<i64>, usize, bool)>,
    early_clicks: Vec<(f64, f64, f64)>,
    low_at: f64,
    hover_since: Option<f64>,
    auto_pick: Option<i64>,
    unmarked: HashSet<i64>,
    col_seen: Vec<(i64, f64, f64)>,
    layout: Vec<f64>,
    last_xs: Vec<f64>,
    burst_until: f64,
    started: bool,
    now: f64,
}

impl Tracker {
    pub fn new() -> Self {
        // "never" for the times the rules measure from (the clock may start at 0)
        let never = f64::NEG_INFINITY;
        Self {
            low_at: never,
            replaced_at: never,
            alive_at: never,
            seen_at: never,
            ..Self::default()
        }
    }

    /// Restores a game's picks and rounds after an app restart mid-game.
    pub fn restore(&mut self, picked: Vec<i64>, rounds: u32) {
        self.picked = picked;
        self.rounds = rounds;
    }

    /// Seconds until the next read: 0.15 just after a click on the cards, 0.3 while a screen may be up and League is
    /// in front, else 1.
    pub fn nap(&self, now: f64, in_front: bool) -> f64 {
        if now < self.burst_until {
            0.15
        } else if self.window && in_front {
            0.3
        } else {
            1.0
        }
    }

    /// The game state, every tick. `width` is League's window width in screen pixels. Returns whether to read.
    pub fn game(
        &mut self,
        now: f64,
        game_time: f64,
        level: u32,
        dead: bool,
        headliner: Headliner,
        width: f64,
    ) -> bool {
        self.now = now;
        self.width = width;
        self.game_time = game_time;
        self.level = level;
        // the first screen comes at the start; it can wait and be opened later in the shop, so it is owed like the
        // others until a screen closes (Zeri 2026-11-27, Command Line game)
        if self.last_lvl == 0 && level > 0 && game_time < 120.0 && !self.started {
            self.owed += 1;
        }
        if level > 0 {
            self.started = true;
        }
        for l in AUG_LEVELS {
            if self.last_lvl < l && l <= level {
                self.reached.push((l, now));
                self.owed += 1;
            }
        }
        // Headliners with screens past 15: Pentakill's own cards at 18, Superfans' 5th augment at 21, K/DA's 5th
        // screen somewhere 16-20 (opens the read window, owed once seen)
        let extra: &[u32] = match headliner {
            Headliner::Pentakill => &[18],
            Headliner::Superfans => &[21],
            _ => &[],
        };
        for &l in extra {
            if self.last_lvl < l && l <= level {
                self.reached.push((l, now));
                self.owed += 1;
            }
        }
        if headliner == Headliner::Kda {
            for l in 16..=20 {
                if self.last_lvl < l && l <= level {
                    self.reached.push((l, now));
                }
            }
        }
        self.last_lvl = level;
        // a screen only opens with the shop open (dead or on the spawn platform). Deaths no longer clear what is
        // owed (Shaco 2026-11-27: the last screen, opened later, was never read)
        if self.was_dead && !dead {
            self.alive_at = now;
        }
        self.was_dead = dead;
        self.dead = dead;
        self.window = game_time < 90.0
            || self.reached.iter().any(|&(_, at)| now - at < 60.0)
            || !self.offer.is_empty()
            || (self.owed > 0 && (dead || now - self.alive_at < 15.0));
        self.window
    }

    fn card_at(&self, x: f64, y_rel: f64) -> Option<usize> {
        zone(y_rel)?;
        let xs = if !self.layout.is_empty() {
            &self.layout
        } else {
            &self.last_xs
        };
        if xs.is_empty() {
            return None;
        }
        let gap = xs
            .windows(2)
            .map(|w| w[1] - w[0])
            .fold(f64::INFINITY, f64::min);
        let gap = if gap.is_finite() {
            gap
        } else {
            self.width / 3.0
        };
        let i = (0..xs.len()).min_by(|&a, &b| (x - xs[a]).abs().total_cmp(&(x - xs[b]).abs()))?;
        ((x - xs[i]).abs() <= gap / 2.0).then_some(i)
    }

    /// One read of the card area (`None`: no read was possible). `cursor`: where the pointer rests (x, y_rel).
    pub fn read(&mut self, now: f64, read: Option<Read>, cursor: Option<(f64, f64)>) {
        self.now = now;
        let Some(r) = read else { return };
        // every title read, at its place on screen (also lone ones from a screen still sliding in): a quick pick on
        // cards never read whole is placed by its click (Yunara 2026-11-27)
        self.col_seen.retain(|c| now - c.2 < 8.0);
        if !r.ids.is_empty() {
            for (k, &a) in r.ids.iter().enumerate() {
                if let Some(&x) = r.xs.get(k) {
                    self.col_seen.push((a, x, now));
                }
            }
        }
        let mut g: Vec<i64> = Vec::new();
        for c in self.col_seen.iter().rev() {
            if !is_band(c.0) && !self.picked.contains(&c.0) && !g.contains(&c.0) {
                g.push(c.0);
            }
        }
        g.truncate(4);
        self.glimpse = g;
        // a copy from League's covered window may open or change an offer but never closes one
        if r.ids.is_empty() && r.from_window {
            return;
        }
        let xs = r.xs.clone();
        // An augment you already took can't be offered again; a screen has 3 cards (4 with Maestro); text outside
        // the cards can match names, so anything less than a whole evenly spaced row must read the same twice
        // (Nami/Ashe 2026-11-25, "only sees Get Excited" 2026-11-24)
        let mut ids: Option<Vec<i64>> = Some(Vec::new());
        if !r.ids.is_empty() {
            let keep: Vec<usize> = (0..r.ids.len())
                .filter(|&k| !self.picked.contains(&r.ids[k]))
                .collect();
            let raw: Vec<i64> = keep.iter().map(|&k| r.ids[k]).collect();
            let cs: Vec<f64> = if xs.len() == r.ids.len() {
                keep.iter().map(|&k| xs[k]).collect()
            } else {
                Vec::new()
            };
            let prev = self.prev_raw.replace(raw.clone());
            let gaps: Vec<f64> = cs.windows(2).map(|w| w[1] - w[0]).collect();
            let spaced = gaps.len() >= 2
                && gaps.iter().cloned().fold(f64::INFINITY, f64::min) > 0.0
                && gaps.iter().cloned().fold(0.0, f64::max)
                    <= 1.25 * gaps.iter().cloned().fold(f64::INFINITY, f64::min);
            let even = gaps.len() == 3 && spaced;
            let whole = (raw.len() == 3 || raw.len() == 4) && cs.len() == raw.len() && spaced;
            if raw.len() < 2
                || raw.len() > 4
                || (raw.len() == 4 && !even)
                || (Some(&raw) != prev.as_ref() && raw != self.offer && !whole)
            {
                ids = if self.offer.is_empty() {
                    Some(Vec::new())
                } else {
                    None
                };
            } else {
                if cs.len() == raw.len() {
                    self.last_xs = cs;
                }
                ids = Some(raw);
            }
        } else {
            self.prev_raw = None;
        }
        let Some(ids) = ids else { return };
        if !ids.is_empty() {
            self.accept(now, ids);
        } else if self.offer.is_empty() && self.owed > 0 && !self.early_clicks.is_empty() {
            // only while a round is still owed: after this level's screen closed, clicks are play (Briar R1)
            if let Some(aid) = self.pick_from_columns(now) {
                self.events.push(Event::Closed {
                    cards: vec![aid],
                    pick: Some(aid),
                    replaced: false,
                    cols: true,
                });
                if !is_band(aid) {
                    self.owed = self.owed.saturating_sub(1);
                    self.rounds += 1;
                }
            }
        } else if !self.offer.is_empty() {
            self.gone(now, cursor);
        }
    }

    fn accept(&mut self, now: f64, ids: Vec<i64>) {
        self.misses = 0;
        self.seen_at = now;
        if self.last_xs.len() == ids.len() {
            self.layout = self.last_xs.clone();
        }
        let (closed_cards, closed_at, closed_level, closed_low) = match &self.closed {
            Some(c) => (c.cards.clone(), c.at, c.level, c.low),
            None => (Vec::new(), 0.0, 0, false),
        };
        // a reroll's card flip can read as a close: the cards back at the same level with one changed, within 20 s,
        // are that screen rerolled (Fiora 2026-11-27); after a low click any shared card counts (Yunara 2026-11-27)
        let keep = if closed_low {
            1
        } else {
            ids.len().saturating_sub(1)
        };
        let shared = ids.iter().filter(|a| closed_cards.contains(a)).count();
        let rerolled = !closed_cards.is_empty()
            && ids.len() == closed_cards.len()
            && ids.len() > shared
            && shared >= keep
            && closed_level == self.level
            && now - closed_at < 20.0;
        if self.offer.is_empty() && ((ids == closed_cards && now - closed_at < 6.0) || rerolled) {
            // the same cards again just after a close (alt-tab, card flip): that close was early. Same screen, same
            // round, and the last click on it still counts
            self.offer = ids.clone();
            if !ids.iter().all(|&i| is_band(i)) {
                self.rounds = self.rounds.saturating_sub(1);
                self.owed += 1;
            }
            if let Some(c) = self.closed.as_mut() {
                c.unmarked = false;
            }
            if let Some(cm) = self.close_marked.take() {
                if let Some(p) = self.picked.iter().position(|&x| x == cm) {
                    // that close was the screen flipping, so what it marked wasn't picked (Yunara, Irelia 2026-11-27)
                    self.picked.remove(p);
                    self.unmarked.insert(cm);
                    self.events.push(Event::Unmark(cm));
                    if self.auto_pick == Some(cm) {
                        self.auto_pick = None;
                    }
                }
            }
            if rerolled {
                self.last_click = None;
                self.card_clicks.clear();
                self.events.push(Event::Offer(ids));
            }
        } else if ids != self.offer {
            let old = self.offer.clone();
            if !old.is_empty() && !old.iter().any(|a| ids.contains(a)) {
                // a whole new screen straight after another (Shaco 2026-11-27: Pentakill's cards right after round 1's
                // pick): the old screen closed, its last click is its pick
                let click = self.mark_clicked(&old);
                let pick = click.map(|i| old[i]);
                self.events.push(Event::Closed {
                    cards: old.clone(),
                    pick,
                    replaced: true,
                    cols: false,
                });
                if !old.iter().all(|&i| is_band(i)) {
                    self.owed = self.owed.saturating_sub(1);
                    self.rounds += 1;
                }
                self.closed = Some(Closed {
                    cards: old.clone(),
                    at: now,
                    level: self.level,
                    low: false,
                    unmarked: click.is_none(),
                });
                self.close_marked = None;
                self.replaced_at = now;
                self.last_click = None;
            }
            self.offer = ids.clone();
            self.last_click = carry_click(self.last_click.take(), &self.card_clicks, &old, &ids);
            // a reroll or a new screen: only clicks on these cards count (a pick on a card the reroll didn't change
            // carries over: Alistar 2026-11-27)
            self.card_clicks.clear();
            if old.is_empty() {
                // clicks made before the cards were first read (Alistar 2026-11-27: picked 2 s after the screen opened)
                let early = std::mem::take(&mut self.early_clicks);
                for (x, y, at) in early {
                    if now - at < 6.0 {
                        if let Some(i) = self.card_at(x, y) {
                            if i < ids.len() {
                                let low = zone(y) == Some(Zone::Reroll);
                                self.card_clicks.push((ids.clone(), i, low));
                                if low {
                                    self.low_at = at;
                                } else {
                                    self.last_click = Some(Click {
                                        cards: ids.clone(),
                                        i,
                                        at,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            self.early_clicks.clear();
            self.events.push(Event::Offer(ids));
        }
    }

    fn gone(&mut self, now: f64, cursor: Option<(f64, f64)>) {
        // The cursor resting on the cards can cover the titles, so an empty read then proves nothing (Irelia
        // 2026-11-27). Empty reads count once the cursor is off the cards, or after 20 s.
        let hover = cursor.is_some_and(|(x, y)| self.card_at(x, y).is_some());
        self.hover_since = if hover {
            Some(self.hover_since.unwrap_or(now))
        } else {
            None
        };
        if !hover || self.hover_since.is_some_and(|h| now - h > 20.0) {
            self.misses += 1;
        }
        // gone for 2 reads and 1.5 s; after a low click only a screen still gone LOW_WAIT s later is a pick
        if self.misses >= 2 && now - self.seen_at >= 1.5 && now - self.low_at >= LOW_WAIT {
            let offer = self.offer.clone();
            let click = self.mark_clicked(&offer);
            let pick = click.map(|i| offer[i]);
            self.close_marked = pick;
            self.events.push(Event::Closed {
                cards: offer.clone(),
                pick,
                replaced: false,
                cols: false,
            });
            let band = offer.iter().all(|&i| is_band(i));
            if !band {
                self.owed = self.owed.saturating_sub(1);
                self.rounds += 1;
            }
            self.closed = Some(Closed {
                cards: offer,
                at: now,
                level: self.level,
                low: now - self.low_at < LOW_WAIT + 4.0,
                unmarked: click.is_none(),
            });
            self.offer.clear();
            self.misses = 0;
            for r in self.reached.iter_mut() {
                r.1 = f64::NEG_INFINITY;
            }
        }
    }

    /// Marks the card the last click landed on, when it was on these cards. Returns its index.
    fn mark_clicked(&mut self, offer: &[i64]) -> Option<usize> {
        let lc = self.last_click.take()?;
        if lc.cards != offer || self.game_clock() - lc.at > 60.0 {
            return None;
        }
        // the same card clicked low and again with no new read between: if that was a reroll, the card taken isn't
        // the one read. Better unmarked than wrong
        let same: Vec<&(Vec<i64>, usize, bool)> = self
            .card_clicks
            .iter()
            .filter(|c| c.0 == offer && c.1 == lc.i)
            .collect();
        if same.len() >= 2 && same[..same.len() - 1].iter().any(|c| c.2) {
            return None;
        }
        // a click on the reroll strip is a reroll at least as often as a pick: it marks nothing (Nico 2026-11-27)
        if same.last().is_some_and(|c| c.2) {
            return None;
        }
        let aid = offer[lc.i];
        // a new mark replaces the last one only when that was a card of this same screen (Shaco 2026-11-27)
        if let Some(auto) = self.auto_pick {
            if auto != aid && offer.contains(&auto) {
                self.picked.retain(|&x| x != auto);
            }
        }
        if !self.picked.contains(&aid) {
            self.picked.push(aid);
        }
        self.auto_pick = Some(aid);
        Some(lc.i)
    }

    fn game_clock(&self) -> f64 {
        self.now
    }

    /// A pick on a screen never read whole: a click on a card body at least 2 s ago and a title read in that card's
    /// column within 4 s of it, with another column's title read within 1.5 s of that one (a screen, not a tooltip).
    fn pick_from_columns(&mut self, now: f64) -> Option<i64> {
        let clicks: Vec<(f64, f64, f64)> = self
            .early_clicks
            .iter()
            .cloned()
            .filter(|e| now - e.2 < 8.0)
            .collect();
        self.early_clicks = clicks.iter().cloned().filter(|e| now - e.2 < 2.0).collect();
        // Briar 2026-11-27: clicks from before the last close were that screen's, and a closed screen's cards (last
        // minute) can't be picked again
        let (closed_at, stale): (f64, Vec<i64>) = match &self.closed {
            Some(c) => (
                c.at,
                if now - c.at < 60.0 {
                    c.cards.clone()
                } else {
                    Vec::new()
                },
            ),
            None => (0.0, Vec::new()),
        };
        let w = if self.width > 0.0 { self.width } else { 1920.0 };
        for &(x, y, at) in clicks.iter().rev() {
            if !(now - at >= 2.0 && at > closed_at + 0.5) || zone(y) != Some(Zone::Pick) {
                continue;
            }
            let near: Vec<&(i64, f64, f64)> = self
                .col_seen
                .iter()
                .filter(|c| {
                    (c.2 - at).abs() < 4.0 && !self.picked.contains(&c.0) && !stale.contains(&c.0)
                })
                .collect();
            let here: Vec<&&(i64, f64, f64)> =
                near.iter().filter(|c| (c.1 - x).abs() < 0.1 * w).collect();
            let other = near.iter().any(|c| {
                (c.1 - x).abs() >= 0.15 * w && here.iter().any(|h| (c.2 - h.2).abs() < 1.5)
            });
            if here.is_empty() || !other {
                continue;
            }
            let aid = here.iter().max_by(|a, b| a.2.total_cmp(&b.2))?.0;
            self.early_clicks.clear();
            if !self.picked.contains(&aid) {
                self.picked.push(aid);
            }
            self.auto_pick = Some(aid);
            return Some(aid);
        }
        None
    }

    /// A left click on League's window: x in screen pixels, y_rel how far down the window (0 top, 1 bottom).
    pub fn click(&mut self, now: f64, x: f64, y_rel: f64) {
        self.now = now;
        let (closed_cards, closed_at, closed_unmarked) = match &self.closed {
            Some(c) => (c.cards.clone(), c.at, c.unmarked),
            None => (Vec::new(), 0.0, false),
        };
        let mut late = self.offer.is_empty()
            && !closed_cards.is_empty()
            && closed_unmarked
            && now - closed_at < 4.0;
        // ... only for a screen you were clicking on (Briar 2026-11-27: a card set nobody clicked went away and play
        // clicks 2 s later "picked" Biggest Snowball Ever)
        late = late && self.card_clicks.iter().any(|c| c.0 == closed_cards);
        // new cards replaced the screen under the cursor: a click within a reaction time was meant for the old ones
        if !self.offer.is_empty()
            && !closed_cards.is_empty()
            && closed_unmarked
            && now - self.replaced_at < REACT
        {
            late = true;
        }
        let cards = if late {
            closed_cards
        } else {
            self.offer.clone()
        };
        if cards.is_empty() {
            if self.window {
                self.early_clicks.retain(|e| now - e.2 < 6.0);
                let n = self.early_clicks.len();
                if n > 5 {
                    self.early_clicks.drain(..n - 5);
                }
                self.early_clicks.push((x, y_rel, now));
                self.burst_until = now + 2.5;
            }
            return;
        }
        self.burst_until = now + 2.5;
        let Some(i) = self.card_at(x, y_rel) else {
            return;
        };
        if i >= cards.len() {
            return;
        }
        let low = zone(y_rel) == Some(Zone::Reroll);
        if low {
            self.low_at = now;
            self.burst_until = now + LOW_WAIT + 1.0;
        }
        self.card_clicks.retain(|c| c.0 == cards);
        self.card_clicks.push((cards.clone(), i, low));
        self.last_click = Some(Click {
            cards: cards.clone(),
            i,
            at: now,
        });
        if late && !low {
            if let Some(c) = self.closed.as_mut() {
                c.unmarked = false;
            }
            if let Some(k) = self.mark_clicked(&cards) {
                self.events.push(Event::Late(cards[k]));
            }
        }
    }

    /// The post-game list (exact): replaces what was read live.
    pub fn end_of_game(&mut self, augs: &[i64]) {
        if !augs.is_empty() {
            self.picked = augs.to_vec();
        }
    }
}

/// A click on the cards before a reroll's new cards were read: kept when it was a pick (not on the reroll strip) on
/// a card still offered, at that card's new place.
fn carry_click(
    last: Option<Click>,
    clicks: &[(Vec<i64>, usize, bool)],
    old: &[i64],
    new: &[i64],
) -> Option<Click> {
    let last = last?;
    if last.cards != old || new.is_empty() {
        return None;
    }
    let id = *old.get(last.i)?;
    let j = new.iter().position(|&a| a == id)?;
    if clicks
        .last()
        .is_some_and(|c| c.0 == old && c.1 == last.i && c.2)
    {
        return None;
    }
    Some(Click {
        cards: new.to_vec(),
        i: j,
        at: last.at,
    })
}
