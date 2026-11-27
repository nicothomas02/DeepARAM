//! Live augment-reading simulator (Rust port of the PC app's tools/replay/livesim.py, Nico 2026-11-27: "simulate app
//! to keep fixing issues with reading augments"). Runs the tracker on a scripted clock with the screen reads, cursor
//! and clicks of what broke live, at many random timings, and scores the picks against the truth.
//!
//! Release gate: no run may mark a wrong pick. Unknown rounds are counted but allowed.
//!
//! Logged games (reads/clicks/post-game picks from the owner's PC) run in the private repo's CI via AUGTRACK_TRACES.

use augtrack::{Headliner, Read, Tracker};

const W: f64 = 1920.0;
const XS: [f64; 3] = [0.3 * W, 0.5 * W, 0.7 * W];
const PICK_Y: f64 = 0.40;
const LOW_Y: f64 = 0.72;
const GAME_Y: f64 = 0.50;

/// Small deterministic RNG (xorshift64*), so the tests need no crates.
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn f(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn u(&mut self, lo: f64, hi: f64) -> f64 {
        ((lo + (hi - lo) * self.f()) * 100.0).round() / 100.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn sample(&mut self, pool: &[i64], k: usize) -> Vec<i64> {
        let mut p = pool.to_vec();
        let mut out = Vec::new();
        for _ in 0..k {
            let i = self.below(p.len());
            out.push(p.swap_remove(i));
        }
        out
    }
}

/// What the screen shows over a span: a whole read (ids at the card columns) or lone titles at given x.
#[derive(Clone, Debug)]
enum Show {
    Cards(Vec<i64>),
    Lone(Vec<(i64, f64)>),
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    Pick(usize),
    Low(usize),
    /// cards up, not read yet: on card i's column
    Early(usize),
    /// a left click in the game at x (play, away from any screen)
    Game(f64),
}

struct Scene {
    script: Vec<(f64, f64, Show)>,
    clicks: Vec<(f64, Kind)>,
    secs: f64,
    hover: Vec<(f64, f64)>,
    truth: Vec<i64>,
}

fn play(sc: &Scene, drop: f64, rng: &mut Rng) -> (Vec<i64>, u32) {
    let mut t = Tracker::new();
    let mut now = 0.0;
    let mut done = vec![false; sc.clicks.len()];
    while now <= sc.secs {
        // the start screen: game time 30 s, level 3, on the platform (one round owed)
        t.game(now, 30.0, 3, true, Headliner::None, W);
        for (k, (at, kind)) in sc.clicks.iter().enumerate() {
            if !done[k] && now >= *at {
                done[k] = true;
                let (x, y) = match *kind {
                    Kind::Pick(i) | Kind::Early(i) => (XS[i], PICK_Y),
                    Kind::Low(i) => (XS[i], LOW_Y),
                    Kind::Game(x) => (x, GAME_Y),
                };
                t.click(now, x, y);
            }
        }
        let show = sc
            .script
            .iter()
            .find(|(a, b, _)| *a <= now && now < *b)
            .map(|s| s.2.clone());
        let mut read = match show {
            Some(Show::Cards(ids)) => Read {
                xs: XS[..ids.len()].to_vec(),
                ids,
                ..Default::default()
            },
            Some(Show::Lone(v)) => Read {
                ids: v.iter().map(|p| p.0).collect(),
                xs: v.iter().map(|p| p.1).collect(),
                ..Default::default()
            },
            None => Read::default(),
        };
        let mut r = Some(read.clone());
        if !read.ids.is_empty() && rng.f() < drop {
            if rng.f() < 0.5 {
                r = None;
            } else {
                read.ids.clear();
                read.xs.clear();
                r = Some(read);
            }
        }
        let on = sc.hover.iter().any(|(a, b)| *a <= now && now < *b);
        let cursor = Some(if on { (XS[1], PICK_Y) } else { (XS[1], 1.02) });
        t.read(now, r, cursor);
        now += t.nap(now, true);
    }
    (t.picked.clone(), t.rounds)
}

fn cards3(v: &[i64]) -> Show {
    Show::Cards(v.to_vec())
}

fn scenario(kind: &str, rng: &mut Rng, pool: &[i64]) -> Scene {
    let c = rng.sample(pool, 9);
    let (a, b, cc, e, f, g, x, y, z) = (c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
    let cards = vec![a, b, cc];
    let i = rng.below(3);
    let empty = || Show::Cards(vec![]);
    match kind {
        "clean" => {
            let up = rng.u(1.5, 6.0);
            Scene {
                script: vec![(0.0, up, cards3(&cards)), (up, 99.0, empty())],
                clicks: vec![(rng.u(0.4, up - 0.2), Kind::Pick(i))],
                secs: up + 12.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        "slide_in" => {
            let a0 = rng.u(0.3, 0.8);
            let up = a0 + rng.u(0.6, 3.0);
            let k = rng.below(3);
            Scene {
                script: vec![
                    (0.0, a0, Show::Lone(vec![(cards[k], XS[k])])),
                    (a0, up, cards3(&cards)),
                    (up, 99.0, empty()),
                ],
                clicks: vec![(rng.u(a0 + 0.1, up - 0.1), Kind::Pick(i))],
                secs: up + 12.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        "quick_lone" => {
            let k1 = rng.below(3);
            let k2 = (k1 + 1 + rng.below(2)) % 3;
            Scene {
                script: vec![
                    (0.0, 0.5, empty()),
                    (0.5, 1.0, Show::Lone(vec![(cards[k1], XS[k1])])),
                    (1.0, 1.5, Show::Lone(vec![(cards[k2], XS[k2])])),
                    (1.5, 99.0, empty()),
                ],
                clicks: vec![(1.3, Kind::Early(k2))],
                secs: 14.0,
                hover: vec![],
                truth: vec![cards[k2]],
            }
        }
        "reroll" => {
            let r = rng.below(3);
            let mut new = cards.clone();
            new[r] = e;
            let lc = rng.u(0.8, 2.5);
            let flip = rng.u(0.3, 1.6);
            let up2 = lc + flip + rng.u(1.0, 5.0);
            let p = rng.below(3);
            let hov = if rng.f() < 0.5 {
                vec![(lc, lc + flip + rng.u(0.0, 3.0))]
            } else {
                vec![]
            };
            Scene {
                script: vec![
                    (0.0, lc + 0.15, cards3(&cards)),
                    (lc + 0.15, lc + flip, empty()),
                    (lc + flip, up2, cards3(&new)),
                    (up2, 99.0, empty()),
                ],
                clicks: vec![
                    (lc, Kind::Low(r)),
                    (rng.u(lc + flip + 0.2, up2 - 0.1), Kind::Pick(p)),
                ],
                secs: up2 + 14.0,
                hover: hov,
                truth: vec![new[p]],
            }
        }
        "double_reroll" => {
            let mut n1 = cards.clone();
            n1[0] = e;
            let mut n2 = n1.clone();
            n2[2] = f;
            let p = rng.below(3);
            Scene {
                script: vec![
                    (0.0, 1.2, cards3(&cards)),
                    (1.2, 1.9, empty()),
                    (1.9, 3.5, cards3(&n1)),
                    (3.5, 4.3, empty()),
                    (4.3, 7.0, cards3(&n2)),
                    (7.0, 99.0, empty()),
                ],
                clicks: vec![
                    (1.1, Kind::Low(0)),
                    (3.4, Kind::Low(2)),
                    (rng.u(4.6, 6.8), Kind::Pick(p)),
                ],
                secs: 22.0,
                hover: vec![],
                truth: vec![n2[p]],
            }
        }
        "early_pick" => {
            let first = rng.u(0.8, 2.5);
            Scene {
                script: vec![
                    (0.0, first, empty()),
                    (first, first + rng.u(0.3, 2.0), cards3(&cards)),
                    (first + 2.3, 99.0, empty()),
                ],
                clicks: vec![(rng.u(0.1, first - 0.1), Kind::Early(i))],
                secs: 16.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        "never_read" => Scene {
            script: vec![(0.0, 99.0, empty())],
            clicks: vec![(rng.u(0.5, 3.0), Kind::Early(i))],
            secs: 14.0,
            hover: vec![],
            truth: vec![],
        },
        "pentakill_next" => {
            let band = vec![3170, 3171, 3172];
            let q = rng.below(3);
            let up = rng.u(1.5, 3.0);
            let gap = rng.u(0.0, 0.6);
            Scene {
                script: vec![
                    (0.0, up, cards3(&cards)),
                    (up, up + gap, empty()),
                    (up + gap, up + gap + 2.5, cards3(&band)),
                    (up + gap + 2.5, 99.0, empty()),
                ],
                clicks: vec![
                    (rng.u(0.5, up - 0.1), Kind::Pick(i)),
                    (up + gap + 1.5, Kind::Pick(q)),
                ],
                secs: up + 20.0,
                hover: vec![],
                truth: vec![cards[i], band[q]],
            }
        }
        "headliner_set" => {
            let up = rng.u(2.0, 5.0);
            Scene {
                script: vec![
                    (0.0, up, cards3(&cards)),
                    (up, up + 0.5, empty()),
                    (up + 0.5, up + 3.0, cards3(&[x, y, z])),
                    (up + 3.0, 99.0, empty()),
                ],
                clicks: vec![(rng.u(0.5, up - 0.2), Kind::Pick(i))],
                secs: up + 16.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        "after_noise" => {
            let up = rng.u(1.5, 4.0);
            let mut script = vec![(0.0, up, cards3(&cards))];
            let mut clicks = vec![(rng.u(0.5, up - 0.1), Kind::Pick(i))];
            for k in 0..6 {
                let s0 = up + 2.0 + k as f64 * 0.8;
                let pickid = [cards[i], g, f][rng.below(3)];
                script.push((
                    s0,
                    s0 + 0.4,
                    Show::Lone(vec![(pickid, (0.1 + 0.8 * rng.f()) * W)]),
                ));
                clicks.push((up + 2.2 + k as f64, Kind::Game((0.2 + 0.6 * rng.f()) * W)));
            }
            script.push((up + 7.0, 99.0, empty()));
            Scene {
                script,
                clicks,
                secs: up + 20.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        "hover_hide" => {
            let up = rng.u(1.0, 3.0);
            let rest = rng.u(1.0, 6.0);
            Scene {
                script: vec![(0.0, up, cards3(&cards)), (up, 99.0, empty())],
                clicks: vec![(rng.u(0.4, up - 0.1), Kind::Pick(i))],
                secs: up + rest + 14.0,
                hover: vec![(up, up + rest)],
                truth: vec![cards[i]],
            }
        }
        // the swap came right after the pick (Briar R4): a click just before the new set must stay on the old cards
        "swap_click" => {
            let up = rng.u(2.0, 4.0);
            Scene {
                script: vec![
                    (0.0, up, cards3(&cards)),
                    (up, up + 2.5, cards3(&[x, y, z])),
                    (up + 2.5, 99.0, empty()),
                ],
                clicks: vec![(up - rng.u(0.05, 0.3), Kind::Pick(i))],
                secs: up + 16.0,
                hover: vec![],
                truth: vec![cards[i]],
            }
        }
        _ => unreachable!(),
    }
}

const KINDS: [&str; 12] = [
    "clean",
    "slide_in",
    "quick_lone",
    "reroll",
    "double_reroll",
    "early_pick",
    "never_read",
    "pentakill_next",
    "headliner_set",
    "after_noise",
    "hover_hide",
    "swap_click",
];

fn pool() -> Vec<i64> {
    (1001..1240).collect()
}

#[test]
fn fuzz_never_marks_a_wrong_pick() {
    let runs: u64 = std::env::var("AUGTRACK_RUNS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let pool = pool();
    let mut report = String::new();
    let mut wrong_total = 0;
    for kind in KINDS {
        let (mut right, mut missing, mut wrong) = (0, 0, 0);
        let mut example = None;
        for r in 0..runs {
            let mut rng = Rng::new(1000 + r);
            let sc = scenario(kind, &mut rng, &pool);
            let drop = if r % 2 == 1 { 0.1 } else { 0.0 };
            let (got, _) = play(&sc, drop, &mut rng);
            let bad: Vec<i64> = got
                .iter()
                .filter(|a| !sc.truth.contains(a))
                .cloned()
                .collect();
            let miss = sc.truth.iter().filter(|a| !got.contains(a)).count();
            missing += miss;
            right += sc.truth.len() - miss;
            if !bad.is_empty() {
                wrong += 1;
                example.get_or_insert(format!(
                    "seed {} truth {:?} got {:?} clicks {:?}",
                    1000 + r,
                    sc.truth,
                    got,
                    sc.clicks
                ));
            }
        }
        wrong_total += wrong;
        report +=
            &format!("{kind:15} runs {runs:4} right {right:4} missing {missing:4} WRONG {wrong}\n");
        if let Some(e) = example {
            report += &format!("   e.g. {e}\n");
        }
    }
    println!("{report}");
    assert_eq!(wrong_total, 0, "wrong picks:\n{report}");
}

#[test]
fn fuzz_mostly_right() {
    // not the gate, a floor: the clean cases must be right every time
    let pool = pool();
    for kind in [
        "clean",
        "slide_in",
        "double_reroll",
        "early_pick",
        "pentakill_next",
        "headliner_set",
        "after_noise",
        "hover_hide",
    ] {
        for r in 0..30 {
            let mut rng = Rng::new(5000 + r);
            let sc = scenario(kind, &mut rng, &pool);
            let (got, _) = play(&sc, 0.0, &mut rng);
            assert!(
                sc.truth.iter().all(|a| got.contains(a)),
                "{kind} seed {}: truth {:?} got {:?}",
                5000 + r,
                sc.truth,
                got
            );
        }
    }
}

// ------------------------------------------------------------------------------------- regressions from live games
fn fixed(
    script: Vec<(f64, f64, Show)>,
    clicks: Vec<(f64, Kind)>,
    secs: f64,
    hover: Vec<(f64, f64)>,
) -> (Vec<i64>, u32) {
    let sc = Scene {
        script,
        clicks,
        secs,
        hover,
        truth: vec![],
    };
    play(&sc, 0.0, &mut Rng::new(1))
}

const A: i64 = 1134;
const B: i64 = 1053;
const C: i64 = 1062;
const E: i64 = 1195;
const F: i64 = 1048;

#[test]
fn yunara_reroll_flip_is_not_the_pick() {
    let got = fixed(
        vec![
            (0.0, 2.5, cards3(&[A, B, C])),
            (2.5, 6.5, cards3(&[])),
            (6.5, 9.5, cards3(&[A, E, F])),
            (9.5, 99.0, cards3(&[])),
        ],
        vec![(2.0, Kind::Low(1)), (8.5, Kind::Pick(0))],
        18.0,
        vec![],
    );
    assert_eq!(got, (vec![A], 1));
}

#[test]
fn low_click_counts_the_round_marks_nothing() {
    let got = fixed(
        vec![(0.0, 2.5, cards3(&[A, B, C])), (2.5, 99.0, cards3(&[]))],
        vec![(2.0, Kind::Low(2))],
        12.0,
        vec![],
    );
    assert_eq!(got, (vec![], 1));
}

#[test]
fn irelia_hover_hides_titles_no_close() {
    let got = fixed(
        vec![
            (0.0, 2.5, cards3(&[A, B, C])),
            (2.5, 14.0, cards3(&[])),
            (14.0, 16.0, cards3(&[A, E, C])),
            (16.0, 99.0, cards3(&[])),
        ],
        vec![(2.0, Kind::Low(1)), (15.0, Kind::Pick(1))],
        26.0,
        vec![(2.0, 14.0)],
    );
    assert_eq!(got, (vec![E], 1));
}

#[test]
fn alistar_pick_before_reroll_read() {
    let got = fixed(
        vec![
            (0.0, 3.0, cards3(&[A, B, C])),
            (3.0, 5.0, cards3(&[A, B, F])),
            (5.0, 99.0, cards3(&[])),
        ],
        vec![(1.0, Kind::Low(2)), (2.0, Kind::Pick(0))],
        16.0,
        vec![],
    );
    assert_eq!(got, (vec![A], 1));
}

#[test]
fn alistar_click_before_first_read() {
    let got = fixed(
        vec![
            (0.0, 2.0, cards3(&[])),
            (2.0, 4.0, cards3(&[A, B, C])),
            (4.0, 99.0, cards3(&[])),
        ],
        vec![(1.0, Kind::Early(1))],
        14.0,
        vec![],
    );
    assert_eq!(got, (vec![B], 1));
}

#[test]
fn flip_read_as_close_gives_mark_back() {
    let got = fixed(
        vec![
            (0.0, 2.0, cards3(&[A, B, C])),
            (2.0, 4.2, cards3(&[])),
            (4.2, 6.0, cards3(&[A, E, C])),
            (6.0, 99.0, cards3(&[])),
        ],
        vec![(1.5, Kind::Pick(1)), (5.0, Kind::Pick(0))],
        18.0,
        vec![],
    );
    assert_eq!(got, (vec![A], 1));
}

#[test]
fn yunara_quick_pick_on_lone_titles() {
    let got = fixed(
        vec![
            (0.0, 1.0, cards3(&[])),
            (1.0, 1.5, Show::Lone(vec![(B, XS[1])])),
            (1.5, 2.0, Show::Lone(vec![(C, XS[0])])),
            (2.0, 2.5, Show::Lone(vec![(B, XS[1])])),
            (2.5, 99.0, cards3(&[])),
        ],
        vec![(2.2, Kind::Early(1))],
        12.0,
        vec![],
    );
    assert_eq!(got, (vec![B], 1));
}

#[test]
fn one_lone_title_and_a_click_is_no_pick() {
    let got = fixed(
        vec![
            (0.0, 1.0, cards3(&[])),
            (1.0, 2.0, Show::Lone(vec![(B, XS[1])])),
            (2.0, 99.0, cards3(&[])),
        ],
        vec![(1.5, Kind::Early(1))],
        12.0,
        vec![],
    );
    assert_eq!(got, (vec![], 0));
}

#[test]
fn shaco_new_screen_closes_the_old_one() {
    let got = fixed(
        vec![
            (0.0, 3.0, cards3(&[A, B, C])),
            (3.0, 5.0, cards3(&[3170, 3171, 3172])),
            (5.0, 99.0, cards3(&[])),
        ],
        vec![(2.0, Kind::Pick(1)), (4.0, Kind::Pick(0))],
        14.0,
        vec![],
    );
    assert_eq!(got, (vec![B, 3170], 1));
}

#[test]
fn briar_play_clicks_after_a_pick_mark_nothing() {
    // round 1 picked, then HUD tooltips (own Clown College, another title) and clicks in the game
    let got = fixed(
        vec![
            (0.0, 3.0, cards3(&[A, B, C])),
            (3.0, 5.0, cards3(&[])),
            (5.0, 5.4, Show::Lone(vec![(A, 0.3 * W)])),
            (5.8, 6.2, Show::Lone(vec![(F, 0.6 * W)])),
            (6.6, 7.0, Show::Lone(vec![(B, 0.5 * W)])),
            (7.0, 99.0, cards3(&[])),
        ],
        vec![
            (1.0, Kind::Pick(0)),
            (5.2, Kind::Game(0.6 * W)),
            (6.0, Kind::Game(0.5 * W)),
            (6.8, Kind::Game(0.3 * W)),
        ],
        20.0,
        vec![],
    );
    assert_eq!(got, (vec![A], 1));
}

#[test]
fn briar_unclicked_set_then_play_clicks() {
    // a card set nobody clicked went away; play clicks 2 s later must not "pick" from it
    let got = fixed(
        vec![
            (0.0, 3.0, cards3(&[A, B, C])),
            (3.0, 6.0, cards3(&[1300, 1301, 1302])),
            (6.0, 99.0, cards3(&[])),
        ],
        vec![
            (2.0, Kind::Pick(1)),
            (9.0, Kind::Pick(2)),
            (10.0, Kind::Pick(2)),
        ],
        22.0,
        vec![],
    );
    assert_eq!(got.0, vec![B]);
}

#[test]
#[ignore]
fn debug_seed() {
    let kind = std::env::var("K").unwrap_or("after_noise".into());
    let seed: u64 = std::env::var("S")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);
    let mut rng = Rng::new(seed);
    let sc = scenario(&kind, &mut rng, &pool());
    for s in &sc.script {
        println!("S {:.2}-{:.2} {:?}", s.0, s.1, s.2);
    }
    println!("C {:?}", sc.clicks);
    let mut t = Tracker::new();
    let mut now = 0.0;
    let mut done = vec![false; sc.clicks.len()];
    while now <= sc.secs {
        t.game(now, 30.0, 3, true, Headliner::None, W);
        for (k, (at, kind)) in sc.clicks.iter().enumerate() {
            if !done[k] && now >= *at {
                done[k] = true;
                let (x, y) = match *kind {
                    Kind::Pick(i) | Kind::Early(i) => (XS[i], PICK_Y),
                    Kind::Low(i) => (XS[i], LOW_Y),
                    Kind::Game(x) => (x, GAME_Y),
                };
                t.click(now, x, y);
                println!("{now:.2} click {kind:?} -> picked {:?}", t.picked);
            }
        }
        let show = sc
            .script
            .iter()
            .find(|(a, b, _)| *a <= now && now < *b)
            .map(|s| s.2.clone());
        let read = match show {
            Some(Show::Cards(ids)) => Read {
                xs: XS[..ids.len()].to_vec(),
                ids,
                ..Default::default()
            },
            Some(Show::Lone(v)) => Read {
                ids: v.iter().map(|p| p.0).collect(),
                xs: v.iter().map(|p| p.1).collect(),
                ..Default::default()
            },
            None => Read::default(),
        };
        t.read(now, Some(read), Some((XS[1], 1.02)));
        for e in t.events.drain(..) {
            println!("{now:.2} {e:?} picked {:?}", t.picked);
        }
        now += t.nap(now, true);
    }
    println!("truth {:?} got {:?}", sc.truth, t.picked);
}
