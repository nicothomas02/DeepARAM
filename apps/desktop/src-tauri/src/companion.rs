// The companion window: a normal window (put it on a second screen) that opens by itself when a Mayhem champion
// select starts and closes after the game's review.
//
//   champion select   best picks for your team from your bench and your own champion (public data: each
//                     champion's strength plus how it pairs with your allies, /data/team-fit.json). It only
//                     suggests; it never picks, and it shows no player names.
//   in game           everyone: the augment panel (your champion's augments in ranking order, re-ranked by synergy
//                     with the ones you mark as taken, plus a search) and the next item for your build. Build
//                     suggestions are allowed; augment win rates are not, so the panel shows a ranking only.
//                     The site owner only: also the live chance to win and when a surrender pays off. Riot's rules
//                     don't let apps draw conclusions for players during a game, so nobody else gets that. Owner = this Riot account is connected to the site
//                     owner's account (the site's /api/history "available" answer, as the My Stats helper asks).
//   after the game    everyone: the predicted chance over the game, its turning points and from when a surrender
//                     would have paid off (overlay.rs samples the game, review.rs works it out).
//
// Light on purpose: one request to the League client every POLL seconds while it's open, one to the game every
// LIVE_EVERY seconds for the owner's live view, none while League is closed (a lockfile check every IDLE seconds).
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
use tauri::{webview::PageLoadEvent, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    overlay::{champion_alias, local_agent, MAYHEM_MODE},
    review::{self, Sample},
    Store, SITE,
};

const LABEL: &str = "companion";
const POLL: Duration = Duration::from_secs(3);
const IDLE: Duration = Duration::from_secs(15);
const LIVE_EVERY: f64 = 5.0;
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
    history: Vec<(f64, f64)>,
    last_live: f64,
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

fn find_client() -> Option<(u16, String)> {
    for p in LOCKFILES {
        if let Some(found) = fs::read_to_string(p).ok().as_deref().and_then(parse_lockfile) {
            return Some(found);
        }
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
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.eval(&script);
        return;
    }
    let loaded = app.clone();
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("companion.html".into()))
        .title("DeepARAM")
        .inner_size(400.0, 600.0)
        .min_inner_size(320.0, 420.0)
        .focused(false)
        .on_page_load(move |win, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(script) = loaded.state::<Shared>().lock().unwrap().script.clone() {
                    let _ = win.eval(&script);
                }
            }
        })
        .build();
    if let Ok(win) = built {
        let app = app.clone();
        win.on_window_event(move |e| {
            if let tauri::WindowEvent::CloseRequested { .. } = e {
                app.state::<Shared>().lock().unwrap().dismissed = true;
            }
        });
    }
}

pub fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.destroy();
    }
}

/// The game's review, from overlay.rs once a game ends. Opens even if the player closed the window during
/// champion select, since it's a new thing to see.
pub fn show_review(app: &AppHandle, review: Value) {
    if !enabled(app) {
        return;
    }
    app.state::<Shared>().lock().unwrap().dismissed = false;
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
    let script = format!("window.showPick({})", json!({ "allies": allies, "mine": mine, "bench": bench }));
    let state = app.state::<Shared>();
    let unchanged = state.lock().unwrap().script.as_deref() == Some(script.as_str());
    if !unchanged {
        send(app, script);
    }
}

/// During a game, for everyone: the player's champion, level, items and whether they're dead, plus the enemy
/// champions and their items (all on the scoreboard), for the augment panel and the next item (build suggestions, which Riot allows). For the owner only, also the live chance to win.
fn live_game(app: &AppHandle, agent: &ureq::Agent, fit: &HashMap<String, f64>, owner: bool) {
    let Some(data) = agent.get(LIVE).call().ok().and_then(|mut r| r.body_mut().read_json::<Value>().ok()) else {
        return;
    };
    let t = data.get("gameData").and_then(|g| g.get("gameTime")?.as_f64()).unwrap_or(0.0);
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if t - s.last_live < LIVE_EVERY && t >= s.last_live {
            return;
        }
        s.last_live = t;
    }
    let me = data.get("activePlayer").and_then(|p| p.get("riotId")?.as_str().map(str::to_owned)).unwrap_or_default();
    let players = data.get("allPlayers").and_then(Value::as_array).cloned().unwrap_or_default();
    let Some(row) = players.iter().find(|p| p.get("riotId").and_then(Value::as_str) == Some(me.as_str())) else {
        return;
    };
    let team = row.get("team").and_then(Value::as_str).unwrap_or_default().to_owned();
    let champ = row.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
    let items_of = |p: &Value| -> Vec<i64> {
        p.get("items")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|i| i.get("itemID")?.as_i64()).collect())
            .unwrap_or_default()
    };
    let items = items_of(row);
    // The enemy champions and the items they've bought, as the scoreboard shows them (no names), for the item tip.
    let enemies: Vec<Value> = players
        .iter()
        .filter(|p| p.get("team").and_then(Value::as_str).is_some_and(|x| x != team))
        .map(|p| {
            let champ = p.get("rawChampionName").and_then(Value::as_str).and_then(champion_alias).unwrap_or_default();
            json!({ "champ": champ, "items": items_of(p) })
        })
        .collect();
    let mut game = json!({
        "t": t,
        "champ": champ,
        "level": row.get("level").and_then(Value::as_u64).unwrap_or(0),
        "dead": row.get("isDead").and_then(Value::as_bool).unwrap_or(false),
        "items": items,
        "enemies": enemies,
        "live": null,
    });
    if owner {
        let events = data.get("events").and_then(|e| e.get("Events")?.as_array().cloned()).unwrap_or_default();
        let p = review::chance(&sample_from(t, &team, &players, &events, fit));
        let line = review::ff_line(t / 60.0);
        let (hint, history) = {
            let state = app.state::<Shared>();
            let mut s = state.lock().unwrap();
            if s.history.last().is_none_or(|(lt, _)| t - lt >= 15.0) {
                s.history.push((t, p));
            }
            match line {
                Some(l) if p < l => {
                    let since = *s.under_since.get_or_insert(t);
                    (t - since >= review::FF_HOLD, s.history.clone())
                }
                _ => {
                    s.under_since = None;
                    (false, s.history.clone())
                }
            }
        };
        let history: Vec<Value> = history.iter().map(|(a, b)| json!([a, b])).collect();
        game["live"] = json!({ "win": p, "ffLine": line, "ffHint": hint, "history": history });
    }
    send(app, format!("window.showGame({game})"));
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
                    s.phase = phase.clone();
                    if phase == "ChampSelect" {
                        s.dismissed = false;
                        s.history.clear();
                        s.under_since = None;
                        s.last_live = 0.0;
                    }
                }
            }
            let dismissed = app.state::<Shared>().lock().unwrap().dismissed;
            match phase.as_str() {
                "ChampSelect" if mayhem && !dismissed => champ_select(&app, c),
                "InProgress" if mayhem => {
                    let owner = {
                        let known = app.state::<Shared>().lock().unwrap().owner;
                        match known {
                            Some(o) => o,
                            None => {
                                let o = is_owner(c);
                                app.state::<Shared>().lock().unwrap().owner = o;
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
    fn companion_page_has_the_entry_points() {
        let page = include_str!("../../ui/companion.html");
        for f in ["window.showPick", "window.showGame", "window.showReview", "Predicted"] {
            assert!(page.contains(f), "{f}");
        }
    }
}
