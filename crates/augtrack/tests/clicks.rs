//! The click watcher's sampling of the left button (augtrack::Button), and the logged screen it lost.
//!
//! The app asks Windows for the button every 40 ms (longer when the screen reader holds the CPU). Windows answers
//! with two bits: down right now, and pressed since the last time anyone asked. These tests model that on a 1 ms
//! clock and check that every press becomes exactly one click, however short it is.
//!
//! Shaco 2026-11-27, round 3 (traces.rs: all 9 of its 81 misses are this one screen, at 9 timings): the pick of the
//! right card fell between two 40 ms samples, the old app saw no click, and the round stayed unknown. The screen
//! is replayed here from its logged reads with that pick put back in, through the same sampler the app now uses.
use augtrack::{Button, Headliner, Read, Tracker};

/// Small deterministic RNG (xorshift64*), as in sim.rs.
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn f(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn u(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f()
    }
}

/// The left button as Windows keeps it: presses as (start, end) in seconds, and the "pressed since last asked" bit.
struct Mouse {
    presses: Vec<(f64, f64, f64, f64)>,
    asked: f64,
}

impl Mouse {
    /// presses: (start, end, x, y_rel)
    fn new(mut presses: Vec<(f64, f64, f64, f64)>) -> Self {
        presses.sort_by(|a, b| a.0.total_cmp(&b.0));
        Mouse {
            presses,
            asked: f64::NEG_INFINITY,
        }
    }
    /// What GetAsyncKeyState answers at `now`: (down now, pressed since the last call), and where the pointer is
    /// (where the latest press started).
    fn ask(&mut self, now: f64) -> (bool, bool, f64, f64) {
        let down = self.presses.iter().any(|p| p.0 <= now && now < p.1);
        let since = self.presses.iter().any(|p| self.asked < p.0 && p.0 <= now);
        self.asked = now;
        let at = self
            .presses
            .iter()
            .rev()
            .find(|p| p.0 <= now)
            .map_or((0.0, 1.0), |p| (p.2, p.3));
        (down, since, at.0, at.1)
    }
}

/// Sample times: every 40 ms, sometimes held up to 300 ms (the reader's OCR burst on a busy PC).
fn samples(rng: &mut Rng, secs: f64) -> Vec<f64> {
    let mut t = 0.0;
    let mut out = vec![];
    while t < secs {
        out.push(t);
        t += if rng.f() < 0.1 {
            rng.u(0.04, 0.3)
        } else {
            0.04
        };
    }
    out
}

#[test]
fn every_press_is_one_click_however_short() {
    let (mut seen, mut presses, mut old_seen) = (0, 0, 0);
    for seed in 1..=300u64 {
        let mut rng = Rng::new(seed);
        // a few presses of 8-250 ms, at least 60 ms apart
        let mut ps = vec![];
        let mut t = rng.u(0.0, 0.2);
        for _ in 0..8 {
            let len = if rng.f() < 0.5 {
                rng.u(0.008, 0.035)
            } else {
                rng.u(0.035, 0.25)
            };
            ps.push((t, t + len, 0.0, 0.5));
            t += len + rng.u(0.06, 0.5);
        }
        let secs = t + 0.5;
        let ts = samples(&mut rng, secs);
        // a press is one click when some sample interval holds its start; two starts in one interval are one click
        let mut want = 0;
        for w in ts.windows(2) {
            if ps.iter().any(|p| w[0] < p.0 && p.0 <= w[1]) {
                want += 1;
            }
        }
        let mut m = Mouse::new(ps.clone());
        let mut b = Button::default();
        let mut old_down = false;
        let (mut got, mut old) = (0, 0);
        for &now in &ts {
            let (down, since, _, _) = m.ask(now);
            if b.sample(down, since) {
                got += 1;
            }
            // what the desktop app did before: the "down now" bit alone
            if down && !old_down {
                old += 1;
            }
            old_down = down;
        }
        assert_eq!(
            got, want,
            "seed {seed}: {got} clicks seen for {want} presses"
        );
        seen += got;
        presses += want;
        old_seen += old;
    }
    println!("presses {presses}: seen {seen}, down bit alone {old_seen}");
    // the down bit alone loses quick presses (the Shaco miss); the button sees them all
    assert!(old_seen < presses);
}

#[test]
fn a_held_press_is_one_click() {
    let mut m = Mouse::new(vec![(0.1, 1.5, 0.0, 0.5)]);
    let mut b = Button::default();
    let n = (0..60)
        .filter(|&k| {
            let (d, s, _, _) = m.ask(k as f64 * 0.04);
            b.sample(d, s)
        })
        .count();
    assert_eq!(n, 1);
}

#[test]
fn the_down_bit_still_counts_when_the_other_is_taken() {
    // another program asked first and got the "pressed since" bit: the press still counts once, while held
    let mut b = Button::default();
    assert!(!b.sample(false, false));
    assert!(b.sample(true, false));
    assert!(!b.sample(true, false));
    assert!(!b.sample(false, false));
}

const W: f64 = 1920.0;
const XS: [f64; 3] = [0.3 * W, 0.5 * W, 0.7 * W];

/// Shaco 2026-11-27 round 3, as logged (probe/reads.jsonl): seconds from the screen's first read - 0.5, the ids read
/// and whether the read was a copy of League's covered window. Card 2's 1386 was rerolled to 2018; 2018 was taken
/// (post-game list), 1308 never was.
const SHACO_R3: &[(f64, &[i64], bool)] = &[
    (0.49, &[2157, 1308, 1386], false),
    (3.09, &[2157, 1308, 1386], true),
    (5.35, &[2157, 1308, 1386], false),
    (6.01, &[2157, 1308, 1386], true),
    (7.47, &[2157, 1308, 1386], false),
    (9.55, &[1057, 1308, 1386], false),
    (10.72, &[1057, 1308, 2018], false),
    (11.12, &[1057, 1308, 2018], true),
    (12.29, &[], true),
    (14.14, &[1057, 1308, 2018], false),
    (14.82, &[], false),
    (15.18, &[], true),
    (18.2, &[], false),
    (18.54, &[], true),
    (20.06, &[], false),
    (21.37, &[], true),
    (21.65, &[], false),
    (25.66, &[], true),
    (28.55, &[], false),
];

/// Replays the screen on a 10 ms clock: the tracker reads on its own schedule (the logged read in force at each
/// read), the button is sampled every 40 ms. `pick`: the press on 2018 that the old app's samples missed, or none.
fn shaco(rng: &mut Rng, pick: bool, since_bit: bool) -> Vec<i64> {
    // the logged clicks, to the second (+-0.5 s as in traces.rs), all on the reroll strip (71-72% down): card 0's
    // and card 2's rerolls, then card 1's, whose reroll never showed (the screen closed 0.6 s later)
    let low1 = rng.u(13.7, 14.3);
    let mut ps = vec![
        (rng.u(8.7, 9.5), XS[0], 0.714),
        (rng.u(9.7, 10.6), XS[2], 0.723),
        (low1, XS[1], 0.71),
    ];
    if pick {
        // between the last logged click and the first read with the cards gone
        ps.push((rng.u(low1 + 0.08, 14.75), XS[2], 0.40));
    }
    let presses: Vec<(f64, f64, f64, f64)> = ps
        .iter()
        .map(|&(at, x, y)| (at, at + rng.u(0.01, 0.03), x, y))
        .collect();
    let mut m = Mouse::new(presses);
    let mut b = Button::default();
    let mut t = Tracker::new();
    let (mut now, mut next_read, mut next_sample) = (0.0f64, 0.0f64, rng.u(0.0, 0.04));
    while now <= 45.0 {
        t.game(now, 30.0, 3, true, Headliner::None, W);
        if now >= next_sample {
            let (down, since, x, y) = m.ask(now);
            if b.sample(down, since && since_bit) {
                t.click(now, x, y);
            }
            next_sample = now + 0.04;
        }
        if now >= next_read {
            let cur = SHACO_R3.iter().rev().find(|r| r.0 <= now);
            let read = match cur {
                Some(&(_, ids, from_window)) => Some(Read {
                    xs: XS[..ids.len()].to_vec(),
                    ids: ids.to_vec(),
                    from_window,
                    blank: false,
                }),
                None => Some(Read::default()),
            };
            t.read(now, read, None);
            next_read = now + t.nap(now, true);
        }
        now += 0.01;
    }
    t.picked
}

#[test]
fn shaco_quick_pick_between_samples_is_seen() {
    let (mut right, mut runs) = (0, 0);
    for seed in 1..=200u64 {
        let mut rng = Rng::new(seed);
        let got = shaco(&mut rng, true, true);
        assert!(
            got.iter().all(|&a| a == 2018),
            "seed {seed}: marked {got:?}, the pick was 2018"
        );
        runs += 1;
        right += usize::from(got == [2018]);
    }
    println!("Shaco round 3 with the pick put back: right {right}/{runs}");
    assert_eq!(right, runs);
}

#[test]
fn shaco_without_the_since_bit_stays_unknown_never_wrong() {
    // the desktop app before: the down bit alone. Short presses fall between samples; whatever is seen, nothing
    // wrong is marked
    let mut unknown = 0;
    for seed in 1..=200u64 {
        let mut rng = Rng::new(seed);
        let got = shaco(&mut rng, true, false);
        assert!(
            got.iter().all(|&a| a == 2018),
            "seed {seed}: marked {got:?}"
        );
        unknown += usize::from(got.is_empty());
    }
    println!("Shaco round 3, down bit alone: unknown {unknown}/200");
    assert!(unknown > 0);
}

#[test]
fn shaco_as_logged_marks_nothing() {
    // the screen exactly as logged, with no pick click: the low click on 1308 is not a pick, so the round is unknown
    for seed in 1..=50u64 {
        let mut rng = Rng::new(seed);
        assert_eq!(
            shaco(&mut rng, false, true),
            Vec::<i64>::new(),
            "seed {seed}"
        );
    }
}
