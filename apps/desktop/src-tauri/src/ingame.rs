// The in-game watcher. During a Mayhem game it follows League's Live Client Data API on 127.0.0.1:2999 (which
// Riot documents for apps) for the after-game review and for the moments Mayhem offers augments; at those
// moments it reads the offer off the screen (augscan.rs) for the companion window.
//
// Nothing is ever drawn over the game (Nico 2026-11-21): everything shows in the companion window, a normal
// window that goes full screen on a second monitor. That also keeps the game's frame rate: no always-on-top
// window for Windows to blend over League, no global hotkey hook, and few requests to the game.
// No game memory is read and nothing is injected.
use std::{
    collections::HashMap,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    augscan, companion, notify,
    review::{self, Sample},
    Store,
};

const LIVE: &str = "https://127.0.0.1:2999/liveclientdata";
/// Augment names, to match the offer read off the screen.
const PICKS_URL: &str = "https://deeparam.com/data/augment-picks.json";
/// Each champion's expected win rate, for the after-game review's team strength.
const FIT_URL: &str = "https://deeparam.com/data/team-fit.json";
/// Games shorter than this (remakes) get no review.
const REVIEW_MIN_SECONDS: f64 = 300.0;
/// The game mode the Live Client Data API reports for ARAM Mayhem.
pub(crate) const MAYHEM_MODE: &str = "KIWI";
/// How often to look for a game, and how often to ask the game for its state during one.
const CHECK_EVERY: Duration = Duration::from_secs(5);
const CHECK_IN_GAME: Duration = Duration::from_secs(2);
/// How often the screen is read while an augment offer may be up: every 0.3 s with League in front (PC app
/// 1.26.31); otherwise there's nothing to read, and the next read comes as soon as League is back in front.
const SCAN_EVERY: Duration = Duration::from_millis(300);
const FRONT_POLL: Duration = Duration::from_millis(100);
const AWAY_WAIT: Duration = Duration::from_millis(1000);
/// The first augment is picked in the game's first seconds...
pub const START_FOR: f64 = 90.0;
/// ...and one more at each of these levels (Mayhem: 1, 7, 11 and 15, from Nico).
pub const AUGMENT_LEVELS: &[u64] = &[1, 7, 11, 15];
/// How long after an augment level the screen is read for the offer (longer while an offer stays up).
pub const SCAN_FOR: f64 = 60.0;
/// Reads in a row without the offer before it counts as picked, and how long it must have been missing: a reroll's
/// card flip can hide a card for a moment, which isn't a pick (PC app 1.26.31).
const GONE_AFTER: u32 = 2;
const GONE_FOR: Duration = Duration::from_millis(1500);
/// How often the mouse is checked while an offer is up (only then), to see which card the player clicks.
const CLICK_EVERY: Duration = Duration::from_millis(40);
/// A click on a card counts as the pick only if the cards closed within this long of it.
const PICK_WITHIN: Duration = Duration::from_secs(6);

#[derive(Default)]
pub struct State {
    /// A Mayhem game is running.
    in_game: bool,
    /// The player's Riot ID, to find their row in /playerlist.
    me: Option<String>,
    team: Option<String>,
    level: u64,
    /// Augment screens owed: levels 7, 11 and 15 reached whose offer hasn't come yet. Mayhem only opens the screen
    /// with the shop open (dead, or on the starting platform), so one reached while alive waits for the next death.
    owed: u32,
    /// The player is dead right now, and whether an offer was read during this death.
    dead: bool,
    saw_offer: bool,
    /// Game time until which the screen is read for an augment offer.
    scan_until: f64,
    /// The game's first pick is done (its offer came and went).
    first_done: bool,
    /// The augments on offer right now, left to right, as read off the screen.
    pub offer: Vec<i64>,
    /// A reading that differs from the offer shown, waiting for a second read to agree.
    pending: Vec<i64>,
    /// Augments taken this game (learned from clicks): never part of an offer again.
    taken: Vec<i64>,
    /// The same cards with their centres across the screen, for the click watcher.
    cards: Vec<(i64, f64)>,
    /// The card under the player's last click while the offer was up, and when.
    clicked: Option<(i64, Instant)>,
    /// Reads in a row that found no offer after one was up.
    gone: u32,
    /// When the offer was first missed, for GONE_FOR.
    gone_since: Option<Instant>,
    names: Option<Vec<(i64, String)>>,
    /// After-game review: this game's samples, champion strengths and the game's result.
    samples: Vec<Sample>,
    strengths: Option<HashMap<String, f64>>,
    next_sample: f64,
    result: Option<String>,
}

pub type Shared = Mutex<State>;

/// `rawChampionName` is "game_character_displayname_<Alias>", whatever language the game runs in.
pub fn champion_alias(raw: &str) -> Option<&str> {
    raw.strip_prefix("game_character_displayname_").filter(|a| !a.is_empty())
}

/// The player's own row in /playerlist, by the Riot ID from /activeplayername.
pub fn my_row<'a>(me: &str, players: &'a [Value]) -> Option<&'a Value> {
    let id = |p: &Value, key: &str| p.get(key).and_then(Value::as_str).map(str::to_owned);
    players.iter().find(|p| id(p, "riotId").as_deref() == Some(me) || id(p, "summonerName").as_deref() == Some(me))
}

/// Whether going from level `prev` to `level` passed an augment level. The first reading of a game
/// (`prev` 0) only records the level, so opening the app mid-game doesn't start a read.
#[cfg(test)]
pub fn reached_augment_level(prev: u64, level: u64) -> bool {
    augment_levels_passed(prev, level) > 0
}

/// How many augment levels going from `prev` to `level` passed (two at once still owe two screens).
pub fn augment_levels_passed(prev: u64, level: u64) -> u32 {
    if prev == 0 {
        return 0;
    }
    AUGMENT_LEVELS.iter().filter(|l| **l > prev && **l <= level).count() as u32
}

/// Whether the screen should be read for an augment offer at this moment of the game: the first pick, just after an
/// augment level, or while dead with a screen still owed (it opens with the shop).
pub fn scanning(game_time: f64, first_done: bool, scan_until: f64, owed_and_dead: bool) -> bool {
    (game_time < START_FOR && !first_done) || game_time < scan_until || owed_and_dead
}

/// The League client and the game serve their local APIs with Riot's own certificate, not one a public authority
/// signs, so this client skips certificate checks. It only ever talks to 127.0.0.1, so nothing leaves the PC.
pub(crate) fn local_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .tls_config(ureq::tls::TlsConfig::builder().disable_verification(true).build())
        // Never send 127.0.0.1 through a proxy set for the internet.
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(2)))
        .build()
        .into()
}

fn live(agent: &ureq::Agent, path: &str) -> Option<Value> {
    agent.get(format!("{LIVE}{path}")).call().ok()?.body_mut().read_json().ok()
}

/// A Mayhem game is running (as the game's own API reports it).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn in_game(app: &AppHandle) -> bool {
    app.state::<Shared>().lock().unwrap().in_game
}

/// The watcher runs while the companion window is on (it's where everything shows).
pub fn enabled(app: &AppHandle) -> bool {
    companion::enabled(app)
}

fn scan_on(app: &AppHandle) -> bool {
    augscan::available() && !app.state::<Store>().saved.lock().unwrap().scan_off
}

/// The game started: notes who the player is and resets the game's state.
fn start(app: &AppHandle, agent: &ureq::Agent) -> bool {
    let Some(me) = live(agent, "/activeplayername").and_then(|v| v.as_str().map(str::to_owned)) else {
        return false;
    };
    let players = live(agent, "/playerlist").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let Some(row) = my_row(&me, &players) else { return false };
    let team = row.get("team").and_then(Value::as_str).map(str::to_owned);
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.in_game = true;
        s.me = Some(me);
        s.team = team;
        s.level = 0;
        s.owed = 0;
        s.dead = false;
        s.saw_offer = false;
        s.scan_until = 0.0;
        s.first_done = false;
        s.offer.clear();
        s.cards.clear();
        s.clicked = None;
        s.pending.clear();
        s.taken.clear();
        s.gone = 0;
        s.gone_since = None;
        s.samples.clear();
        s.next_sample = 0.0;
        s.result = None;
    }
    if scan_on(app) {
        let first = app.state::<Store>().update(|s| !std::mem::replace(&mut s.scan_hint_shown, true));
        if first {
            notify(
                app,
                "Augment offers show in DeepARAM",
                "The companion window reads the augment cards off your screen. Play in Borderless or Windowed mode.",
            );
        }
    }
    true
}

/// The game ended or the watcher was turned off.
pub fn stop(app: &AppHandle) {
    let (was, samples, result) = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.offer.clear();
        s.cards.clear();
        s.clicked = None;
        (std::mem::take(&mut s.in_game), std::mem::take(&mut s.samples), s.result.take())
    };
    if was && samples.last().is_some_and(|s| s.t >= REVIEW_MIN_SECONDS) {
        show_review(app, &samples, result);
    }
}

fn strengths(app: &AppHandle) -> HashMap<String, f64> {
    if let Some(s) = app.state::<Shared>().lock().unwrap().strengths.clone() {
        return s;
    }
    let fit: Option<Value> = ureq::get(FIT_URL).call().ok().and_then(|mut r| r.body_mut().read_json().ok());
    let map: HashMap<String, f64> = fit
        .as_ref()
        .and_then(|f| f.get("champions")?.as_object())
        .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.get(0)?.as_f64()?))).collect())
        .unwrap_or_default();
    if !map.is_empty() {
        app.state::<Shared>().lock().unwrap().strengths = Some(map.clone());
    }
    map
}

/// During a game, every review::SAMPLE_EVERY seconds: team kills, structures and levels, ally minus enemy.
fn sample(app: &AppHandle, agent: &ureq::Agent, game_time: f64, players: &[Value]) {
    let team = {
        let state = app.state::<Shared>();
        let s = state.lock().unwrap();
        if game_time < s.next_sample {
            return;
        }
        s.team.clone()
    };
    let Some(team) = team else { return };
    if players.is_empty() {
        return;
    }
    let events = live(agent, "/eventdata").and_then(|v| v.get("Events")?.as_array().cloned()).unwrap_or_default();
    let fit = strengths(app);
    let s = companion::sample_from(game_time, &team, players, &events, &fit);
    let result = events
        .iter()
        .find(|e| e.get("EventName").and_then(Value::as_str) == Some("GameEnd"))
        .and_then(|e| e.get("Result")?.as_str().map(str::to_owned));
    let state = app.state::<Shared>();
    let mut st = state.lock().unwrap();
    st.samples.push(s);
    st.next_sample = game_time + review::SAMPLE_EVERY;
    if result.is_some() {
        st.result = result;
    }
}

/// After the game: the predicted chance over time, in the companion window.
fn show_review(app: &AppHandle, samples: &[Sample], result: Option<String>) {
    let r = review::analyse(samples);
    let turns: Vec<Value> = r
        .turns
        .iter()
        .map(|t| serde_json::json!({ "from": t.from, "to": t.to, "before": t.before, "after": t.after, "kills": t.kills, "towers": t.towers }))
        .collect();
    let points: Vec<Value> = r.points.iter().map(|(t, p)| serde_json::json!([t, p])).collect();
    companion::show_review(
        app,
        serde_json::json!({ "points": points, "turns": turns, "ffFrom": r.ff_from, "result": result }),
    );
}

/// During a game: the player's level (an augment level starts a read of the screen) and the review's samples.
fn tick(app: &AppHandle, agent: &ureq::Agent, game_time: f64) {
    let me = app.state::<Shared>().lock().unwrap().me.clone();
    let players = live(agent, "/playerlist").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let row = me.as_deref().and_then(|me| my_row(me, &players));
    let level = row.and_then(|r| r.get("level")?.as_u64()).unwrap_or(0);
    let dead = row.and_then(|r| r.get("isDead")?.as_bool()).unwrap_or(false);
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if level > s.level {
            let passed = augment_levels_passed(s.level, level);
            if passed > 0 {
                s.owed += passed;
                s.scan_until = game_time + SCAN_FOR;
            }
            s.level = level;
        }
        died_or_respawned(&mut s, dead);
    }
    sample(app, agent, game_time, &players);
}

fn names(app: &AppHandle) -> Option<Vec<(i64, String)>> {
    if let Some(n) = app.state::<Shared>().lock().unwrap().names.clone() {
        return Some(n);
    }
    let picks: Value = ureq::get(PICKS_URL).call().ok()?.body_mut().read_json().ok()?;
    let names = augscan::names_from(&picks);
    if names.is_empty() {
        return None;
    }
    app.state::<Shared>().lock().unwrap().names = Some(names.clone());
    Some(names)
}

/// A death starts a fresh look for the owed screen; respawning after a death with no offer on screen means none was
/// coming (the owed count is a guess from levels, so it can't wait forever).
fn died_or_respawned(s: &mut State, dead: bool) {
    if dead && !s.dead {
        s.saw_offer = false;
    } else if !dead && s.dead && !s.saw_offer && s.offer.is_empty() {
        s.owed = 0;
    }
    s.dead = dead;
}

/// Reads the screen once for an augment offer and tells the companion window when it changes.
fn scan(app: &AppHandle, game_time: f64) {
    let Some(names) = names(app) else { return };
    let Some(lines) = augscan::read_screen() else { return };
    let cards = augscan::match_offer_at(&lines, &names);
    let (changed, picked) = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        read_offer(&mut s, cards, game_time)
    };
    if let Some(offer) = changed {
        companion::show_offer(app, &offer);
    }
    if let Some(id) = picked {
        companion::auto_taken(app, id);
    }
}

/// One reading of the screen: the offer to show if it changed, and the pick if the offer just closed.
/// Augments already taken can't be on offer (text outside the cards, like the player's own augment list, can name
/// them), and a new offer counts only once two reads in a row agree on it (PC app 1.26.3).
fn read_offer(s: &mut State, cards: Vec<(i64, f64)>, game_time: f64) -> (Option<Vec<i64>>, Option<i64>) {
    let cards: Vec<(i64, f64)> = cards.into_iter().filter(|(id, _)| !s.taken.contains(id)).collect();
    let cards = augscan::check_four(cards);
    let found: Vec<i64> = cards.iter().map(|(id, _)| *id).collect();
    if found.len() >= 2 {
        s.gone = 0;
        s.gone_since = None;
        s.saw_offer = true;
        // Still up (the player is thinking it over or rerolled): keep reading.
        s.scan_until = s.scan_until.max(game_time + 10.0);
        if s.offer == found {
            s.cards = cards;
            s.pending.clear();
            return (None, None);
        }
        // A full row of evenly spaced cards (three, or Maestro's four) counts after one read (PC app 1.26.31); a
        // pair of names still needs two reads in a row that agree.
        let full = cards.len() >= 3 && augscan::evenly_spaced(&cards);
        if !full && s.pending != found {
            s.pending = found;
            return (None, None);
        }
        // A new offer or a reroll: a click before it picked nothing.
        s.pending.clear();
        s.cards = cards;
        s.clicked = None;
        s.offer = found;
        return (Some(s.offer.clone()), None);
    }
    s.pending.clear();
    if s.offer.is_empty() {
        return (None, None);
    }
    s.gone += 1;
    let since = *s.gone_since.get_or_insert_with(Instant::now);
    if s.gone < GONE_AFTER || since.elapsed() < GONE_FOR {
        return (None, None);
    }
    s.gone_since = None;
    // Picked: stop reading until the next augment level.
    let picked = close_offer(s);
    s.scan_until = 0.0;
    (Some(Vec::new()), picked)
}

/// The offer is gone: the card clicked shortly before is the pick (the cards close on the click that picks).
fn close_offer(s: &mut State) -> Option<i64> {
    let was = std::mem::take(&mut s.offer);
    s.cards.clear();
    // The game's first pick isn't one of the owed screens.
    if s.first_done {
        s.owed = s.owed.saturating_sub(1);
    }
    s.first_done = true;
    let picked = s.clicked.take().filter(|(id, at)| at.elapsed() <= PICK_WITHIN && was.contains(id)).map(|(id, _)| id);
    if let Some(id) = picked {
        s.taken.push(id);
    }
    picked
}

/// While an offer is up, notes which card each left click lands on. Read-only: it asks Windows where the pointer
/// is and whether the button is down, as any app can; nothing is hooked, moved or sent to the game. Between offers
/// it only checks, a few times a second, whether one is up.
fn watch_clicks(app: AppHandle) {
    thread::spawn(move || {
        let mut was_down = false;
        loop {
            let cards = app.state::<Shared>().lock().unwrap().cards.clone();
            if cards.len() < 2 {
                was_down = false;
                thread::sleep(Duration::from_millis(250));
                continue;
            }
            if let Some((down, x, y)) = augscan::mouse() {
                // Only a click on League itself counts: a click in a window over the game isn't a pick.
                if down && !was_down && augscan::league_in_front() {
                    let on_cards = augscan::game_window().is_some_and(|(gx, gy, gw, gh)| {
                        let (ax, ay, aw, ah) = augscan::card_area(gx, gy, gw, gh);
                        x >= ax && x < ax + aw && y >= ay && y < ay + ah
                    });
                    let card = if on_cards { augscan::card_at(&cards, f64::from(x)) } else { None };
                    // Clicking a card picks it, so the first card clicked counts: later clicks (the game going on
                    // while the cards fade) don't replace it. A reroll changes the offer, which clears it.
                    let state = app.state::<Shared>();
                    let mut s = state.lock().unwrap();
                    if s.clicked.is_none() {
                        s.clicked = card.map(|id| (id, Instant::now()));
                    }
                }
                was_down = down;
            } else {
                // No mouse to read (not Windows): nothing to watch.
                return;
            }
            thread::sleep(CLICK_EVERY);
        }
    });
}

/// Checks every few seconds whether a Mayhem game is running. A refused connection on 127.0.0.1 costs
/// next to nothing, so this is light enough to run all the time.
pub fn watch(app: AppHandle) {
    watch_clicks(app.clone());
    thread::spawn(move || {
        let agent = local_agent();
        let mut last_check: Option<Instant> = None;
        let mut game_time = 0.0;
        loop {
            let in_game = app.state::<Shared>().lock().unwrap().in_game;
            let every = if in_game { CHECK_IN_GAME } else { CHECK_EVERY };
            if last_check.is_none_or(|at| at.elapsed() >= every) {
                last_check = Some(Instant::now());
                let stats = if enabled(&app) { live(&agent, "/gamestats") } else { None };
                let mayhem = stats.as_ref().and_then(|s| s.get("gameMode")?.as_str()) == Some(MAYHEM_MODE);
                game_time = stats.as_ref().and_then(|s| s.get("gameTime")?.as_f64()).unwrap_or(0.0);
                if mayhem && !in_game {
                    start(&app, &agent);
                } else if mayhem {
                    tick(&app, &agent, game_time);
                } else if in_game {
                    stop(&app);
                }
            }
            let (in_game, read) = {
                let state = app.state::<Shared>();
                let s = state.lock().unwrap();
                let now = game_time + last_check.map_or(0.0, |at| at.elapsed().as_secs_f64());
                (s.in_game, s.in_game && scanning(now, s.first_done, s.scan_until, s.owed > 0 && s.dead))
            };
            // The reading window closed with an offer still up (picked between two reads): it's gone now.
            let left = {
                let state = app.state::<Shared>();
                let mut s = state.lock().unwrap();
                (!read && !s.offer.is_empty()).then(|| close_offer(&mut s))
            };
            if let Some(picked) = left {
                companion::show_offer(&app, &[]);
                if let Some(id) = picked {
                    companion::auto_taken(&app, id);
                }
            }
            if read && scan_on(&app) {
                let now = game_time + last_check.map_or(0.0, |at| at.elapsed().as_secs_f64());
                scan(&app, now);
                if augscan::league_in_front() {
                    thread::sleep(SCAN_EVERY);
                } else {
                    // Away from League: read again the moment it's back in front.
                    let away = Instant::now();
                    while away.elapsed() < AWAY_WAIT && !augscan::league_in_front() {
                        thread::sleep(FRONT_POLL);
                    }
                }
            } else {
                thread::sleep(if in_game { CHECK_IN_GAME } else { CHECK_EVERY });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn alias_from_raw_champion_name() {
        assert_eq!(champion_alias("game_character_displayname_MonkeyKing"), Some("MonkeyKing"));
        assert_eq!(champion_alias("game_character_displayname_"), None);
        assert_eq!(champion_alias("Wukong"), None);
    }

    #[test]
    fn augment_levels_start_a_read() {
        assert!(reached_augment_level(6, 7));
        assert!(reached_augment_level(10, 12)); // two levels at once still counts 11
        assert!(!reached_augment_level(7, 8));
        assert!(!reached_augment_level(15, 18));
        assert!(!reached_augment_level(0, 9)); // first reading of the game
    }

    #[test]
    fn reads_only_while_an_offer_can_be_up() {
        assert!(scanning(5.0, false, 0.0, false)); // the first pick
        assert!(!scanning(5.0, true, 0.0, false)); // already picked
        assert!(!scanning(START_FOR + 1.0, false, 0.0, false));
        assert!(scanning(600.0, true, 640.0, false)); // after an augment level
        assert!(!scanning(641.0, true, 640.0, false));
        assert!(scanning(900.0, true, 640.0, true)); // dead with a screen owed
    }

    #[test]
    fn an_offer_needs_two_matching_reads_unless_the_row_is_full_and_even() {
        let mut s = State { first_done: true, taken: vec![9], ..Default::default() };
        // Unevenly spaced (a stray name), so two reads in a row must agree.
        let uneven = |ids: &[i64]| ids.iter().zip([100.0, 160.0, 700.0]).map(|(id, x)| (*id, x)).collect::<Vec<_>>();
        assert_eq!(read_offer(&mut s, uneven(&[1, 2, 3]), 10.0), (None, None)); // first read: waits
        assert_eq!(read_offer(&mut s, uneven(&[1, 2, 3]), 11.0), (Some(vec![1, 2, 3]), None));
        // A full, evenly spaced row counts after one read (PC app 1.26.31); a taken augment named elsewhere doesn't
        // count as a card.
        let even = |ids: &[i64]| ids.iter().enumerate().map(|(i, id)| (*id, 100.0 + 400.0 * i as f64)).collect::<Vec<_>>();
        assert_eq!(read_offer(&mut s, even(&[1, 4, 3]), 12.0), (Some(vec![1, 4, 3]), None));
        // A reroll's flip: two misses inside 1.5 s aren't a close.
        s.clicked = Some((4, Instant::now()));
        assert_eq!(read_offer(&mut s, vec![], 13.0), (None, None));
        assert_eq!(read_offer(&mut s, vec![], 13.3), (None, None));
        assert!(!s.offer.is_empty());
        // Missing for 1.5 s and two reads: closed, and the recent click on a card is the pick, never offered again.
        s.gone_since = Some(Instant::now() - Duration::from_secs(2));
        assert_eq!(read_offer(&mut s, vec![], 15.0), (Some(vec![]), Some(4)));
        assert!(s.taken.contains(&4));
    }

    #[test]
    fn owed_screens_wait_for_a_death() {
        assert_eq!(augment_levels_passed(6, 7), 1);
        assert_eq!(augment_levels_passed(10, 15), 2);
        assert_eq!(augment_levels_passed(0, 9), 0);
        // Level 7 reached alive: owed until the death that opens the shop.
        let mut s = State { owed: 1, first_done: true, ..Default::default() };
        died_or_respawned(&mut s, true);
        assert!(s.dead && !s.saw_offer);
        s.offer = vec![1, 2, 3];
        s.saw_offer = true;
        assert_eq!(close_offer(&mut s), None);
        assert_eq!(s.owed, 0);
        // A death with no offer on screen: nothing was coming, stop looking.
        let mut s = State { owed: 1, first_done: true, ..Default::default() };
        died_or_respawned(&mut s, true);
        died_or_respawned(&mut s, false);
        assert_eq!(s.owed, 0);
        // The first pick doesn't use up an owed screen.
        let mut s = State { owed: 1, offer: vec![1, 2], ..Default::default() };
        close_offer(&mut s);
        assert_eq!(s.owed, 1);
    }

    #[test]
    fn a_recent_click_on_an_offered_card_is_the_pick() {
        let mut s = State { offer: vec![1, 2, 3], clicked: Some((2, Instant::now())), ..Default::default() };
        assert_eq!(close_offer(&mut s), Some(2));
        assert!(s.offer.is_empty() && s.first_done && s.clicked.is_none());
        // No click, or a click on a card no longer offered: no pick.
        let mut s = State { offer: vec![1, 2, 3], ..Default::default() };
        assert_eq!(close_offer(&mut s), None);
        let mut s = State { offer: vec![1, 2, 3], clicked: Some((9, Instant::now())), ..Default::default() };
        assert_eq!(close_offer(&mut s), None);
    }

    #[test]
    fn finds_the_players_row() {
        let players = vec![
            json!({"riotId": "Someone#EUW", "level": 3}),
            json!({"riotId": "Nico#NA1", "summonerName": "Nico", "isDead": true, "level": 7}),
        ];
        assert_eq!(my_row("Nico#NA1", &players).unwrap()["level"].as_u64(), Some(7));
        assert_eq!(my_row("Nico", &players).unwrap()["level"].as_u64(), Some(7));
        assert!(my_row("Else#1", &players).is_none());
    }
}
