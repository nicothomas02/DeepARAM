//! Logged screens from the owner's PC replayed through the tracker (reads.jsonl, clicks.jsonl, eog.jsonl from the
//! private archive's probe folder). Set AUGTRACK_TRACES to that folder; without it the test does nothing (public CI).
//! Click times are logged to the second, so each run shifts them by up to +-0.5 s. Gate: no wrong picks (a pick that
//! isn't one of that game's post-game picks).
use augtrack::{Headliner, Read, Tracker};
use serde_json::Value;

fn lines(dir: &str, f: &str) -> Vec<Value> {
    std::fs::read_to_string(format!("{dir}/{f}"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

#[test]
fn logged_games_under_frame_drops_never_mark_a_wrong_pick() {
    let Ok(dir) = std::env::var("AUGTRACK_TRACES") else {
        return;
    };
    let reads = lines(&dir, "reads.jsonl");
    let clicks = lines(&dir, "clicks.jsonl");
    let mut eog = lines(&dir, "eog.jsonl");
    eog.sort_by(|a, b| {
        a["at"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&b["at"].as_f64().unwrap_or(0.0))
    });
    let (w, xs) = (1920.0, [0.3 * 1920.0, 0.5 * 1920.0, 0.7 * 1920.0]);
    let (mut screens, mut right, mut wrong, mut total) = (0, 0, 0, 0);
    let mut prev = 0.0;
    let mut out = String::new();
    for e in &eog {
        let end = e["at"].as_f64().unwrap_or(0.0);
        let truth = ids(&e["truth"]);
        let rs: Vec<&Value> = reads
            .iter()
            .filter(|r| r["at"].as_f64().is_some_and(|a| prev < a && a < end))
            .collect();
        let cs: Vec<&Value> = clicks
            .iter()
            .filter(|c| c["at"].as_f64().is_some_and(|a| prev < a && a < end))
            .collect();
        prev = end;
        // split into screens: reads within 25 s of each other
        let mut groups: Vec<Vec<&Value>> = vec![];
        for r in rs {
            let at = r["at"].as_f64().unwrap();
            if groups
                .last()
                .is_none_or(|g: &Vec<&Value>| at - g.last().unwrap()["at"].as_f64().unwrap() > 25.0)
            {
                groups.push(vec![]);
            }
            groups.last_mut().unwrap().push(r);
        }
        for g in groups {
            if !g.iter().any(|r| ids(&r["ids"]).len() >= 2) {
                continue;
            }
            let seen: Vec<i64> = g
                .iter()
                .flat_map(|r| ids(&r["ids"]).into_iter().chain(ids(&r["offer"])))
                .collect();
            let want: Vec<i64> = truth
                .iter()
                .filter(|a| seen.contains(a))
                .take(1)
                .cloned()
                .collect();
            let t0 = g[0]["at"].as_f64().unwrap() - 0.5;
            let last = g.last().unwrap()["at"].as_f64().unwrap() - t0 + 1.0;
            screens += 1;
            let mut hits = 0;
            let mut by_rate = [0u32; 3];
            for run in 0..27u64 {
                let drop = [0.1, 0.3, 0.5][(run / 9) as usize];
                let mut seed = run * 2_654_435_761 + 1;
                let mut rnd = move || {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    (seed % 10_000) as f64 / 10_000.0
                };
                let mut last_read: Option<Read> = None;
                let mut t = Tracker::new();
                let mut now = 0.0;
                let jit =
                    |k: usize| (((run * 7919 + k as u64 * 104_729) % 1000) as f64 / 1000.0) - 0.5;
                let mut cl: Vec<(f64, f64, f64)> = cs
                    .iter()
                    .enumerate()
                    .filter_map(|(k, c)| {
                        let at = c["at"].as_f64()? - t0 + jit(k);
                        let y = c["y"].as_f64()?;
                        let x = c["x"].as_f64()? * w;
                        (at > -1.0 && at < last + 5.0 && (0.1..=0.8).contains(&y)).then_some((
                            at.max(0.0),
                            x,
                            y,
                        ))
                    })
                    .collect();
                cl.sort_by(|a, b| a.0.total_cmp(&b.0));
                let mut ci = 0;
                while now <= last + 15.0 {
                    t.game(now, 30.0, 3, true, Headliner::None, w);
                    while ci < cl.len() && cl[ci].0 <= now {
                        t.click(now, cl[ci].1, cl[ci].2);
                        ci += 1;
                    }
                    let cur = g
                        .iter()
                        .rev()
                        .find(|r| r["at"].as_f64().unwrap() - t0 <= now);
                    let read = match cur {
                        Some(r) if !r["ids"].is_null() => {
                            let v = ids(&r["ids"]);
                            let x = if v.len() == 1 {
                                vec![xs[1]]
                            } else {
                                xs[..v.len().min(3)].to_vec()
                            };
                            Some(Read {
                                xs: if v.len() <= 3 { x } else { vec![] },
                                ids: v,
                                from_window: r["src"] == "window",
                                blank: false,
                            })
                        }
                        Some(_) => None,
                        None => Some(Read::default()),
                    };
                    // frame drops: the capture misses this frame (no read), sees a blank card area, or repeats the last frame
                    let r = rnd();
                    let read = if r < drop / 3.0 {
                        None
                    } else if r < 2.0 * drop / 3.0 {
                        Some(Read {
                            blank: true,
                            ..Read::default()
                        })
                    } else if r < drop {
                        last_read.clone()
                    } else {
                        read
                    };
                    last_read = read.clone();
                    t.read(now, read, None);
                    now += t.nap(now, true);
                }
                total += 1;
                let bad: Vec<i64> = t
                    .picked
                    .iter()
                    .filter(|a| !truth.contains(a))
                    .cloned()
                    .collect();
                if !bad.is_empty() {
                    wrong += 1;
                    out += &format!("champ {} truth {:?} got {:?}\n", e["cid"], want, t.picked);
                }
                if !want.is_empty() && want.iter().all(|a| t.picked.contains(a)) {
                    right += 1;
                    hits += 1;
                    by_rate[(run / 9) as usize] += 1;
                }
            }
            // a screen it misses, to look at in the probe logs (Shaco 2026-11-27 round 3, all 9 of 81 misses: the
            // pick fell between two of the old app's 40 ms button samples, so its click isn't in clicks.jsonl;
            // tests/clicks.rs replays it with the pick put back)
            if hits < 27 {
                out += &format!(
                    "missed: champ {} screen at {t0:.1} want {want:?}, right {hits}/27 (10%/30%/50% drops: {by_rate:?} of 9)\n",
                    e["cid"]
                );
            }
        }
    }
    println!("{screens} logged screens x 27 runs with frame drops: right {right}/{total}, wrong {wrong}\n{out}");
    assert_eq!(wrong, 0, "{out}");
}
