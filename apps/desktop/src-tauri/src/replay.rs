// The owner's replay window (Nico 2026-11-28: "have it automatically include newest games too ... combine
// screenshots and app captures"). Everything comes off this PC, so a game shows up as soon as it's over, with no
// upload or republish: each Mayhem game's post-game stats from the League client (saved under offers/<gameId>/
// match.json), and, when the app recorded it, the offer screens it saved, what it read, and what the companion
// showed (offers.jsonl, shown.jsonl, screens.jsonl, the PNGs). Older games (the old PC app's archive, replayed
// through the app's code on GitHub) come as one page from the owner's private feed: the "Older games" tab.
// Owner only (the `record-offers` file); nothing here runs during a game, and the window opens only from the tray.
#![cfg_attr(not(windows), allow(dead_code))]

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The recordings folder, on the owner's PC only.
fn offers_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = app.path().app_data_dir().ok()?;
    base.join("record-offers").exists().then(|| base.join("offers"))
}

/// A game folder's name: its game id, or "current" for the files of the game not yet filed (offers/ itself).
fn game_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let dir = offers_dir(app)?;
    if id == "current" {
        return Some(dir);
    }
    (!id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())).then(|| dir.join(id))
}

/// Opens (or brings back) the replay window.
pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("replay") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "replay", WebviewUrl::App("replay.html".into()))
        .title("DeepARAM replay")
        .inner_size(1180.0, 900.0)
        .min_inner_size(420.0, 500.0)
        .build();
}

/// Saves the post-game stats of recent Mayhem games that don't have them yet, from the League client (when it's
/// open). Only the player's own identity is kept; the other nine stay anonymous, as on the site.
pub fn save_matches(app: &AppHandle) {
    let Some(dir) = offers_dir(app) else { return };
    let Some(lcu) = crate::sharing::Lcu::find() else { return };
    let Some(me) =
        lcu.get("/lol-summoner/v1/current-summoner").ok().and_then(|s| s["puuid"].as_str().map(String::from))
    else {
        return;
    };
    for id in crate::sharing::recent_mayhem(&lcu) {
        let to = dir.join(id.to_string());
        if to.join("match.json").exists() {
            continue;
        }
        let Ok(game) = lcu.get(&format!("/lol-match-history/v1/games/{id}")) else { continue };
        let Some(clean) = keep_me(game, &me) else { continue };
        if fs::create_dir_all(&to).is_ok() {
            let _ = fs::write(to.join("match.json"), clean.to_string());
        }
    }
}

/// A match-history game with only the player's own identity left in it, and their puuid noted as `_me`.
pub fn keep_me(mut game: Value, me: &str) -> Option<Value> {
    let ids = game["participantIdentities"].as_array()?;
    let mine: Vec<Value> = ids.iter().filter(|p| p["player"]["puuid"].as_str() == Some(me)).cloned().collect();
    if mine.is_empty() {
        return None;
    }
    game["participantIdentities"] = Value::Array(mine);
    game["_me"] = json!(me);
    Some(game)
}

/// A few seconds after a game ends its stats reach match history: save them then, so the game is in the replay
/// before the next champion select.
pub fn after_game(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        for wait in [90u64, 240] {
            std::thread::sleep(Duration::from_secs(wait));
            save_matches(&app);
        }
    });
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

fn read_lines(p: &Path) -> Vec<Value> {
    fs::read_to_string(p)
        .map(|t| t.lines().filter_map(|l| serde_json::from_str(l.trim_start_matches('\u{feff}')).ok()).collect())
        .unwrap_or_default()
}

fn num(v: &Value) -> i64 {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0)
}

/// One line per game for the list: champion, when, result, augments and items, and which kinds of data it has.
pub fn summary(id: &str, files: &[String], m: Option<&Value>, eog: Option<&Value>) -> Value {
    let mut s = json!({ "id": id, "files": files });
    let augs = |st: &Value, prefix: &str| -> Vec<i64> {
        (1..=6).map(|k| num(&st[format!("{prefix}{k}")])).filter(|a| *a > 0).collect()
    };
    if let Some(m) = m {
        let me = m["_me"].as_str().unwrap_or("");
        let pid = m["participantIdentities"]
            .as_array()
            .and_then(|ids| ids.iter().find(|p| p["player"]["puuid"].as_str() == Some(me)))
            .map(|p| num(&p["participantId"]));
        let part =
            m["participants"].as_array().and_then(|ps| ps.iter().find(|p| Some(num(&p["participantId"])) == pid));
        if let Some(p) = part {
            let st = &p["stats"];
            let dur = m["gameDuration"].as_f64().unwrap_or(0.0);
            s["champ"] = json!(num(&p["championId"]));
            s["win"] = json!(st["win"].as_bool());
            s["kda"] = json!([num(&st["kills"]), num(&st["deaths"]), num(&st["assists"])]);
            s["augs"] = json!(augs(st, "playerAugment"));
            s["items"] = json!((0..=6).map(|k| num(&st[format!("item{k}")])).filter(|i| *i > 0).collect::<Vec<_>>());
            s["at"] = json!(num(&m["gameCreation"]));
            s["secs"] = json!(if dur > 20_000.0 { dur / 1000.0 } else { dur });
            s["queue"] = json!(num(&m["queueId"]));
            return s;
        }
    }
    if let Some(e) = eog {
        let lp = &e["localPlayer"];
        let st = &lp["stats"];
        let team = num(&lp["teamId"]);
        let won = e["teams"]
            .as_array()
            .and_then(|ts| ts.iter().find(|t| num(&t["teamId"]) == team))
            .and_then(|t| t["isWinningTeam"].as_bool());
        let secs = num(&e["gameLength"]);
        s["champ"] = json!(num(&lp["championId"]));
        s["win"] = json!(won);
        s["kda"] = json!([num(&st["CHAMPIONS_KILLED"]), num(&st["NUM_DEATHS"]), num(&st["ASSISTS"])]);
        s["augs"] = json!(augs(st, "playerAugment"));
        s["items"] = json!(lp["items"].as_array().map(|a| a.iter().map(num).filter(|i| *i > 0).collect::<Vec<_>>()));
        s["at"] = json!(num(&e["endOfGameTimestamp"]) - secs * 1000);
        s["secs"] = json!(secs);
    }
    s
}

fn list_files(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

/// When a game without post-game stats was played: its first recorded moment (file names are wall-clock ms).
fn first_moment(files: &[String]) -> Option<i64> {
    files.iter().filter_map(|f| f.strip_suffix(".png")?.split('-').next()?.parse::<i64>().ok()).min()
}

/// Every game on this PC, newest first. Saves any missing post-game stats first (League client open).
#[tauri::command(async)]
pub fn replay_games(app: AppHandle) -> Vec<Value> {
    save_matches(&app);
    let Some(dir) = offers_dir(&app) else { return Vec::new() };
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !e.path().is_dir() || !name.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let files = list_files(&e.path());
        let mut s = summary(
            &name,
            &files,
            read_json(&e.path().join("match.json")).as_ref(),
            read_json(&e.path().join("eog.json")).as_ref(),
        );
        if s.get("at").is_none() {
            if let Some(t) = first_moment(&files) {
                s["at"] = json!(t);
            }
        }
        out.push(s);
    }
    // The game being played or just over, not filed until the next champion select.
    let top = list_files(&dir);
    if top.iter().any(|f| f == "offers.jsonl" || f == "screens.jsonl") {
        let mut s = summary("current", &top, None, read_json(&dir.join("eog.json")).as_ref());
        if let Some(id) = fs::read_to_string(dir.join("last-game.txt")).ok().map(|t| t.trim().to_owned()) {
            s["game"] = json!(id);
        }
        if s.get("at").is_none() {
            s["at"] = json!(first_moment(&top).unwrap_or(i64::MAX));
        }
        out.push(s);
    }
    out.sort_by_key(|s| std::cmp::Reverse(num(&s["at"])));
    out
}

/// One game's recordings: tracker lines, what the companion showed, its screens, post-game stats, headliner.
#[tauri::command(async)]
pub fn replay_game(app: AppHandle, id: String) -> Value {
    let Some(dir) = game_dir(&app, &id) else { return Value::Null };
    let files = list_files(&dir);
    let headliner = fs::read_to_string(dir.join("inputs.jsonl")).ok().and_then(|t| {
        t.lines()
            .find(|l| l.contains("\"headliner\""))
            .and_then(|l| serde_json::from_str::<Value>(l).ok())
            .map(|v| v["headliner"].clone())
    });
    json!({
        "files": files,
        "offers": read_lines(&dir.join("offers.jsonl")),
        "shown": read_lines(&dir.join("shown.jsonl")),
        "screens": read_lines(&dir.join("screens.jsonl")),
        "eog": read_json(&dir.join("eog.json")),
        "match": read_json(&dir.join("match.json")),
        "headliner": headliner,
    })
}

/// One saved offer picture, as a data URL (only .png names inside the game's folder).
#[tauri::command(async)]
pub fn replay_png(app: AppHandle, id: String, name: String) -> Option<String> {
    let dir = game_dir(&app, &id)?;
    let safe = name.ends_with(".png")
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
    if !safe {
        return None;
    }
    let bytes = fs::read(dir.join(&name)).ok()?;
    Some(format!("data:image/png;base64,{}", crate::sharing::base64(&bytes)))
}

/// The older games' page (tools/replay on GitHub, every archived game through the app's code), from the owner's
/// private feed: refreshed when the copy here is over 6 hours old, kept when offline.
#[tauri::command(async)]
pub fn replay_history(app: AppHandle) -> Option<String> {
    let base = app.path().app_data_dir().ok()?;
    base.join("record-offers").exists().then_some(())?;
    let file = base.join("replay-history.html");
    let stale = fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_none_or(|age| age > Duration::from_secs(6 * 3600));
    if stale {
        fetch_history(&app, &file);
    }
    fs::read_to_string(&file).ok()
}

#[cfg(windows)]
const HISTORY_RELEASE: &str = "https://api.github.com/repos/nicothomas02/DeepARAM-PC/releases/tags/replay-history";
#[cfg(windows)]
const HISTORY_ASSET: &str = "app-replay.html";

#[cfg(windows)]
fn fetch_history(app: &AppHandle, file: &Path) {
    use crate::updater::{get, owner_key};
    let Some(key) = owner_key(app) else { return };
    let Some(rel) = get(HISTORY_RELEASE, Some(&key), false).and_then(|mut r| r.body_mut().read_json::<Value>().ok())
    else {
        return;
    };
    let Some(url) = rel["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str() == Some(HISTORY_ASSET)))
        .and_then(|x| x["url"].as_str())
    else {
        return;
    };
    let Some(text) = get(url, Some(&key), true)
        .and_then(|mut r| r.body_mut().with_config().limit(200 * 1024 * 1024).read_to_string().ok())
    else {
        return;
    };
    if text.contains("<title>App replay</title>") {
        let tmp = file.with_extension("part");
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, file);
        }
    }
}

#[cfg(not(windows))]
fn fetch_history(_app: &AppHandle, _file: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Value {
        json!({
            "gameId": 1, "gameCreation": 1_795_845_000_000i64, "gameDuration": 1245, "queueId": 2400,
            "participantIdentities": [
                {"participantId": 1, "player": {"puuid": "me", "gameName": "Nico"}},
                {"participantId": 2, "player": {"puuid": "other", "gameName": "Someone"}}
            ],
            "participants": [
                {"participantId": 1, "championId": 221, "stats": {"win": true, "kills": 15, "deaths": 13, "assists": 17,
                  "item0": 3118, "item1": 0, "item6": 220013, "playerAugment1": 3118, "playerAugment2": 1129, "playerAugment3": 0}},
                {"participantId": 2, "championId": 235, "stats": {"win": false}}
            ]
        })
    }

    #[test]
    fn keeps_only_the_players_own_identity() {
        let g = keep_me(game(), "me").unwrap();
        assert_eq!(g["participantIdentities"].as_array().unwrap().len(), 1);
        assert_eq!(g["_me"], "me");
        assert!(!g.to_string().contains("Someone"));
        assert!(keep_me(game(), "nobody").is_none());
    }

    #[test]
    fn summarises_the_players_line() {
        let g = keep_me(game(), "me").unwrap();
        let s = summary("1", &["match.json".into()], Some(&g), None);
        assert_eq!(s["champ"], 221);
        assert_eq!(s["win"], true);
        assert_eq!(s["kda"], json!([15, 13, 17]));
        assert_eq!(s["augs"], json!([3118, 1129]));
        assert_eq!(s["items"], json!([3118, 220013]));
        assert_eq!(s["secs"], 1245.0);
    }

    #[test]
    fn falls_back_to_end_of_game_stats() {
        let eog = json!({"gameLength": 1245, "endOfGameTimestamp": 1_795_849_639_544i64,
            "teams": [{"teamId": 200, "isWinningTeam": true}, {"teamId": 100, "isWinningTeam": false}],
            "localPlayer": {"championId": 221, "teamId": 200, "items": [3118, 0, 220013],
              "stats": {"CHAMPIONS_KILLED": 15, "NUM_DEATHS": 13, "ASSISTS": 17, "playerAugment1": 3118, "playerAugment2": 0}}});
        let s = summary("1", &[], None, Some(&eog));
        assert_eq!(s["champ"], 221);
        assert_eq!(s["win"], true);
        assert_eq!(s["augs"], json!([3118]));
        assert_eq!(s["at"], 1_795_849_639_544i64 - 1_245_000);
    }

    #[test]
    fn dates_a_game_by_its_first_picture() {
        let files = vec!["offers.jsonl".into(), "1795844950931.png".into(), "1795844671738-partial.png".into()];
        assert_eq!(first_moment(&files), Some(1_795_844_671_738));
    }
}
