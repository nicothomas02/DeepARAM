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
/// How often the screen is read while an augment offer may be up.
const SCAN_EVERY: Duration = Duration::from_millis(1000);
/// The first augment is picked in the game's first seconds...
pub const START_FOR: f64 = 90.0;
/// ...and one more at each of these levels (Mayhem: 1, 7, 11 and 15, from Nico).
pub const AUGMENT_LEVELS: &[u64] = &[1, 7, 11, 15];
/// How long after an augment level the screen is read for the offer (longer while an offer stays up).
pub const SCAN_FOR: f64 = 60.0;
/// Reads in a row without the offer before it counts as picked.
const GONE_AFTER: u32 = 2;

#[derive(Default)]
pub struct State {
    /// A Mayhem game is running.
    in_game: bool,
    /// The player's Riot ID, to find their row in /playerlist.
    me: Option<String>,
    team: Option<String>,
    level: u64,
    /// Game time until which the screen is read for an augment offer.
    scan_until: f64,
    /// The game's first pick is done (its offer came and went).
    first_done: bool,
    /// The augments on offer right now, left to right, as read off the screen.
    pub offer: Vec<i64>,
    /// Reads in a row that found no offer after one was up.
    gone: u32,
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
pub fn reached_augment_level(prev: u64, level: u64) -> bool {
    prev > 0 && AUGMENT_LEVELS.iter().any(|l| *l > prev && *l <= level)
}

/// Whether the screen should be read for an augment offer at this moment of the game.
pub fn scanning(game_time: f64, first_done: bool, scan_until: f64) -> bool {
    (game_time < START_FOR && !first_done) || game_time < scan_until
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
        s.scan_until = 0.0;
        s.first_done = false;
        s.offer.clear();
        s.gone = 0;
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
    let level = me.as_deref().and_then(|me| my_row(me, &players)).and_then(|r| r.get("level")?.as_u64()).unwrap_or(0);
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if level > s.level {
            if reached_augment_level(s.level, level) {
                s.scan_until = game_time + SCAN_FOR;
            }
            s.level = level;
        }
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

/// Reads the screen once for an augment offer and tells the companion window when it changes.
fn scan(app: &AppHandle, game_time: f64) {
    let Some(names) = names(app) else { return };
    let Some(lines) = augscan::read_screen() else { return };
    let found = augscan::match_offer(&lines, &names);
    let changed = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if found.len() >= 2 {
            s.gone = 0;
            // Still up (the player is thinking it over or rerolled): keep reading.
            s.scan_until = s.scan_until.max(game_time + 10.0);
            (s.offer != found).then(|| {
                s.offer = found;
                s.offer.clone()
            })
        } else if !s.offer.is_empty() {
            s.gone += 1;
            (s.gone >= GONE_AFTER).then(|| {
                // Picked: stop reading until the next augment level.
                s.offer.clear();
                s.scan_until = 0.0;
                s.first_done = true;
                Vec::new()
            })
        } else {
            None
        }
    };
    if let Some(offer) = changed {
        companion::show_offer(app, &offer);
    }
}

/// Checks every few seconds whether a Mayhem game is running. A refused connection on 127.0.0.1 costs
/// next to nothing, so this is light enough to run all the time.
pub fn watch(app: AppHandle) {
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
                (s.in_game, s.in_game && scanning(now, s.first_done, s.scan_until))
            };
            // The reading window closed with an offer still up (picked between two reads): it's gone now.
            let left = {
                let state = app.state::<Shared>();
                let mut s = state.lock().unwrap();
                (!read && !s.offer.is_empty()).then(|| {
                    s.offer.clear();
                    s.first_done = true;
                })
            };
            if left.is_some() {
                companion::show_offer(&app, &[]);
            }
            if read && scan_on(&app) {
                let now = game_time + last_check.map_or(0.0, |at| at.elapsed().as_secs_f64());
                scan(&app, now);
                thread::sleep(SCAN_EVERY);
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
        assert!(scanning(5.0, false, 0.0)); // the first pick
        assert!(!scanning(5.0, true, 0.0)); // already picked
        assert!(!scanning(START_FOR + 1.0, false, 0.0));
        assert!(scanning(600.0, true, 640.0)); // after an augment level
        assert!(!scanning(641.0, true, 640.0));
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
