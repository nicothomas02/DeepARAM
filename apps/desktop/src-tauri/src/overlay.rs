// The in-game overlay: during a Mayhem game, a small see-through panel at the edge of the screen shows the
// player's champion's quick build (skill order, spells, items, augments to look for).
//
// It stays within Riot's rules for third-party apps and works alongside Vanguard:
// - The only thing read from the game is League's own Live Client Data API on 127.0.0.1:2999, which Riot
//   documents for apps: the game mode and which champion the player is on. No game memory, no injection.
// - The panel is an ordinary always-on-top window that clicks pass through, so it shows over League in
//   Borderless or Windowed mode (not exclusive Fullscreen) and never takes input from the game.
// - It shows only the champion page's static picks, the same for everyone before the game: no win rates
//   (Riot bans augment win rates in overlays), nothing about other players, no timers, and it never picks.
use std::{
    collections::HashMap,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{
    companion, notify,
    review::{self, Sample},
    Store, SITE,
};

const LIVE: &str = "https://127.0.0.1:2999/liveclientdata";
const DATA_URL: &str = "https://deeparam.com/data/overlay.json";
/// Each champion's expected win rate, for the after-game review's team strength.
const FIT_URL: &str = "https://deeparam.com/data/team-fit.json";
/// Games shorter than this (remakes) get no review.
const REVIEW_MIN_SECONDS: f64 = 300.0;

/// Where the builds come from: the site, or in a debug build a file named by DEEPARAM_OVERLAY_DATA (for testing).
fn data_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("DEEPARAM_OVERLAY_DATA") {
        return url;
    }
    DATA_URL.to_owned()
}
/// The game mode the Live Client Data API reports for ARAM Mayhem.
pub(crate) const MAYHEM_MODE: &str = "KIWI";
const CHECK_EVERY: Duration = Duration::from_secs(5);
/// How often to look again during a game in "only when useful" mode, so the panel follows deaths quickly.
const CHECK_IN_GAME: Duration = Duration::from_secs(2);
/// "Only when useful" mode: the panel shows for the first part of the game (first buy, first augment)...
pub const START_FOR: f64 = 90.0;
/// ...while the player is dead (the time to shop in ARAM)...
/// ...and for a while after reaching a level that offers an augment (Mayhem: 1, 7, 11 and 15, from Nico).
/// Live Client Data doesn't report the augments themselves (27 of 27 recorded games had none), so the
/// level is the only signal.
pub const AUGMENT_LEVELS: &[u64] = &[1, 7, 11, 15];
pub const POPUP_FOR: f64 = 30.0;
/// How long a downloaded copy of the builds is reused before fetching it again.
const DATA_FOR: Duration = Duration::from_secs(60 * 60);
const WIDTH: f64 = 290.0;
const HEIGHT: f64 = 560.0;
const MARGIN: f64 = 16.0;
const LABEL: &str = "overlay";

pub fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyO)
}

#[derive(Default)]
pub struct State {
    /// A Mayhem game is running and its build is on the panel.
    in_game: bool,
    /// The player's Riot ID, to find their row in /playerlist.
    me: Option<String>,
    /// Whether the panel would show by itself right now (always true in "all game" mode).
    want: bool,
    /// Set by Ctrl+Shift+O: keeps the panel shown or hidden until `want` next changes.
    forced: Option<bool>,
    visible: bool,
    level: u64,
    popup_until: f64,
    /// The last script sent to the panel, sent again if the page reloads.
    script: Option<String>,
    data: Option<(Instant, Value)>,
    /// After-game review: this game's samples, the player's team, champion strengths and the game's result.
    samples: Vec<Sample>,
    team: Option<String>,
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

/// The champion the player is on, from /activeplayername and /playerlist.
pub fn my_champion(me: &str, players: &[Value]) -> Option<String> {
    my_row(me, players).and_then(|p| p.get("rawChampionName")?.as_str().and_then(champion_alias).map(str::to_owned))
}

/// Whether going from level `prev` to `level` passed an augment level. The first reading of a game
/// (`prev` 0) only records the level, so opening the app mid-game doesn't pop the panel up.
pub fn reached_augment_level(prev: u64, level: u64) -> bool {
    prev > 0 && AUGMENT_LEVELS.iter().any(|l| *l > prev && *l <= level)
}

/// "Only when useful" mode: whether the panel shows by itself at this moment of the game.
pub fn smart_wants(game_time: f64, dead: bool, popup_until: f64) -> bool {
    game_time < START_FOR || dead || game_time < popup_until
}

/// One champion's entry in overlay.json, matched on the alias without case ("FiddleSticks").
pub fn find_build<'a>(data: &'a Value, alias: &str) -> Option<&'a Value> {
    data.get("champions")?
        .as_array()?
        .iter()
        .find(|c| c.get("id").and_then(Value::as_str).is_some_and(|id| id.eq_ignore_ascii_case(alias)))
}

/// Where the panel goes: vertically centred on the left or right edge of the monitor, in physical pixels.
pub fn position(
    monitor_at: (i32, i32),
    monitor: (u32, u32),
    panel: (u32, u32),
    margin: u32,
    right: bool,
) -> (i32, i32) {
    let x = if right { monitor.0.saturating_sub(panel.0 + margin) } else { margin };
    let y = monitor.1.saturating_sub(panel.1) / 2;
    (monitor_at.0 + x as i32, monitor_at.1 + y as i32)
}

/// The Live Client Data API serves a certificate made for the game's own use, not one a public authority
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

fn builds(app: &AppHandle) -> Option<Value> {
    let state = app.state::<Shared>();
    if let Some((at, data)) = &state.lock().unwrap().data {
        if at.elapsed() < DATA_FOR {
            return Some(data.clone());
        }
    }
    let data: Value = ureq::get(data_url()).call().ok()?.body_mut().read_json().ok()?;
    state.lock().unwrap().data = Some((Instant::now(), data.clone()));
    Some(data)
}

pub fn enabled(app: &AppHandle) -> bool {
    !app.state::<Store>().saved.lock().unwrap().overlay_off
}

fn smart(app: &AppHandle) -> bool {
    !app.state::<Store>().saved.lock().unwrap().overlay_all_game
}

fn on_right(app: &AppHandle) -> bool {
    app.state::<Store>().saved.lock().unwrap().overlay_right
}

/// Made when a Mayhem game starts and destroyed when it ends, so no web view runs for it the rest of the time.
/// The page fills itself from `State::script` once loaded.
fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let loaded = app.clone();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("DeepARAM overlay")
        .inner_size(WIDTH, HEIGHT)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .on_page_load(move |win, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(script) = loaded.state::<Shared>().lock().unwrap().script.clone() {
                    let _ = win.eval(&script);
                }
            }
        })
        .build()
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Moves the panel to the chosen edge of the main monitor.
pub fn place(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let Ok(Some(monitor)) = win.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let panel = ((WIDTH * scale) as u32, (HEIGHT * scale) as u32);
    let at = monitor.position();
    let size = monitor.size();
    let (x, y) = position((at.x, at.y), (size.width, size.height), panel, (MARGIN * scale) as u32, on_right(app));
    let _ = win.set_size(PhysicalSize::new(panel.0, panel.1));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn show(app: &AppHandle) {
    if let Some(win) = window(app) {
        place(app);
        let _ = win.show();
        // Clicks go to the game underneath. Set once the window is on screen: GTK needs it shown first.
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.set_always_on_top(true);
    }
}

fn hide(app: &AppHandle) {
    if let Some(win) = window(app) {
        let _ = win.hide();
    }
}

/// The game started: finds the player's champion, fills the panel and shows it.
fn start(app: &AppHandle, agent: &ureq::Agent, game_time: f64) -> bool {
    let Some(me) = live(agent, "/activeplayername").and_then(|v| v.as_str().map(str::to_owned)) else {
        return false;
    };
    let players = live(agent, "/playerlist").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let Some(alias) = my_champion(&me, &players) else { return false };
    let Some(data) = builds(app) else { return false };
    let Some(build) = find_build(&data, &alias) else { return false };
    let script = format!("window.showBuild({})", json!({ "site": SITE, "patch": data.get("patch"), "build": build }));
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.script = Some(script.clone());
        s.in_game = true;
        s.me = Some(me);
        s.want = true;
        s.forced = None;
        s.visible = false;
        s.level = 0;
        s.popup_until = 0.0;
        s.samples.clear();
        s.team = my_row(s.me.as_deref().unwrap_or_default(), &players)
            .and_then(|r| r.get("team")?.as_str().map(str::to_owned));
        s.next_sample = 0.0;
        s.result = None;
    }
    match window(app) {
        Some(win) => {
            let _ = win.eval(&script);
        }
        None => {
            if build_window(app).is_err() {
                app.state::<Shared>().lock().unwrap().in_game = false;
                return false;
            }
        }
    }
    // The shortcut is only held during the game, so the keys stay free for other apps the rest of the time.
    let _ = app.global_shortcut().register(toggle_shortcut());
    tick(app, agent, game_time);
    let first = app.state::<Store>().update(|s| !std::mem::replace(&mut s.overlay_hint_shown, true));
    if first {
        notify(
            app,
            "Your quick build is on screen",
            "It shows over League in Borderless or Windowed mode. Ctrl+Shift+O hides it, and the tray menu turns it off.",
        );
    }
    true
}

/// The game ended or the overlay was turned off.
pub fn stop(app: &AppHandle) {
    let (was, samples, result) = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.visible = false;
        (std::mem::take(&mut s.in_game), std::mem::take(&mut s.samples), s.result.take())
    };
    if was {
        let _ = app.global_shortcut().unregister(toggle_shortcut());
    }
    // Closing the panel's web view frees its memory until the next game.
    if let Some(win) = window(app) {
        let _ = win.destroy();
    }
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
fn sample(app: &AppHandle, agent: &ureq::Agent, game_time: f64) {
    let team = {
        let state = app.state::<Shared>();
        let s = state.lock().unwrap();
        if game_time < s.next_sample {
            return;
        }
        s.team.clone()
    };
    let Some(team) = team else { return };
    let players = live(agent, "/playerlist").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    if players.is_empty() {
        return;
    }
    let events = live(agent, "/eventdata").and_then(|v| v.get("Events")?.as_array().cloned()).unwrap_or_default();
    let fit = strengths(app);
    let s = companion::sample_from(game_time, &team, &players, &events, &fit);
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
        .map(|t| json!({ "from": t.from, "to": t.to, "before": t.before, "after": t.after, "kills": t.kills, "towers": t.towers }))
        .collect();
    let points: Vec<Value> = r.points.iter().map(|(t, p)| json!([t, p])).collect();
    companion::show_review(app, json!({ "points": points, "turns": turns, "ffFrom": r.ff_from, "result": result }));
}

/// Shows or hides the panel when `want` (or the shortcut's choice) says it should change.
fn apply(app: &AppHandle, want: bool) {
    let change = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if want != s.want {
            s.want = want;
            s.forced = None;
        }
        let visible = s.forced.unwrap_or(s.want);
        (visible != s.visible).then(|| {
            s.visible = visible;
            visible
        })
    };
    match change {
        Some(true) => show(app),
        Some(false) => hide(app),
        None => {}
    }
}

/// During a game: works out whether the panel should be up right now.
fn tick(app: &AppHandle, agent: &ureq::Agent, game_time: f64) {
    if !smart(app) {
        return apply(app, true);
    }
    let me = app.state::<Shared>().lock().unwrap().me.clone();
    let players = live(agent, "/playerlist").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let row = me.as_deref().and_then(|me| my_row(me, &players));
    let dead = row.and_then(|r| r.get("isDead")?.as_bool()).unwrap_or(false);
    let level = row.and_then(|r| r.get("level")?.as_u64()).unwrap_or(0);
    let popup_until = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if level > s.level {
            if reached_augment_level(s.level, level) {
                s.popup_until = game_time + POPUP_FOR;
            }
            s.level = level;
        }
        s.popup_until
    };
    apply(app, smart_wants(game_time, dead, popup_until));
}

/// Ctrl+Shift+O during a game: flips the panel until the game next changes what it would show by itself.
pub fn on_shortcut(app: &AppHandle, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    let want = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if !s.in_game {
            return;
        }
        s.forced = Some(!s.visible);
        s.want
    };
    apply(app, want);
}

/// Checks every few seconds whether a Mayhem game is running. A refused connection on 127.0.0.1 costs
/// next to nothing, so this is light enough to run all the time.
pub fn watch(app: AppHandle) {
    thread::spawn(move || {
        let agent = local_agent();
        loop {
            let stats = if enabled(&app) { live(&agent, "/gamestats") } else { None };
            let mayhem = stats.as_ref().and_then(|s| s.get("gameMode")?.as_str()) == Some(MAYHEM_MODE);
            let game_time = stats.as_ref().and_then(|s| s.get("gameTime")?.as_f64()).unwrap_or(0.0);
            let in_game = app.state::<Shared>().lock().unwrap().in_game;
            if mayhem && !in_game {
                start(&app, &agent, game_time);
            } else if mayhem {
                tick(&app, &agent, game_time);
                sample(&app, &agent, game_time);
            } else if in_game {
                stop(&app);
            }
            let in_game = app.state::<Shared>().lock().unwrap().in_game;
            thread::sleep(if in_game && smart(&app) { CHECK_IN_GAME } else { CHECK_EVERY });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_from_raw_champion_name() {
        assert_eq!(champion_alias("game_character_displayname_MonkeyKing"), Some("MonkeyKing"));
        assert_eq!(champion_alias("game_character_displayname_"), None);
        assert_eq!(champion_alias("Wukong"), None);
    }

    #[test]
    fn finds_the_players_champion() {
        let players = vec![
            json!({"riotId": "Someone#EUW", "rawChampionName": "game_character_displayname_Ahri"}),
            json!({"riotId": "Nico#NA1", "summonerName": "Nico", "rawChampionName": "game_character_displayname_FiddleSticks"}),
        ];
        assert_eq!(my_champion("Nico#NA1", &players).as_deref(), Some("FiddleSticks"));
        assert_eq!(my_champion("Nico", &players).as_deref(), Some("FiddleSticks"));
        assert_eq!(my_champion("Nobody#0000", &players), None);
    }

    #[test]
    fn useful_moments_show_the_panel() {
        // The start of the game, while dead, and during an augment pop-up.
        assert!(smart_wants(10.0, false, 0.0));
        assert!(!smart_wants(START_FOR + 1.0, false, 0.0));
        assert!(smart_wants(600.0, true, 0.0));
        assert!(smart_wants(600.0, false, 610.0));
        assert!(!smart_wants(611.0, false, 610.0));
    }

    #[test]
    fn augment_levels_pop_the_panel_up() {
        assert!(reached_augment_level(6, 7));
        assert!(reached_augment_level(10, 12)); // two levels at once still counts 11
        assert!(!reached_augment_level(7, 8));
        assert!(!reached_augment_level(15, 18));
        assert!(!reached_augment_level(0, 9)); // first reading of the game
    }

    #[test]
    fn finds_the_players_row() {
        let players = vec![json!({"riotId": "Nico#NA1", "isDead": true, "level": 7})];
        let row = my_row("Nico#NA1", &players).unwrap();
        assert_eq!(row["level"].as_u64(), Some(7));
        assert!(my_row("Else#1", &players).is_none());
    }

    #[test]
    fn build_lookup_ignores_case() {
        let data = json!({"champions": [{"id": "Fiddlesticks", "name": "Fiddlesticks"}, {"id": "Ahri"}]});
        assert_eq!(find_build(&data, "FiddleSticks").and_then(|c| c["name"].as_str()), Some("Fiddlesticks"));
        assert!(find_build(&data, "Zed").is_none());
    }

    #[test]
    fn panel_sits_on_the_chosen_edge() {
        // 1920x1080 monitor at the origin, 290x560 panel, 16 px margin.
        assert_eq!(position((0, 0), (1920, 1080), (290, 560), 16, false), (16, 260));
        assert_eq!(position((0, 0), (1920, 1080), (290, 560), 16, true), (1614, 260));
        // A second monitor to the left of the main one.
        assert_eq!(position((-2560, 0), (2560, 1440), (290, 560), 16, false), (-2544, 440));
    }

    #[test]
    fn overlay_page_has_the_entry_point() {
        let page = include_str!("../../ui/overlay.html");
        assert!(page.contains("window.showBuild"));
        assert!(!page.to_lowercase().contains("win rate"));
    }
}
