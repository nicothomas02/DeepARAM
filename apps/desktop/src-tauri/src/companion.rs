// The companion window: a normal window that opens by itself when a Mayhem champion select starts. Once the game
// is on, it goes full screen on a monitor League isn't on (Nico 2026-11-21: never over the game), and Esc or F11
// takes it out of full screen. With one monitor it stays an ordinary window behind the game.
//
//   champion select   best picks for your team from your bench and your own champion (public data: each
//                     champion's strength plus how it pairs with your allies, /data/team-fit.json). It only
//                     suggests; it never picks, and it shows no player names.
//   in game           everyone: the quick build, the augment panel (your champion's augments in ranking order,
//                     re-ranked by synergy with the ones you mark as taken, plus a search; during a pick, the
//                     offered augments read off the screen by augscan.rs) and the next item for your build. Build
//                     suggestions are allowed; augment win rates are not, so the panel shows a ranking only.
//                     The site owner only: also the chance to win and whether a surrender pays off now, kept small
//                     under the build (the build stays the focus; the chart waits for the review). Riot's rules don't
//                     let apps draw conclusions for players during a game, so nobody else gets that. Owner = this Riot account is connected to the site
//                     owner's account (the site's /api/history "available" answer, as the My Stats helper asks).
//   after the game    everyone: the predicted chance over the game, its turning points and from when a surrender
//                     would have paid off (overlay.rs samples the game, review.rs works it out).
//
// Light on purpose: one request to the League client every POLL seconds while it's open, one to the game every
// LIVE_EVERY seconds, none while League is closed (a lockfile and process-list check every IDLE seconds).
// It reads only the League client's and the game's own local APIs on 127.0.0.1; nothing is injected or read from
// game memory. The window's web view exists only while it's open.
use std::{
    collections::HashMap,
    fs,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{webview::PageLoadEvent, AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::{
    augscan,
    ingame::{self, champion_alias, local_agent, my_row, MAYHEM_MODE},
    procs,
    review::{self, Sample},
    Store, SITE,
};

pub(crate) const LABEL: &str = "companion";
const POLL: Duration = Duration::from_secs(3);
const IDLE: Duration = Duration::from_secs(15);
const LIVE_EVERY: Duration = Duration::from_secs(5);
const LIVE: &str = "https://127.0.0.1:2999/liveclientdata/allgamedata";
#[cfg(windows)]
const LOCKFILES: &[&str] = &[r"C:\Riot Games\League of Legends\lockfile", r"D:\Riot Games\League of Legends\lockfile"];
#[cfg(not(windows))]
const LOCKFILES: &[&str] = &[];
/// League client region -> the site's platform id (as the My Stats helper sends it).
const PLATFORMS: &[(&str, &str)] = &[
    ("NA", "na1"),
    ("BR", "br1"),
    ("LAN", "la1"),
    ("LA1", "la1"),
    ("LAS", "la2"),
    ("LA2", "la2"),
    ("EUW", "euw1"),
    ("EUNE", "eun1"),
    ("EUN", "eun1"),
    ("TR", "tr1"),
    ("RU", "ru"),
    ("ME", "me1"),
    ("KR", "kr"),
    ("JP", "jp1"),
    ("OCE", "oc1"),
    ("OC1", "oc1"),
    ("SG", "sg2"),
    ("PH", "sg2"),
    ("TH", "sg2"),
    ("TW", "tw2"),
    ("VN", "vn2"),
];

#[derive(Default)]
pub struct State {
    /// The last script sent to the window, sent again when its page (re)loads.
    script: Option<String>,
    /// Whether this Riot account belongs to the site owner (None until asked).
    owner: Option<bool>,
    /// Closed by the player during this phase: stays closed until the next champion select.
    dismissed: bool,
    phase: String,
    under_since: Option<f64>,
    last_live: Option<Instant>,
    /// Moved to the second monitor for this game.
    placed: bool,
    /// When the owner check last failed (no answer): tried again after OWNER_RETRY, not every poll.
    owner_tried: Option<Instant>,
    /// The game's result from the client's end-of-game screen ("Win" or "Lose").
    result: Option<String>,
    /// Champions this player can play (owned or in the free rotation), read once per champion select: only those can
    /// be taken from the bench or come from a reroll.
    playable: Option<Vec<i64>>,
}

const OWNER_RETRY: Duration = Duration::from_secs(300);

/// "Win" or "Lose" from the client's end-of-game stats (/lol-end-of-game/v1/eog-stats-block).
pub fn eog_result(block: &Value) -> Option<&'static str> {
    let mine =
        block.get("teams")?.as_array()?.iter().find(|t| t.get("isPlayerTeam").and_then(Value::as_bool) == Some(true));
    let won = mine
        .and_then(|t| t.get("isWinningTeam")?.as_bool())
        .or_else(|| Some(block.get("localPlayer")?.get("stats")?.get("WIN")?.as_f64()? > 0.0))?;
    Some(if won { "Win" } else { "Lose" })
}

/// Your augments in pick order from the client's end-of-game stats (PLAYER_AUGMENT_1-6, the same as the match data,
/// there the moment the game ends). Fills any pick the live reading missed. Empty when not found.
pub fn eog_augments(block: &Value) -> Vec<i64> {
    let local = block.get("localPlayer");
    let id = local.and_then(|l| l.get("summonerId"));
    let mut cands: Vec<&Value> = local.into_iter().collect();
    for t in block.get("teams").and_then(Value::as_array).into_iter().flatten() {
        for p in t.get("players").and_then(Value::as_array).into_iter().flatten() {
            if p.get("isLocalPlayer").and_then(Value::as_bool) == Some(true) || (id.is_some() && p.get("summonerId") == id) {
                cands.push(p);
            }
        }
    }
    for c in cands {
        let Some(st) = c.get("stats").and_then(Value::as_object) else { continue };
        if !st.keys().any(|k| k.to_ascii_uppercase().starts_with("PLAYER_AUGMENT_")) {
            continue;
        }
        return (1..=6)
            .filter_map(|i| st.get(&format!("PLAYER_AUGMENT_{i}")).or_else(|| st.get(&format!("playerAugment{i}"))))
            .filter_map(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).or_else(|| v.as_str()?.parse().ok()))
            .filter(|&v| v > 0)
            .collect();
    }
    Vec::new()
}

pub type Shared = Mutex<State>;

pub fn enabled(app: &AppHandle) -> bool {
    !app.state::<Store>().saved.lock().unwrap().companion_off
}

/// "LeagueClient:<pid>:<port>:<password>:<protocol>" -> (port, password).
pub fn parse_lockfile(text: &str) -> Option<(u16, String)> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    let n = parts.len();
    Some((parts[2].parse().ok()?, parts[3..n - 1].join(":")))
}

/// The League client's game phase ("Lobby", "ChampSelect"...): Ok(None) when the client isn't running, Err when it
/// runs but doesn't answer.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn client_phase() -> Result<Option<String>, ()> {
    let Some((port, pw)) = find_client() else { return Ok(None) };
    Client::new(port, &pw)
        .get("/lol-gameflow/v1/gameflow-phase")
        .and_then(|v| v.as_str().map(str::to_owned))
        .map(Some)
        .ok_or(())
}

fn find_client() -> Option<(u16, String)> {
    // Debug builds: a test client named by DEEPARAM_LCU ("port:password").
    #[cfg(debug_assertions)]
    if let Some((port, pw)) = std::env::var("DEEPARAM_LCU").ok().as_deref().and_then(|v| v.split_once(':')) {
        return Some((port.parse().ok()?, pw.to_owned()));
    }
    for p in LOCKFILES {
        if let Some(found) = fs::read_to_string(p).ok().as_deref().and_then(parse_lockfile) {
            return Some(found);
        }
    }
    // Asking PowerShell costs about a second of processor time, so only when the client is actually running.
    if !procs::running("LeagueClientUx.exe") {
        return None;
    }
    from_process()
}

/// League installed somewhere else: the running client's command line names the port and password.
#[cfg(windows)]
fn from_process() -> Option<(u16, String)> {
    use std::os::windows::process::CommandExt;
    const NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | ForEach-Object { $_.CommandLine }",
        ])
        .creation_flags(NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let arg =
        |name: &str| text.split_whitespace().find_map(|a| a.trim_matches('"').strip_prefix(name).map(str::to_owned));
    Some((arg("--app-port=")?.parse().ok()?, arg("--remoting-auth-token=")?))
}

#[cfg(not(windows))]
fn from_process() -> Option<(u16, String)> {
    None
}

struct Client {
    agent: ureq::Agent,
    base: String,
    auth: String,
}

impl Client {
    fn new(port: u16, password: &str) -> Self {
        Client { agent: local_agent(), base: format!("https://127.0.0.1:{port}"), auth: basic_auth(password) }
    }

    fn get(&self, path: &str) -> Option<Value> {
        self.agent
            .get(format!("{}{}", self.base, path))
            .header("Authorization", &self.auth)
            .call()
            .ok()?
            .body_mut()
            .read_json()
            .ok()
    }
}

fn basic_auth(password: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let raw = format!("riot:{password}").into_bytes();
    let mut out = String::new();
    for c in raw.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        for i in 0..4 {
            out.push(if i <= c.len() { T[((n >> (18 - 6 * i)) & 63) as usize] as char } else { '=' });
        }
    }
    format!("Basic {out}")
}

/// Asks the site whether this Riot account is connected to the owner's account.
fn is_owner(client: &Client) -> Option<bool> {
    // Debug builds: DEEPARAM_OWNER=1 stands in for the site's answer, for test runs against a fake client.
    #[cfg(debug_assertions)]
    if std::env::var_os("DEEPARAM_OWNER").is_some() {
        return Some(true);
    }
    let region = client.get("/riotclient/region-locale")?.get("region")?.as_str()?.to_uppercase();
    let platform = PLATFORMS.iter().find(|(r, _)| *r == region).map(|(_, p)| *p)?;
    let token = client.get("/lol-rso-auth/v1/authorization/access-token").and_then(|t| match t {
        Value::String(s) => Some(s),
        v => v.get("token")?.as_str().map(str::to_owned),
    })?;
    let reply: Value = ureq::post(format!("{SITE}/api/history"))
        .send_json(json!({ "action": "status", "token": token, "platform": platform }))
        .ok()?
        .body_mut()
        .read_json()
        .ok()?;
    Some(reply.get("available").and_then(Value::as_bool).unwrap_or(false))
}

fn send(app: &AppHandle, script: String) {
    app.state::<Shared>().lock().unwrap().script = Some(script.clone());
    crate::phone::full(&script);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(&script);
        return;
    }
    let loaded = app.clone();
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("companion.html".into()))
        .title("DeepARAM")
        .inner_size(420.0, 680.0)
        .min_inner_size(320.0, 420.0)
        .focused(false);
    // Drawn on the processor unless the player turns the graphics card on: a few lines of text don't need it, and
    // the game keeps the whole card. WebView2 only takes other options in a profile of its own, so this window gets
    // its own folder (its saved choices, like Feeling lucky, live there).
    #[cfg(windows)]
    let builder = match app.path().app_local_data_dir() {
        Ok(dir) if !app.state::<Store>().saved.lock().unwrap().companion_gpu => builder
            .data_directory(dir.join("companion-cpu"))
            .additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu --disable-gpu-compositing",
            ),
        _ => builder,
    };
    let built = builder
        .on_page_load(move |win, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(script) = loaded.state::<Shared>().lock().unwrap().script.clone() {
                    let _ = win.eval(&script);
                }
            }
        })
        .build();
    if let Ok(win) = built {
        // One DeepARAM window at a time: the companion takes over from the main window, which stays in the tray.
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
        // Straight to the second monitor, from champion select on, so it's never in front of League.
        if second_screen_on(app) {
            to_second_screen(app);
        }
        let app = app.clone();
        win.on_window_event(move |e| {
            if let tauri::WindowEvent::CloseRequested { .. } = e {
                app.state::<Shared>().lock().unwrap().dismissed = true;
            }
        });
    }
}

/// The player changed which key Flash goes on: spell pairs redraw with Flash there.
pub fn flash_key(app: &AppHandle, key: &str) {
    let js = format!("window.setFlashKey && window.setFlashKey({})", json!(key));
    crate::phone::push(&js);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(js);
    }
}

/// The augments on offer changed (read off the screen by the in-game watcher): shown right away.
pub fn show_offer(app: &AppHandle, offer: &[i64]) {
    let js = format!("window.showOffer && window.showOffer({})", json!(offer));
    crate::phone::push(&js);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(js);
    }
}

/// The augment the player picked, learned from the card they clicked: the companion marks it taken by itself.
pub fn auto_taken(app: &AppHandle, id: i64) {
    let js = format!("window.autoTaken && window.autoTaken({id})");
    crate::phone::push(&js);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(js);
    }
}

/// Which monitor the window goes full screen on: one that doesn't hold the game (or, without a game window to
/// go by, isn't the main monitor, where League runs). None with a single monitor. Monitors are (x, y, w, h).
pub fn other_monitor(monitors: &[(i32, i32, u32, u32)], game: Option<(i32, i32)>, primary: usize) -> Option<usize> {
    if monitors.len() < 2 {
        return None;
    }
    let holds = |m: &(i32, i32, u32, u32), (x, y): (i32, i32)| {
        x >= m.0
            && y >= m.1
            && i64::from(x) < i64::from(m.0) + i64::from(m.2)
            && i64::from(y) < i64::from(m.1) + i64::from(m.3)
    };
    let game_at = game.and_then(|g| monitors.iter().position(|m| holds(m, g))).unwrap_or(primary);
    (0..monitors.len()).find(|i| *i != game_at)
}

fn second_screen_on(app: &AppHandle) -> bool {
    !app.state::<Store>().saved.lock().unwrap().second_screen_off
}

/// Once per game: full screen on a monitor League isn't on.
fn to_second_screen(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let Ok(monitors) = win.available_monitors() else { return };
    let rects: Vec<(i32, i32, u32, u32)> =
        monitors.iter().map(|m| (m.position().x, m.position().y, m.size().width, m.size().height)).collect();
    let primary = win
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|p| rects.iter().position(|r| (r.0, r.1) == (p.position().x, p.position().y)))
        .unwrap_or(0);
    let game = augscan::game_window().map(|(x, y, w, h)| (x + w / 2, y + h / 2));
    let Some(i) = other_monitor(&rects, game, primary) else { return };
    let _ = win.set_fullscreen(false);
    let _ = win.set_position(PhysicalPosition::new(rects[i].0 + 40, rects[i].1 + 40));
    let _ = win.set_fullscreen(true);
    let _ = win.eval("window.setFull && window.setFull(true)");
}

/// The window's full-screen button, Esc and F11: `on` sets it, None flips it. Answers whether it's full screen now.
#[tauri::command]
pub fn companion_fullscreen(app: AppHandle, on: Option<bool>) -> bool {
    let Some(win) = app.get_webview_window(LABEL) else { return false };
    let now = win.is_fullscreen().unwrap_or(false);
    let want = on.unwrap_or(!now);
    if want != now {
        let _ = win.set_fullscreen(want);
    }
    want
}

pub fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.destroy();
    }
}

/// The game's review, from overlay.rs once a game ends. Opens even if the player closed the window during
/// champion select, since it's a new thing to see.
pub fn show_review(app: &AppHandle, mut review: Value) {
    if !enabled(app) {
        return;
    }
    let known = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.dismissed = false;
        s.result.clone()
    };
    // The game's feed often closes before it reports the result; the client's end-of-game screen has it.
    if review.get("result").is_none_or(Value::is_null) {
        if let Some(r) = known {
            review["result"] = json!(r);
        }
    }
    send(app, format!("window.showReview({review})"));
}

/// One moment of a game for the model, ally minus enemy (players and events as the Live Client Data API gives them).
pub fn sample_from(t: f64, team: &str, players: &[Value], events: &[Value], fit: &HashMap<String, f64>) -> Sample {
    let sign = |p: &Value| if p.get("team").and_then(Value::as_str) == Some(team) { 1.0 } else { -1.0 };
    let num = |v: Option<&Value>| v.and_then(Value::as_f64).unwrap_or(0.0);
    let mut s = Sample { t, kills: 0.0, towers: 0.0, levels: 0.0, comp: 0.0 };
    for p in players {
        let k = sign(p);
        s.kills += k * num(p.get("scores").and_then(|x| x.get("kills")));
        s.levels += k * num(p.get("level"));
        let alias = p.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
        s.comp += k * (fit.get(alias).copied().unwrap_or(0.5) - 0.5);
    }
    for e in events {
        let structure = match e.get("EventName").and_then(Value::as_str) {
            Some("TurretKilled") => e.get("TurretKilled"),
            Some("InhibKilled") => e.get("InhibKilled"),
            _ => None,
        };
        if let Some(owner) = structure.and_then(Value::as_str).and_then(review::structure_owner) {
            s.towers += if owner == team { -1.0 } else { 1.0 };
        }
    }
    s
}

/// Champion ids from /lol-champions/v1/owned-champions-minimal that the player can take: owned or free to play.
fn playable_ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter(|c| {
                    c.get("ownership").and_then(|o| o.get("owned")).and_then(Value::as_bool) == Some(true)
                        || c.get("freeToPlay").and_then(Value::as_bool) == Some(true)
                })
                .filter_map(|c| c.get("id")?.as_i64())
                .filter(|id| *id > 0)
                .collect()
        })
        .unwrap_or_default()
}

fn champ_select(app: &AppHandle, client: &Client) {
    let Some(session) = client.get("/lol-champ-select/v1/session") else { return };
    let me = session.get("localPlayerCellId").and_then(Value::as_i64);
    let ids = |v: Option<&Value>| -> Vec<i64> {
        v.and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.get("championId")?.as_i64()).filter(|id| *id > 0).collect())
            .unwrap_or_default()
    };
    let team = session.get("myTeam").and_then(Value::as_array).cloned().unwrap_or_default();
    let mine = team
        .iter()
        .find(|p| p.get("cellId").and_then(Value::as_i64) == me)
        .and_then(|p| p.get("championId")?.as_i64())
        .filter(|id| *id > 0);
    let allies: Vec<i64> = team
        .iter()
        .filter(|p| p.get("cellId").and_then(Value::as_i64) != me)
        .filter_map(|p| p.get("championId")?.as_i64())
        .filter(|id| *id > 0)
        .collect();
    let bench = ids(session.get("benchChampions"));
    let rerolls = client
        .get("/lol-summoner/v1/current-summoner/rerollPoints")
        .and_then(|r| r.get("numberOfRolls")?.as_i64())
        .unwrap_or(0);
    let state = app.state::<Shared>();
    let cached = state.lock().unwrap().playable.clone();
    let playable = match cached {
        Some(p) => p,
        None => {
            let p =
                client.get("/lol-champions/v1/owned-champions-minimal").map(|v| playable_ids(&v)).unwrap_or_default();
            if !p.is_empty() {
                state.lock().unwrap().playable = Some(p.clone());
            }
            p
        }
    };
    let script = format!(
        "window.showPick({})",
        json!({ "allies": allies, "mine": mine, "bench": bench, "rerolls": rerolls, "playable": playable })
    );
    let unchanged = state.lock().unwrap().script.as_deref() == Some(script.as_str());
    if !unchanged {
        send(app, script);
    }
}

/// During a game, for everyone: the player's champion, level, items and whether they're dead, plus the enemy
/// champions and their items (all on the scoreboard), for the augment panel and the next item (build suggestions, which Riot allows). For the owner only, also the live chance to win.
fn live_game(app: &AppHandle, agent: &ureq::Agent, fit: &HashMap<String, f64>, owner: bool) {
    // All of the game's data is a big answer for the game to put together, so it's asked for every LIVE_EVERY
    // seconds only (before, it was fetched every POLL and most answers were thrown away).
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if s.last_live.is_some_and(|at| at.elapsed() < LIVE_EVERY) {
            return;
        }
        s.last_live = Some(Instant::now());
    }
    let Some(data) = agent.get(LIVE).call().ok().and_then(|mut r| r.body_mut().read_json::<Value>().ok()) else {
        return;
    };
    let t = data.get("gameData").and_then(|g| g.get("gameTime")?.as_f64()).unwrap_or(0.0);
    let me = data.get("activePlayer").and_then(|p| p.get("riotId")?.as_str().map(str::to_owned)).unwrap_or_default();
    let players = data.get("allPlayers").and_then(Value::as_array).cloned().unwrap_or_default();
    let Some(row) = my_row(&me, &players) else {
        return;
    };
    let team = row.get("team").and_then(Value::as_str).unwrap_or_default().to_owned();
    let champ = row.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
    // In inventory slot order: Weapon of Destiny, King Me and Ornn's Masterwork upgrade the first Legendary in slots 1-6.
    let items_of = |p: &Value| -> Vec<i64> {
        let mut rows: Vec<(i64, i64)> = p
            .get("items")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|i| {
                        Some((i.get("slot").and_then(Value::as_i64).unwrap_or(99), i.get("itemID")?.as_i64()?))
                    })
                    .collect()
            })
            .unwrap_or_default();
        rows.sort_by_key(|r| r.0);
        rows.into_iter().map(|r| r.1).collect()
    };
    let items = items_of(row);
    // The enemy champions and the items they've bought, as the scoreboard shows them (no names), for the item tip.
    let enemies: Vec<Value> = players
        .iter()
        .filter(|p| p.get("team").and_then(Value::as_str).is_some_and(|x| x != team))
        .map(|p| {
            let champ = p.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
            json!({ "champ": champ, "items": items_of(p), "level": p.get("level").and_then(Value::as_u64).unwrap_or(0) })
        })
        .collect();
    // Teammates' champions and levels, for Ornn's Masterwork upgrades (the slot-1 cue).
    let allies: Vec<Value> = players
        .iter()
        .filter(|p| {
            p.get("team").and_then(Value::as_str).is_some_and(|x| x == team)
                && !std::ptr::eq(*p as *const Value, row as *const Value)
        })
        .map(|p| {
            let champ = p.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
            json!({ "champ": champ, "level": p.get("level").and_then(Value::as_u64).unwrap_or(0) })
        })
        .collect();
    let skills: Vec<u64> = ["Q", "W", "E", "R"]
        .iter()
        .map(|k| {
            data.get("activePlayer")
                .and_then(|p| p.get("abilities")?.get(*k)?.get("abilityLevel")?.as_u64())
                .unwrap_or(0)
        })
        .collect();
    let stats: Vec<f64> = ["critChance", "attackSpeed", "abilityHaste"]
        .iter()
        .map(|k| data.get("activePlayer").and_then(|p| p.get("championStats")?.get(*k)?.as_f64()).unwrap_or(0.0))
        .collect();
    let mut game = json!({
        "t": t,
        "champ": champ,
        "level": row.get("level").and_then(Value::as_u64).unwrap_or(0),
        "dead": row.get("isDead").and_then(Value::as_bool).unwrap_or(false),
        "items": items,
        "enemies": enemies,
        "allies": allies,
        "gold": data.get("activePlayer").and_then(|p| p.get("currentGold")?.as_f64()).unwrap_or(0.0),
        // For the stat-cap guard: crit chance, attack speed and ability haste as the game reports them.
        "stats": stats,
        // Points in Q, W, E and R, for the skill-up note.
        "skills": skills,
        // The augments on offer right now, read off the screen (empty when no pick is on).
        "offer": app.state::<ingame::Shared>().lock().unwrap().offer.clone(),
        "live": null,
    });
    if owner {
        let events = data.get("events").and_then(|e| e.get("Events")?.as_array().cloned()).unwrap_or_default();
        let p = review::chance(&sample_from(t, &team, &players, &events, fit));
        let line = review::ff_line(t / 60.0);
        let hint = {
            let state = app.state::<Shared>();
            let mut s = state.lock().unwrap();
            match line {
                Some(l) if p < l => {
                    let since = *s.under_since.get_or_insert(t);
                    t - since >= review::FF_HOLD
                }
                _ => {
                    s.under_since = None;
                    false
                }
            }
        };
        // Secondary to the build on screen (Nico 2026-11-22); the chart over the game stays in the review.
        game["live"] = json!({ "win": p, "surrender": hint });
    }
    send(app, format!("window.showGame({game})"));
    let place = {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        !std::mem::replace(&mut s.placed, true)
    };
    if place && second_screen_on(app) {
        to_second_screen(app);
    }
}

fn strengths() -> HashMap<String, f64> {
    ureq::get(format!("{SITE}/data/team-fit.json"))
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_json::<Value>().ok())
        .and_then(|f| {
            f.get("champions")?
                .as_object()
                .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.get(0)?.as_f64()?))).collect())
        })
        .unwrap_or_default()
}

/// Watches the League client's game phase and opens or fills the window.
pub fn watch(app: AppHandle) {
    thread::spawn(move || {
        let game_agent = local_agent();
        let mut client: Option<Client> = None;
        let mut fit: (Option<Instant>, HashMap<String, f64>) = (None, HashMap::new());
        loop {
            if !enabled(&app) {
                thread::sleep(IDLE);
                continue;
            }
            if client.is_none() {
                client = find_client().map(|(port, pw)| Client::new(port, &pw));
            }
            let Some(c) = client.as_ref() else {
                thread::sleep(IDLE);
                continue;
            };
            let Some(phase) = c.get("/lol-gameflow/v1/gameflow-phase").and_then(|v| v.as_str().map(str::to_owned))
            else {
                client = None; // the client closed or restarted with a new port
                thread::sleep(IDLE);
                continue;
            };
            let mode = c
                .get("/lol-gameflow/v1/session")
                .and_then(|s| s.get("gameData")?.get("queue")?.get("gameMode")?.as_str().map(str::to_owned));
            let mayhem = mode.as_deref() == Some(MAYHEM_MODE);
            {
                let state = app.state::<Shared>();
                let mut s = state.lock().unwrap();
                if s.phase != phase {
                    // The game ended but no review is coming yet (it needs the overlay, and games of 5 minutes or
                    // more): don't leave the in-game panel up as if the game were still on.
                    let ended = s.phase == "InProgress"
                        && s.script.as_deref().is_some_and(|x| x.starts_with("window.showGame"));
                    s.phase = phase.clone();
                    if ended {
                        drop(s);
                        if app.get_webview_window(LABEL).is_some() {
                            send(&app, "window.showOver()".into());
                        }
                        s = state.lock().unwrap();
                    }
                    if phase == "ChampSelect" {
                        s.dismissed = false;
                        s.under_since = None;
                        s.playable = None;
                    }
                    if phase == "InProgress" {
                        s.last_live = None;
                        s.placed = false;
                        s.result = None;
                    }
                    if phase == "EndOfGame" && mayhem {
                        drop(s);
                        let block = c.get("/lol-end-of-game/v1/eog-stats-block");
                        let result = block.as_ref().and_then(eog_result);
                        // Picks the live reading missed: the end-of-game list has them all (marking is idempotent).
                        let picks = block.as_ref().map(eog_augments).unwrap_or_default();
                        if !picks.is_empty() {
                            let js = format!("window.eogPicks && window.eogPicks({})", json!(picks));
                            crate::phone::push(&js);
                            if let Some(win) = app.get_webview_window(LABEL) {
                                let _ = win.eval(js);
                            }
                        }
                        s = state.lock().unwrap();
                        if let Some(r) = result {
                            s.result = Some(r.to_owned());
                            drop(s);
                            let js = format!("window.setResult && window.setResult({})", json!(r));
                            crate::phone::push(&js);
                            if let Some(win) = app.get_webview_window(LABEL) {
                                let _ = win.eval(js);
                            }
                            s = state.lock().unwrap();
                        }
                    }
                }
            }
            let dismissed = app.state::<Shared>().lock().unwrap().dismissed;
            match phase.as_str() {
                "ChampSelect" if mayhem && !dismissed => champ_select(&app, c),
                "InProgress" if mayhem => {
                    let owner = {
                        let (known, tried) = {
                            let s = app.state::<Shared>();
                            let s = s.lock().unwrap();
                            (s.owner, s.owner_tried)
                        };
                        match known {
                            Some(o) => o,
                            // No answer last time (signed out, offline): ask again every few minutes, not every poll.
                            None if tried.is_some_and(|at| at.elapsed() < OWNER_RETRY) => false,
                            None => {
                                let o = is_owner(c);
                                let s = app.state::<Shared>();
                                let mut s = s.lock().unwrap();
                                s.owner = o;
                                s.owner_tried = Some(Instant::now());
                                o.unwrap_or(false)
                            }
                        }
                    };
                    if !dismissed {
                        if owner && fit.0.is_none_or(|at| at.elapsed() > Duration::from_secs(3600)) {
                            fit = (Some(Instant::now()), strengths());
                        }
                        live_game(&app, &game_agent, &fit.1, owner);
                    }
                }
                _ => {}
            }
            thread::sleep(POLL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_lockfile() {
        assert_eq!(parse_lockfile("LeagueClient:1234:50123:abc-DEF_1:https"), Some((50123, "abc-DEF_1".into())));
        assert_eq!(parse_lockfile("garbage"), None);
    }

    #[test]
    fn basic_auth_matches_base64() {
        // base64("riot:pass") = "cmlvdDpwYXNz"
        assert_eq!(basic_auth("pass"), "Basic cmlvdDpwYXNz");
        // base64("riot:ab") = "cmlvdDphYg=="
        assert_eq!(basic_auth("ab"), "Basic cmlvdDphYg==");
    }

    #[test]
    fn sample_counts_for_my_team() {
        let players = vec![
            json!({"team": "ORDER", "level": 10, "scores": {"kills": 5}, "rawChampionName": "game_character_displayname_Lux"}),
            json!({"team": "CHAOS", "level": 8, "scores": {"kills": 2}, "rawChampionName": "game_character_displayname_Jinx"}),
        ];
        let events = vec![json!({"EventName": "TurretKilled", "TurretKilled": "Turret_T2_L_03_A"})];
        let fit = HashMap::from([("Lux".to_owned(), 0.53)]);
        let s = sample_from(600.0, "ORDER", &players, &events, &fit);
        assert_eq!((s.kills, s.levels, s.towers), (3.0, 2.0, 1.0));
        assert!((s.comp - 0.03).abs() < 1e-9);
    }

    #[test]
    fn reads_the_result_from_the_end_of_game_screen() {
        let won = json!({"teams": [{"isPlayerTeam": false, "isWinningTeam": false}, {"isPlayerTeam": true, "isWinningTeam": true}]});
        assert_eq!(eog_result(&won), Some("Win"));
        let lost = json!({"teams": [{"isPlayerTeam": true, "isWinningTeam": false}]});
        assert_eq!(eog_result(&lost), Some("Lose"));
        assert_eq!(eog_result(&json!({"teams": [], "localPlayer": {"stats": {"WIN": 1}}})), Some("Win"));
        assert_eq!(eog_result(&json!({})), None);
        let block = json!({"localPlayer": {"summonerId": 7, "stats": {"PLAYER_AUGMENT_1": 2140, "PLAYER_AUGMENT_2": 3129, "PLAYER_AUGMENT_3": 0}}});
        assert_eq!(eog_augments(&block), vec![2140, 3129]);
        let in_team = json!({"localPlayer": {"summonerId": 7, "stats": {}}, "teams": [{"players": [{"summonerId": 7, "stats": {"PLAYER_AUGMENT_1": "1048"}}]}]});
        assert_eq!(eog_augments(&in_team), vec![1048]);
        assert!(eog_augments(&json!({})).is_empty());
    }

    #[test]
    fn full_screen_goes_to_a_monitor_without_the_game() {
        let two = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert_eq!(other_monitor(&two, Some((960, 540)), 0), Some(1));
        // The game on the second monitor: the window takes the main one.
        assert_eq!(other_monitor(&two, Some((3000, 700)), 0), Some(0));
        // No game window found yet: League runs on the main monitor.
        assert_eq!(other_monitor(&two, None, 1), Some(0));
        // One monitor: no full screen over the game.
        assert_eq!(other_monitor(&two[..1], Some((960, 540)), 0), None);
        // A monitor to the left (negative coordinates).
        assert_eq!(other_monitor(&[(-1920, 0, 1920, 1080), (0, 0, 1920, 1080)], Some((960, 540)), 1), Some(0));
    }

    #[test]
    fn playable_is_owned_or_free() {
        let v = json!([
            {"id": 1, "ownership": {"owned": true}, "freeToPlay": false},
            {"id": 2, "ownership": {"owned": false}, "freeToPlay": true},
            {"id": 3, "ownership": {"owned": false}, "freeToPlay": false},
            {"id": -1, "ownership": {"owned": true}}
        ]);
        assert_eq!(playable_ids(&v), vec![1, 2]);
    }

    #[test]
    fn companion_page_has_the_entry_points() {
        let page = include_str!("../../ui/companion.html");
        for f in [
            "window.showPick",
            "window.showGame",
            "window.showOffer",
            "window.showOver",
            "window.showReview",
            "Predicted",
        ] {
            assert!(page.contains(f), "{f}");
        }
    }
}
