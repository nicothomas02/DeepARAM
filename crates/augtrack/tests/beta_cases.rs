//! The beta's recorded games replayed through the tracker, input by input (the release gate for augment picks).
//!
//! Each game folder (the private archive's archive/beta/<gameId>/, tools/beta_sync.py) holds inputs.jsonl: the
//! tracker's raw inputs on its own clock, {"now", "game": [gameTime, level, dead, width]}, {"now", "read": {...} | null,
//! "cursor": [x, y_rel] | null}, {"now", "click": [x, y_rel]}, and eog.json, the client's end-of-game stats whose
//! PLAYER_AUGMENT_1-6 are the picks you really made. Set AUGTRACK_BETA to that archive/beta folder; without it the
//! test does nothing (public CI has no recordings).
//!
//! Gate (Nico 2026-11-27, "never mark a wrong pick"): no game may mark a pick that isn't one of its post-game picks.
//! Picks left unknown are counted and printed, not failed. Games without inputs.jsonl or eog.json are skipped (owner
//! builds before inputs logging, or a game filed before its end-of-game stats arrived).
use augtrack::{Headliner, Read, Tracker};
use serde_json::Value;
use std::path::Path;

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

fn nums(v: &Value) -> Vec<f64> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default()
}

/// PLAYER_AUGMENT_1-6 of the local player: localPlayer.stats first, else the first object that holds them.
pub fn truth(eog: &Value) -> Vec<i64> {
    fn find(v: &Value) -> Option<&Value> {
        match v {
            Value::Object(m) if m.contains_key("PLAYER_AUGMENT_1") => Some(v),
            Value::Object(m) => m.values().find_map(find),
            Value::Array(a) => a.iter().find_map(find),
            _ => None,
        }
    }
    let stats = eog
        .pointer("/localPlayer/stats")
        .filter(|s| s.get("PLAYER_AUGMENT_1").is_some())
        .or_else(|| find(eog));
    let Some(stats) = stats else {
        return vec![];
    };
    (1..=6)
        .filter_map(|i| {
            let v = &stats[format!("PLAYER_AUGMENT_{i}")];
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
        .filter(|&a| a != 0)
        .collect()
}

/// Replays one game's inputs; returns the picks the tracker marked (before the post-game list replaces them).
pub fn replay(inputs: &str) -> Vec<i64> {
    let mut t = Tracker::new();
    for line in inputs.lines() {
        let Ok(e) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let now = e["now"].as_f64().unwrap_or(0.0);
        if let Some(g) = e.get("game").and_then(Value::as_array) {
            let gt = g.first().and_then(Value::as_f64).unwrap_or(0.0);
            let level = g.get(1).and_then(Value::as_u64).unwrap_or(0) as u32;
            let dead = g.get(2).and_then(Value::as_bool).unwrap_or(false);
            let width = g.get(3).and_then(Value::as_f64).unwrap_or(1920.0);
            t.game(now, gt, level, dead, Headliner::None, width);
        } else if e.get("read").is_some() {
            let r = &e["read"];
            let read = (!r.is_null()).then(|| Read {
                ids: ids(&r["ids"]),
                xs: nums(&r["xs"]),
                from_window: r["from_window"].as_bool().unwrap_or(false),
                blank: r["blank"].as_bool().unwrap_or(false),
            });
            let c = nums(&e["cursor"]);
            let cursor = (c.len() == 2).then(|| (c[0], c[1]));
            t.read(now, read, cursor);
        } else if let Some(c) = e.get("click") {
            let c = nums(c);
            if c.len() == 2 {
                t.click(now, c[0], c[1]);
            }
        }
    }
    t.picked.clone()
}

#[test]
fn recorded_beta_games_never_mark_a_wrong_pick() {
    let Ok(dir) = std::env::var("AUGTRACK_BETA") else {
        return;
    };
    let mut games = 0;
    let (mut right, mut missing, mut wrong) = (0, 0, 0);
    let mut out = String::new();
    let mut dirs: Vec<_> = std::fs::read_dir(&dir)
        .map(|d| d.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    dirs.sort();
    for d in dirs {
        let (inp, eog) = (d.join("inputs.jsonl"), d.join("eog.json"));
        if !inp.exists() || !eog.exists() {
            continue;
        }
        let truth = truth(
            &serde_json::from_str(&std::fs::read_to_string(&eog).unwrap_or_default()).unwrap_or(Value::Null),
        );
        if truth.is_empty() {
            continue;
        }
        games += 1;
        let picked = replay(&std::fs::read_to_string(&inp).unwrap_or_default());
        let bad: Vec<i64> = picked.iter().filter(|a| !truth.contains(a)).cloned().collect();
        let got = picked.iter().filter(|a| truth.contains(a)).count();
        right += got;
        missing += truth.len().saturating_sub(got);
        let name = Path::new(&d).file_name().unwrap_or_default().to_string_lossy().to_string();
        if !bad.is_empty() {
            wrong += bad.len();
            out += &format!("game {name}: WRONG {bad:?} (truth {truth:?}, marked {picked:?})\n");
        } else if got < truth.len() {
            out += &format!("game {name}: {got}/{} marked, missing {:?}\n", truth.len(),
                truth.iter().filter(|a| !picked.contains(a)).collect::<Vec<_>>());
        }
    }
    println!("{games} recorded games: right {right}, missing {missing}, wrong {wrong}\n{out}");
    assert_eq!(wrong, 0, "wrong picks marked:\n{out}");
}

#[test]
fn truth_reads_the_end_of_game_stats() {
    let v: Value = serde_json::from_str(
        r#"{"localPlayer":{"stats":{"PLAYER_AUGMENT_1":"1080","PLAYER_AUGMENT_2":1053,"PLAYER_AUGMENT_3":0}}}"#,
    )
    .unwrap();
    assert_eq!(truth(&v), vec![1080, 1053]);
    let nested: Value = serde_json::from_str(r#"{"teams":[{"players":[{"stats":{"PLAYER_AUGMENT_1":1001}}]}]}"#).unwrap();
    assert_eq!(truth(&nested), vec![1001]);
}

#[test]
fn replay_feeds_inputs_in_order() {
    // a start screen read, then a click on the middle card: the tracker sees the same calls the app made
    let inputs = r#"{"now":0.0,"game":[5.0,1,false,1920.0]}
{"now":0.3,"read":{"ids":[1004,1225,1080],"xs":[576.0,960.0,1344.0],"from_window":false,"blank":false},"cursor":null}
{"now":0.6,"read":{"ids":[1004,1225,1080],"xs":[576.0,960.0,1344.0],"from_window":false,"blank":false},"cursor":null}
not json
{"now":1.0,"click":[960.0,0.4]}"#;
    let _ = replay(inputs); // never panics on any line; marks only what the real tracker marks
}
