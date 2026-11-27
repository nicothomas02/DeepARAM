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
const FRONT_POLL: Duration = Duration::from_millis(100);
const AWAY_WAIT: Duration = Duration::from_millis(1000);
/// How often the mouse is checked while a screen may be up (only then), to see which card the player clicks.
const CLICK_EVERY: Duration = Duration::from_millis(40);

#[derive(Default)]
pub struct State {
    /// A Mayhem game is running.
    in_game: bool,
    /// The player's Riot ID, to find their row in /playerlist.
    me: Option<String>,
    team: Option<String>,
    level: u64,
    /// The player is dead right now.
    dead: bool,
    /// Which card was taken, from screen reads and clicks: the shared tracker (crates/augtrack), the same rules as
    /// the owner's app (PC 1.26.58) and the same simulator gate.
    track: augtrack::Tracker,
    /// The tracker's clock starts with the game.
    clock: Option<Instant>,
    /// The augments on offer right now, left to right (what the companion shows).
    pub offer: Vec<i64>,
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

/// Seconds since the game started, on the tracker's clock.
fn clock(s: &State) -> f64 {
    s.clock.map_or(0.0, |c| c.elapsed().as_secs_f64())
}

/// What the tracker decided since the last look: the companion shows offers and marks picks (no tap in game).
fn publish(app: &AppHandle, events: Vec<augtrack::Event>) {
    for e in events {
        record(app, &e);
        match e {
            augtrack::Event::Offer(ids) => companion::show_offer(app, &ids),
            augtrack::Event::Closed { pick, .. } => {
                companion::show_offer(app, &[]);
                if let Some(id) = pick {
                    companion::auto_taken(app, id);
                }
            }
            augtrack::Event::Late(id) => companion::auto_taken(app, id),
            // a "close" that was a reroll's card flip: the companion keeps its mark until the next pick replaces it
            augtrack::Event::Unmark(_) => {}
        }
    }
}

/// Owner test recording (off unless a file named `record-offers` is in the app's data folder; never on for the
/// public): each offer's screen as a PNG plus a line per tracker event in offers/offers.jsonl, to replay offer
/// screens to augment readers (ours and others) without a live game, and to check picks against the game's own
/// post-game list.
/// Owner recording: the tracker's raw inputs (game ticks, screen reads, clicks) on its own clock, to
/// offers/inputs.jsonl, so a recorded game can be replayed through the real tracker (crates/augtrack) in tests.
fn input_log(app: &AppHandle, line: serde_json::Value) {
    let Ok(base) = app.path().app_data_dir() else { return };
    if !base.join("record-offers").exists() {
        return;
    }
    let dir = base.join("offers");
    let _ = std::fs::create_dir_all(&dir);
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("inputs.jsonl")) {
        let _ = writeln!(f, "{line}");
    }
}

fn record(app: &AppHandle, e: &augtrack::Event) {
    let Ok(base) = app.path().app_data_dir() else { return };
    if !base.join("record-offers").exists() {
        return;
    }
    let dir = base.join("offers");
    let _ = std::fs::create_dir_all(&dir);
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let line = match e {
        augtrack::Event::Offer(ids) => {
            let png = format!("{ms}.png");
            let saved = augscan::save_game_frame(&dir.join(&png));
            serde_json::json!({"t": ms, "offer": ids, "png": saved.then_some(png)})
        }
        augtrack::Event::Closed { cards, pick, replaced, cols } => {
            serde_json::json!({"t": ms, "closed": cards, "pick": pick, "replaced": replaced, "cols": cols})
        }
        augtrack::Event::Unmark(id) => serde_json::json!({"t": ms, "unmark": id}),
        augtrack::Event::Late(id) => serde_json::json!({"t": ms, "late": id}),
    };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("offers.jsonl")) {
        let _ = writeln!(f, "{line}");
    }
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
        s.dead = false;
        s.track = augtrack::Tracker::new();
        s.clock = Some(Instant::now());
        s.offer.clear();
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
        s.track = augtrack::Tracker::new();
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
        s.level = level;
        s.dead = dead;
        let now = clock(&s);
        let width = augscan::game_window().map_or(1920.0, |(_, _, w, _)| f64::from(w));
        s.track.game(now, game_time, level as u32, dead, augtrack::Headliner::None, width);
        drop(s);
        input_log(app, serde_json::json!({"now": now, "game": [game_time, level, dead, width]}));
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

/// A screen point as (x, how far down League's window 0-1), for the tracker.
fn to_game(x: i32, y: i32) -> Option<(f64, f64)> {
    let (_, gy, _, gh) = augscan::game_window()?;
    Some((f64::from(x), (f64::from(y) - f64::from(gy)) / f64::from(gh.max(1))))
}

/// Reads the screen once and gives the tracker what it found (ids with their screen x) and where the pointer rests.
fn scan(app: &AppHandle) {
    let Some(names) = names(app) else { return };
    let read = augscan::read_screen().map(|lines| {
        // a stray name plus three evenly spaced cards keeps the three (4 only with Maestro's even row)
        let cards = augscan::check_four(augscan::match_offer_at(&lines, &names));
        augtrack::Read {
            ids: cards.iter().map(|c| c.0).collect(),
            xs: cards.iter().map(|c| c.1).collect(),
            from_window: false,
            blank: false,
        }
    });
    // only the pointer: asking about the button here would take the click watcher's "pressed since" bit
    let cursor = augscan::pointer_at().and_then(|(x, y)| to_game(x, y));
    let events = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        let now = clock(&s);
        let logged = read
            .as_ref()
            .map(|r| serde_json::json!({"ids": r.ids, "xs": r.xs, "from_window": r.from_window, "blank": r.blank}));
        input_log(app, serde_json::json!({"now": now, "read": logged, "cursor": cursor}));
        s.track.read(now, read, cursor);
        s.offer = s.track.offer.clone();
        std::mem::take(&mut s.track.events)
    };
    publish(app, events);
}

/// While a screen may be up, notes each left click on League's window for the tracker. Read-only: it asks the OS
/// where the pointer is and whether the button is down, as any app can; nothing is hooked, moved or sent to the game.
fn watch_clicks(app: AppHandle) {
    thread::spawn(move || {
        let mut button = augtrack::Button::default();
        loop {
            let watching = {
                let s = app.state::<Shared>();
                let s = s.lock().unwrap();
                s.in_game && (s.track.window || !s.track.offer.is_empty())
            };
            let Some((down, since, sx, sy)) = augscan::mouse() else {
                return; // no mouse to read on this OS yet
            };
            // Every sample goes through the button, so a press made while no screen could be up is used up here and
            // never counts once one can.
            let clicked = button.sample(down, since);
            if !watching {
                thread::sleep(Duration::from_millis(250));
                continue;
            }
            // Only a click that lands in League counts: League is the active window, or the point is on League's
            // window with nothing over it (the click that brings League back from the companion is also the pick).
            // A click in a window over the game isn't a pick.
            if clicked && (augscan::league_in_front() || augscan::point_on_league(sx, sy)) {
                if let Some((x, y)) = to_game(sx, sy) {
                    let events = {
                        let state = app.state::<Shared>();
                        let mut s = state.lock().unwrap();
                        let now = clock(&s);
                        input_log(&app, serde_json::json!({"now": now, "click": [x, y]}));
                        s.track.click(now, x, y);
                        std::mem::take(&mut s.track.events)
                    };
                    publish(&app, events);
                }
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
        loop {
            let in_game = app.state::<Shared>().lock().unwrap().in_game;
            let every = if in_game { CHECK_IN_GAME } else { CHECK_EVERY };
            if last_check.is_none_or(|at| at.elapsed() >= every) {
                last_check = Some(Instant::now());
                let stats = if enabled(&app) { live(&agent, "/gamestats") } else { None };
                let mayhem = stats.as_ref().and_then(|s| s.get("gameMode")?.as_str()) == Some(MAYHEM_MODE);
                let game_time = stats.as_ref().and_then(|s| s.get("gameTime")?.as_f64()).unwrap_or(0.0);
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
                (s.in_game, s.in_game && s.track.window)
            };
            if read && scan_on(&app) {
                scan(&app);
                if augscan::league_in_front() {
                    let nap = {
                        let s = app.state::<Shared>();
                        let s = s.lock().unwrap();
                        s.track.nap(clock(&s), true)
                    };
                    thread::sleep(Duration::from_secs_f64(nap));
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
