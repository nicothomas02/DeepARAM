// Match sharing: off until the player says yes. On first launch DeepARAM asks once (ui/share.html); the tray's
// "Share match data" item changes it at any time. When it's on, the app reads finished ARAM Mayhem games from the
// League client on this computer and sends them to the site with no names, Riot IDs or account ids: champions,
// items, augments, runes, spells, scores and the result. Turning it off asks the site to remove what was sent.
//
// The site checks the client's sign-in token once per send so nobody can post made-up games, and keeps only a
// salted hash of the account (web/src/lib/shared-games.ts), which is what lets "off" remove the games again.

use std::{
    collections::BTreeSet,
    fs,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{menu::CheckMenuItem, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

const GAMES_URL: &str = "https://deeparam.com/api/games";
/// ARAM Mayhem queues. 2450 also serves Mayhem games but isn't on Riot's public queue list.
const MAYHEM_QUEUES: [u64; 2] = [2400, 2450];
const CHECK_EVERY: Duration = Duration::from_secs(90);
/// How many recent games to look through, and how many sent game ids to remember.
const RECENT: usize = 20;
const KEEP_SENT: usize = 400;
const ASK_AFTER: Duration = Duration::from_secs(4);

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    /// The first-launch question was answered (either way).
    asked: bool,
    enabled: bool,
    /// Game ids already sent, newest last.
    sent: Vec<u64>,
}

pub struct Sharing {
    file: PathBuf,
    state: Mutex<State>,
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl Sharing {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("sharing.json");
        let state = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Sharing { file, state: Mutex::new(state), item: Mutex::new(None) }
    }

    fn update<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut state = self.state.lock().unwrap();
        let out = f(&mut state);
        if let Ok(json) = serde_json::to_vec_pretty(&*state) {
            let _ = fs::write(&self.file, json);
        }
        out
    }

    fn enabled(&self) -> bool {
        self.state.lock().unwrap().enabled
    }
}

/// The tray item. Its tick follows the saved choice, also when the first-launch window changes it.
pub fn menu_item(app: &AppHandle) -> tauri::Result<CheckMenuItem<Wry>> {
    let sharing = app.state::<Sharing>();
    let item =
        CheckMenuItem::with_id(app, "share", "Share match data (anonymous)", true, sharing.enabled(), None::<&str>)?;
    *sharing.item.lock().unwrap() = Some(item.clone());
    Ok(item)
}

/// The tray item was clicked: it has already flipped its tick, so follow it.
pub fn on_menu(app: &AppHandle) {
    let on = app.state::<Sharing>().item.lock().unwrap().as_ref().and_then(|i| i.is_checked().ok()).unwrap_or(false);
    set(app, on);
}

/// Saves the player's choice. Turning sharing off removes the games already sent.
pub fn set(app: &AppHandle, on: bool) {
    let sharing = app.state::<Sharing>();
    let was = sharing.update(|s| {
        s.asked = true;
        std::mem::replace(&mut s.enabled, on)
    });
    if let Some(item) = sharing.item.lock().unwrap().as_ref() {
        let _ = item.set_checked(on);
    }
    if was && !on {
        let app = app.clone();
        thread::spawn(move || {
            if remove_all().is_ok() {
                app.state::<Sharing>().update(|s| s.sent.clear());
            }
        });
    }
}

/// Called from ui/share.html with the player's answer.
#[tauri::command]
pub fn share_choice(app: AppHandle, enabled: bool) {
    set(&app, enabled);
    if let Some(win) = app.get_webview_window("share") {
        let _ = win.close();
    }
}

/// Asks once, a moment after the first launch, whether the player wants to share.
pub fn ask_once(app: &AppHandle) {
    if app.state::<Sharing>().state.lock().unwrap().asked {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(ASK_AFTER);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || open_question(&handle));
    });
}

fn open_question(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("share") {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "share", WebviewUrl::App("share.html".into()))
        .title("Help improve DeepARAM")
        .inner_size(460.0, 560.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .focused(true)
        .background_color(tauri::window::Color(9, 11, 15, 255))
        .build();
}

/// Checks for newly finished Mayhem games every so often while sharing is on.
pub fn watch(app: AppHandle) {
    thread::spawn(move || {
        let mut pending: Vec<(u64, u8)> = Vec::new();
        let mut last = Instant::now() - CHECK_EVERY;
        loop {
            thread::sleep(Duration::from_secs(15));
            let sharing = app.state::<Sharing>();
            if !sharing.enabled() {
                pending.clear();
                continue;
            }
            let Some(lcu) = Lcu::find() else { continue };
            // During a game, only note its id; reading and sending waits until it's over.
            let session = lcu.get("/lol-gameflow/v1/session").unwrap_or(Value::Null);
            let phase = session["phase"].as_str().unwrap_or("");
            if matches!(phase, "GameStart" | "InProgress" | "Reconnect") {
                let id = session["gameData"]["gameId"].as_u64().unwrap_or(0);
                let queue = session["gameData"]["queue"]["id"].as_u64().unwrap_or(0);
                if id > 0 && MAYHEM_QUEUES.contains(&queue) && !pending.iter().any(|(p, _)| *p == id) {
                    pending.push((id, 0));
                }
                continue;
            }
            if last.elapsed() < CHECK_EVERY && pending.is_empty() {
                continue;
            }
            last = Instant::now();
            let sent: BTreeSet<u64> = sharing.state.lock().unwrap().sent.iter().copied().collect();
            let mut ids: Vec<u64> = pending.iter().map(|(id, _)| *id).collect();
            ids.extend(recent_mayhem(&lcu));
            ids.retain(|id| !sent.contains(id));
            ids.sort_unstable();
            ids.dedup();
            let mut games = Vec::new();
            let mut done = Vec::new();
            for id in ids {
                // Stats can take a minute to appear after a game; a missing one is tried again next time.
                if let Ok(game) = lcu.get(&format!("/lol-match-history/v1/games/{id}")) {
                    done.push(id);
                    if let Some(clean) = anonymise(&game) {
                        games.push(clean);
                    }
                }
            }
            if !games.is_empty() && send(&lcu, json!({ "action": "share", "games": games })).is_err() {
                continue;
            }
            for (_, tries) in pending.iter_mut() {
                *tries += 1;
            }
            pending.retain(|(id, tries)| !done.contains(id) && *tries < 20);
            if !done.is_empty() {
                sharing.update(|s| {
                    s.sent.extend(done);
                    let extra = s.sent.len().saturating_sub(KEEP_SENT);
                    s.sent.drain(..extra);
                });
            }
        }
    });
}

fn recent_mayhem(lcu: &Lcu) -> Vec<u64> {
    let path = format!("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex={RECENT}");
    let list = lcu.get(&path).unwrap_or(Value::Null);
    list["games"]["games"]
        .as_array()
        .map(|games| {
            games
                .iter()
                .filter(|g| g["queueId"].as_u64().is_some_and(|q| MAYHEM_QUEUES.contains(&q)))
                .filter_map(|g| g["gameId"].as_u64())
                .collect()
        })
        .unwrap_or_default()
}

fn remove_all() -> Result<(), ()> {
    let lcu = Lcu::find().ok_or(())?;
    send(&lcu, json!({ "action": "remove" })).map(|_| ())
}

/// Posts to the site with the client's sign-in token and server, which the site needs to accept the games.
fn send(lcu: &Lcu, mut body: Value) -> Result<Value, ()> {
    let region = lcu.get("/riotclient/region-locale").unwrap_or(Value::Null);
    let platform = platform_for(region["region"].as_str().unwrap_or("")).ok_or(())?;
    let token = lcu
        .get("/lol-rso-auth/v1/authorization/access-token")
        .ok()
        .and_then(|t| t["token"].as_str().map(String::from))
        .or_else(|| {
            lcu.get("/lol-league-session/v1/league-session-token").ok().and_then(|t| t.as_str().map(String::from))
        })
        .ok_or(())?;
    body["token"] = json!(token);
    body["platform"] = json!(platform);
    ureq::post(GAMES_URL).send_json(&body).map_err(|_| ())?.body_mut().read_json::<Value>().map_err(|_| ())
}

/// The game server the site uses for a client region, as the My Stats helper maps it.
fn platform_for(region: &str) -> Option<&'static str> {
    Some(match region.to_uppercase().as_str() {
        "NA" | "NA1" => "na1",
        "EUW" | "EUW1" => "euw1",
        "EUNE" | "EUN" | "EUN1" => "eun1",
        "BR" | "BR1" => "br1",
        "LAN" | "LA1" => "la1",
        "LAS" | "LA2" => "la2",
        "TR" | "TR1" => "tr1",
        "RU" => "ru",
        "ME" | "ME1" => "me1",
        "KR" => "kr",
        "JP" | "JP1" => "jp1",
        "OCE" | "OC1" => "oc1",
        "SG" | "SG2" | "PH" | "TH" => "sg2",
        "TW" | "TW2" => "tw2",
        "VN" | "VN2" => "vn2",
        _ => return None,
    })
}

/// A game with no names, Riot IDs or account ids, players in a fixed order so the sharer can't be picked out
/// by position. None when the game is missing what makes it usable. Mirrors importer/mayhem_import.py.
fn anonymise(game: &Value) -> Option<Value> {
    let id = game["gameId"].as_u64()?;
    let version: Vec<&str> = game["gameVersion"].as_str()?.split('.').collect();
    let created = game["gameCreation"].as_u64().filter(|c| *c > 0)?;
    if version.len() < 2 {
        return None;
    }
    let num = |v: &Value| v.as_u64().unwrap_or(0);
    let present = |s: &Value, keys: &mut dyn Iterator<Item = String>| -> Vec<u64> {
        keys.map(|k| num(&s[k.as_str()])).filter(|v| *v > 0).collect()
    };
    let mut players: Vec<Value> = game["participants"]
        .as_array()?
        .iter()
        .map(|p| {
            let s = &p["stats"];
            let multi = ["doubleKills", "tripleKills", "quadraKills", "pentaKills"].map(|k| num(&s[k]));
            json!({
                "team": num(&p["teamId"]), "champ": num(&p["championId"]), "win": s["win"].as_bool().unwrap_or(false),
                "k": num(&s["kills"]), "d": num(&s["deaths"]), "a": num(&s["assists"]),
                "dmg": num(&s["totalDamageDealtToChampions"]), "taken": num(&s["totalDamageTaken"]), "heal": num(&s["totalHeal"]),
                "gold": num(&s["goldEarned"]), "cs": num(&s["totalMinionsKilled"]) + num(&s["neutralMinionsKilled"]),
                "level": num(&s["champLevel"]),
                "multi": multi,
                "spree": num(&s["largestKillingSpree"]),
                "augs": present(s, &mut (1..=6).map(|i| format!("playerAugment{i}"))),
                "items": present(s, &mut (0..7).map(|i| format!("item{i}"))),
                "spells": [num(&p["spell1Id"]), num(&p["spell2Id"])],
                "styles": [num(&s["perkPrimaryStyle"]), num(&s["perkSubStyle"])],
                "perks": present(s, &mut (0..6).map(|i| format!("perk{i}"))),
            })
        })
        .collect();
    players.sort_by_key(|p| (num(&p["team"]), num(&p["champ"])));
    let teams: Vec<Value> = game["teams"]
        .as_array()
        .map(|ts| {
            ts.iter()
                .map(|t| {
                    json!({
                        "id": num(&t["teamId"]),
                        "win": t["win"].as_str() == Some("Win") || t["win"].as_bool() == Some(true),
                        "towers": num(&t["towerKills"]), "inhibs": num(&t["inhibitorKills"]),
                        "firstBlood": t["firstBlood"].as_bool().unwrap_or(false),
                        "firstTower": t["firstTower"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let duration = num(&game["gameDuration"]);
    Some(json!({
        "id": id.to_string(),
        "platform": game["platformId"].as_str().unwrap_or("").to_lowercase(),
        "patch": format!("{}.{}", version[0], version[1]),
        "queue": num(&game["queueId"]),
        "played": ymd(created / 1000),
        "duration": if duration > 20_000 { (duration + 500) / 1000 } else { duration },
        "teams": teams,
        "players": players,
    }))
}

/// A Unix time in seconds as YYYY-MM-DD (UTC).
fn ymd(secs: u64) -> String {
    // Howard Hinnant's days-to-civil.
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The League client's local API on this computer, read-only.
struct Lcu {
    base: String,
    auth: String,
    agent: ureq::Agent,
}

impl Lcu {
    fn find() -> Option<Self> {
        let (port, password) = lockfile().or_else(command_line)?;
        // The client serves its local API with Riot's own certificate; the connection never leaves 127.0.0.1.
        let agent = ureq::Agent::config_builder()
            .tls_config(ureq::tls::TlsConfig::builder().disable_verification(true).build())
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        Some(Lcu {
            base: format!("https://127.0.0.1:{port}"),
            auth: format!("Basic {}", base64(format!("riot:{password}").as_bytes())),
            agent,
        })
    }

    fn get(&self, path: &str) -> Result<Value, ()> {
        self.agent
            .get(format!("{}{path}", self.base))
            .header("Authorization", &self.auth)
            .call()
            .map_err(|_| ())?
            .body_mut()
            .read_json()
            .map_err(|_| ())
    }
}

fn lockfile() -> Option<(String, String)> {
    let candidates: &[&str] = if cfg!(windows) {
        &[r"C:\Riot Games\League of Legends\lockfile", r"D:\Riot Games\League of Legends\lockfile"]
    } else {
        &["/Applications/League of Legends.app/Contents/LoL/lockfile"]
    };
    let mut paths: Vec<PathBuf> = candidates.iter().map(PathBuf::from).collect();
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join("Applications/League of Legends.app/Contents/LoL/lockfile"));
    }
    paths.iter().find_map(|p| parse_lockfile(&fs::read_to_string(p).ok()?))
}

/// "LeagueClient:<pid>:<port>:<password>:<protocol>"
fn parse_lockfile(text: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() != 5 || !parts[2].chars().all(|c| c.is_ascii_digit()) || parts[3].is_empty() {
        return None;
    }
    Some((parts[2].to_string(), parts[3].to_string()))
}

/// For installs outside the usual folder: the running client's command line has the port and password.
fn command_line() -> Option<(String, String)> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("powershell");
        c.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | ForEach-Object { $_.CommandLine }",
        ]);
        c
    } else {
        let mut c = std::process::Command::new("ps");
        c.args(["-A", "-o", "args="]);
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let out = String::from_utf8(cmd.output().ok()?.stdout).ok()?;
    out.lines().filter(|l| l.contains("LeagueClientUx")).find_map(|l| {
        let arg = |name: &str| {
            let start = l.find(name)? + name.len();
            let value: String =
                l[start..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            (!value.is_empty()).then_some(value)
        };
        Some((arg("--app-port=")?, arg("--remoting-auth-token=")?))
    })
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64(b"riot:abc"), "cmlvdDphYmM=");
        assert_eq!(base64(b"riot:ab"), "cmlvdDphYg==");
        assert_eq!(base64(b"riot:a"), "cmlvdDph");
    }

    #[test]
    fn reads_the_lockfile() {
        assert_eq!(
            parse_lockfile("LeagueClient:1234:54321:s3cr-et_X:https\n"),
            Some(("54321".into(), "s3cr-et_X".into()))
        );
        assert_eq!(parse_lockfile("garbage"), None);
    }

    #[test]
    fn dates_are_utc_days() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(1_795_132_800), "2026-11-20");
        assert_eq!(ymd(951_782_400), "2000-02-29");
    }

    #[test]
    fn regions_map_to_servers() {
        assert_eq!(platform_for("NA"), Some("na1"));
        assert_eq!(platform_for("euw"), Some("euw1"));
        assert_eq!(platform_for("PBE"), None);
    }

    #[test]
    fn anonymised_games_carry_no_names_or_ids() {
        let game = json!({
            "gameId": 5616465966u64, "platformId": "NA1", "gameVersion": "16.23.712.1234", "gameCreation": 1_795_132_800_000u64,
            "gameDuration": 1100, "queueId": 2400,
            "participantIdentities": [{"participantId": 1, "player": {"gameName": "Someone", "tagLine": "NA1", "puuid": "abc-123", "summonerName": "Someone", "accountId": 42}}],
            "participants": [
                {"participantId": 2, "teamId": 200, "championId": 99, "spell1Id": 4, "spell2Id": 32,
                 "stats": {"win": false, "kills": 3, "item0": 3089, "item1": 0, "playerAugment1": 1205, "perk0": 8214}},
                {"participantId": 1, "teamId": 100, "championId": 157, "spell1Id": 4, "spell2Id": 14,
                 "stats": {"win": true, "kills": 12, "item0": 6672, "playerAugment1": 1012, "playerAugment2": 1044}}
            ],
            "teams": [{"teamId": 100, "win": "Win", "towerKills": 4}, {"teamId": 200, "win": "Fail"}]
        });
        let clean = anonymise(&game).unwrap();
        let text = clean.to_string();
        for secret in ["Someone", "abc-123", "puuid", "summoner", "accountId", "gameName", "participantId"] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
        assert_eq!(clean["patch"], "16.23");
        assert_eq!(clean["played"], "2026-11-20");
        assert_eq!(clean["platform"], "na1");
        assert_eq!(clean["players"][0]["champ"], 157);
        assert_eq!(clean["players"][0]["augs"], json!([1012, 1044]));
        assert_eq!(clean["players"][1]["items"], json!([3089]));
        assert_eq!(clean["teams"][0]["win"], true);
    }
}
