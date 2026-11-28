//! The augments you own, read off the HUD: League shows each taken augment's icon in a 3x2 grid bottom left, by the
//! champion portrait, all game (coordinator 2026-11-28: confirm picks from a second source when the card screen or a
//! reroll was missed). A port of the old PC app's live-window/hudmatch.py.
//!
//! Measured on NicoPC captures (riven/nami/qiyana 2026-11-28, archive/beta): slot centres x 0.1708 / 0.2068 / 0.2422 of
//! the width, y 0.9067 / 0.9633 of the height, a slot 0.0312 of the width; the middle 85% of the slot, 0.04 slot
//! widths up, lines up with the icon art. On 5 screenshots 12 of 13 filled slots rank their true icon first among all
//! 240, but by small gaps, so a slot's augment is only named from the round's offered cards (with what those have in
//! common taken out), and only when it beats the next card clearly. Empty slots score at most 0.48 against any icon,
//! filled ones at least 0.74, so the count of filled slots is reliable on its own.

// the screen copy is Windows only (augscan.rs); the matching is tested everywhere
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::HashMap;
use std::sync::OnceLock;

pub const SLOTS: [(f64, f64); 6] =
    [(0.1708, 0.9067), (0.2068, 0.9067), (0.2422, 0.9067), (0.1708, 0.9633), (0.2068, 0.9633), (0.2422, 0.9633)];
const SLOT: f64 = 0.0312;
const FRAC: f64 = 0.85;
const DY: f64 = -0.04;
const N: usize = 12;
/// A slot counts as filled when some icon matches it this well (empty <= 0.48, filled >= 0.74 on real captures).
const FILLED: f32 = 0.6;
/// Best minus second-best score needed to name a slot from the offered cards.
const CONFIDENT: f32 = 0.3;

/// (left, top, side) in window pixels of slot k's square, the part that is compared.
pub fn slot_square(w: i32, h: i32, k: usize) -> (i32, i32, i32) {
    let sl = SLOT * w as f64;
    let side = sl * FRAC;
    let (cx, cy) = (SLOTS[k].0 * w as f64, SLOTS[k].1 * h as f64 + DY * sl);
    ((cx - side / 2.0).round() as i32, (cy - side / 2.0).round() as i32, (side.round() as i32).max(N as i32))
}

fn unit(mut v: Vec<f32>) -> Vec<f32> {
    let m = v.iter().sum::<f32>() / v.len() as f32;
    v.iter_mut().for_each(|x| *x -= m);
    let s = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let s = if s > 0.0 { s } else { 1.0 };
    v.iter_mut().for_each(|x| *x /= s);
    v
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// A side x side top-down BGRA square -> the 12x12 RGB zero-mean unit vector it is compared as.
pub fn thumb(bgra: &[u8], side: usize) -> Vec<f32> {
    let step = side as f64 / N as f64;
    let mut out = Vec::with_capacity(N * N * 3);
    for j in 0..N {
        for i in 0..N {
            let (xa, ya) = ((i as f64 * step) as usize, (j as f64 * step) as usize);
            let xb = (((i + 1) as f64 * step) as usize).max(xa + 1).min(side);
            let yb = (((j + 1) as f64 * step) as usize).max(ya + 1).min(side);
            let (mut r, mut g, mut b, mut c) = (0u32, 0u32, 0u32, 0u32);
            for y in ya..yb {
                for x in xa..xb {
                    let p = (y * side + x) * 4;
                    if p + 2 < bgra.len() {
                        b += bgra[p] as u32;
                        g += bgra[p + 1] as u32;
                        r += bgra[p + 2] as u32;
                        c += 1;
                    }
                }
            }
            let c = c.max(1);
            // integer averages, as the icon thumbnails were made
            out.extend([(r / c) as f32, (g / c) as f32, (b / c) as f32]);
        }
    }
    unit(out)
}

fn b64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let (mut out, mut acc, mut bits) = (Vec::new(), 0u32, 0);
    for v in s.bytes().filter_map(val) {
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

/// Every augment's icon as a vector (built from the site's icons, middle 85%).
fn icons() -> &'static HashMap<i64, Vec<f32>> {
    static ICONS: OnceLock<HashMap<i64, Vec<f32>>> = OnceLock::new();
    ICONS.get_or_init(|| {
        let raw: HashMap<String, String> = serde_json::from_str(include_str!("hud_thumbs.json")).unwrap_or_default();
        raw.into_iter()
            .filter_map(|(id, s)| {
                let px = b64(&s);
                (px.len() == N * N * 3).then(|| (id.parse().ok(), unit(px.into_iter().map(f32::from).collect())))
            })
            .filter_map(|(id, v)| Some((id?, v)))
            .collect()
    })
}

/// Whether the slot holds an augment at all.
pub fn filled(v: &[f32]) -> bool {
    icons().values().any(|t| dot(v, t) >= FILLED)
}

/// [(score, id)] best first among the offered cards, after taking out what those cards' icons have in common.
pub fn rank(v: &[f32], cands: &[i64]) -> Vec<(f32, i64)> {
    let lib = icons();
    let mut ids: Vec<i64> = cands.iter().copied().filter(|a| lib.contains_key(a)).collect();
    ids.dedup();
    match ids.len() {
        0 => vec![],
        1 => vec![(dot(v, &lib[&ids[0]]), ids[0])],
        n => {
            let mut mean = vec![0f32; v.len()];
            for a in &ids {
                mean.iter_mut().zip(&lib[a]).for_each(|(m, x)| *m += x / n as f32);
            }
            let off = |x: &[f32]| {
                let d: Vec<f32> = x.iter().zip(&mean).map(|(a, b)| a - b).collect();
                let s = d.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
                d.into_iter().map(|x| x / s).collect::<Vec<f32>>()
            };
            let vs = off(v);
            let mut out: Vec<(f32, i64)> = ids.iter().map(|a| (dot(&vs, &off(&lib[a])), *a)).collect();
            out.sort_by(|a, b| b.0.total_cmp(&a.0));
            out
        }
    }
}

/// The offered card this slot shows, when it is clearly that one.
pub fn identify(v: &[f32], cands: &[i64]) -> Option<i64> {
    if !filled(v) {
        return None;
    }
    let r = rank(v, cands);
    match r.as_slice() {
        [(s, a)] => (*s >= FILLED).then_some(*a),
        [(s1, a), (s2, _), ..] => (s1 - s2 >= CONFIDENT).then_some(*a),
        _ => None,
    }
}

fn best_icon(v: &[f32]) -> Option<(f32, i64)> {
    icons().iter().map(|(a, t)| (dot(v, t), *a)).max_by(|a, b| a.0.total_cmp(&b.0))
}

/// How close to the best match over every icon the named card must come (true icons were within 0.02 on real
/// captures). A slot showing a card that wasn't among the round's cards (a reroll never read) is then still named,
/// wrongly, about 3 times in 100 (test below); the post-game list corrects it.
const NEAR_TOP: f32 = 0.025;

/// The newest augment in the HUD, (its slot, which of the round's cards it is), when the slot clearly shows one of
/// them. Slots fill left to right, top row first.
pub fn last_pick(slots: &[Vec<f32>], round: &[i64]) -> Option<(usize, i64)> {
    let n = slots.iter().take_while(|v| filled(v)).count();
    let v = slots.get(n.checked_sub(1)?)?;
    let a = identify(v, round)?;
    let (top, _) = best_icon(v)?;
    (dot(v, icons().get(&a)?) >= top - NEAR_TOP).then_some((n, a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<(Vec<i64>, Vec<Vec<f32>>)> {
        let raw: serde_json::Value = serde_json::from_str(include_str!("hud_fixture.json")).unwrap();
        raw.as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let truth = c["truth"].as_array().unwrap().iter().filter_map(|a| a.as_i64()).collect();
                let slots = c["slots"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| thumb(&b64(s["bgra"].as_str().unwrap()), s["side"].as_u64().unwrap() as usize))
                    .collect();
                (truth, slots)
            })
            .collect()
    }

    #[test]
    fn counts_filled_slots_on_real_captures() {
        assert!(icons().len() > 200);
        for (truth, slots) in fixture() {
            let n = slots.iter().take_while(|v| filled(v)).count();
            assert_eq!(n, truth.len());
            assert!(slots[n..].iter().all(|v| !filled(v)));
        }
    }

    #[test]
    fn names_the_taken_card_among_offers_and_never_a_wrong_one() {
        let ids: Vec<i64> = {
            let mut v: Vec<i64> = icons().keys().copied().collect();
            v.sort();
            v
        };
        let (mut right, mut total) = (0, 0);
        for (truth, slots) in fixture() {
            for (k, a) in truth.iter().enumerate() {
                // the taken card with two others, many different triples
                for i in (0..ids.len()).step_by(7) {
                    let (b, c) = (ids[i], ids[(i * 31 + 5) % ids.len()]);
                    if b == *a || c == *a || b == c {
                        continue;
                    }
                    total += 1;
                    match identify(&slots[k], &[b, *a, c]) {
                        Some(x) if x == *a => right += 1,
                        Some(x) => panic!("slot {k}: named {x}, truth {a}"),
                        None => {}
                    }
                }
            }
        }
        assert!(right * 10 >= total * 7, "{right}/{total}");
    }

    #[test]
    fn names_the_newest_pick_from_its_round() {
        let (truth, slots) = &fixture()[1];
        // the HUD with three picks: the third is the newest
        let three: Vec<Vec<f32>> = slots[..3].iter().cloned().chain(slots[4..].iter().cloned()).collect();
        assert_eq!(last_pick(&three, &[1057, truth[2], 1002]), Some((3, truth[2])));
        // an empty HUD names nothing
        assert_eq!(last_pick(&slots[4..], &[1001, 1004]), None);
        let (truth, slots) = &fixture()[2];
        assert_eq!(last_pick(slots, &[1048, truth[2], 1058]), Some((3, truth[2])));
        // Qiyana 2026-11-28, level 7: the screen read late as Jeweled Gauntlet / Back To Basics, then a reroll; the
        // pick was never marked. Its HUD (two picks then) names Back To Basics
        let (truth, slots) = &fixture()[0];
        let two: Vec<Vec<f32>> = slots[..2].iter().cloned().chain(slots[3..].iter().cloned()).collect();
        assert_eq!(last_pick(&two, &[1048, 1004, 1058]), Some((2, truth[1])));
    }

    #[test]
    fn rarely_names_a_card_the_slot_does_not_show() {
        let mut ids: Vec<i64> = icons().keys().copied().collect();
        ids.sort();
        let (mut named, mut total) = (0, 0);
        for (truth, slots) in fixture() {
            for k in 0..truth.len() {
                for i in (0..ids.len()).step_by(3) {
                    let round: Vec<i64> = [i, i * 7 + 1, i * 13 + 2].iter().map(|j| ids[j % ids.len()]).collect();
                    if round.contains(&truth[k]) {
                        continue;
                    }
                    total += 1;
                    named += usize::from(last_pick(&slots[..=k], &round).is_some());
                }
            }
        }
        eprintln!("wrongly named {named}/{total}");
        assert!(named * 25 <= total, "{named}/{total}");
    }

    #[test]
    fn slot_squares_match_the_captures() {
        let raw: serde_json::Value = serde_json::from_str(include_str!("hud_fixture.json")).unwrap();
        for c in raw.as_array().unwrap() {
            let (w, h) = (c["rect"][0].as_i64().unwrap() as i32, c["rect"][1].as_i64().unwrap() as i32);
            for (k, s) in c["slots"].as_array().unwrap().iter().enumerate() {
                assert_eq!(slot_square(w, h, k).2 as u64, s["side"].as_u64().unwrap());
            }
        }
    }
}
