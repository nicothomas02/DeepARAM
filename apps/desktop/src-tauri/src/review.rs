// After-game review: the team's predicted chance to win over the game, its turning points, and from when a
// surrender would have paid off. Shown only once the game is over (Riot's rules: no conclusions drawn for the
// player during a game), in its own window.
//
// The overlay samples what League's Live Client Data API reports every SAMPLE_EVERY seconds of game time (team
// kills, turrets and inhibitors destroyed, champion levels) plus each champion's expected win rate from the site's
// /data/team-fit.json. The chance is a logistic model fitted on archived Mayhem games with full timelines and
// checked on held-out games (68% right at minute 8, 77% at 14, 81% from 20). It's a prediction, and the window says so.
//
// Plain std, no app types, so `rustc --test src/review.rs` checks it on its own.

/// x = [1, comp*10, kills/5, towers, levels/5, kills/5*min/10, towers*min/10, levels/5*min/10]
pub const WEIGHTS: [f64; 8] = [0.0, 0.32, 0.184, 0.465, 0.254, -0.056, -0.019, 0.285];
/// Minute -> the chance below which a surrender saves time (a new game is worth about 1.4 wins an hour).
pub const FF_LINE: [(f64, f64); 5] = [(8.0, 0.20), (10.0, 0.16), (12.0, 0.12), (14.0, 0.09), (16.0, 0.055)];
/// Under the line this long before it counts, so one lost fight doesn't.
pub const FF_HOLD: f64 = 60.0;
pub const SAMPLE_EVERY: f64 = 15.0;
/// A turning point is a swing of at least this much within TURN_WINDOW seconds.
const TURN_MIN: f64 = 0.10;
const TURN_WINDOW: f64 = 90.0;
const TURNS: usize = 3;

/// One moment of the game, ally minus enemy.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub t: f64,
    pub kills: f64,
    pub towers: f64,
    pub levels: f64,
    /// Sum of allies' expected win rates minus 50%, minus the same for the enemies.
    pub comp: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    pub from: f64,
    pub to: f64,
    pub before: f64,
    pub after: f64,
    pub kills: f64,
    pub towers: f64,
}

#[derive(Debug)]
pub struct Review {
    pub points: Vec<(f64, f64)>,
    pub turns: Vec<Turn>,
    /// Game second from which a surrender would have paid off, if it ever did.
    pub ff_from: Option<f64>,
}

pub fn chance(s: &Sample) -> f64 {
    let m = s.t / 60.0;
    let (k, tw, lv) = (s.kills / 5.0, s.towers, s.levels / 5.0);
    let x = [1.0, s.comp * 10.0, k, tw, lv, k * m / 10.0, tw * m / 10.0, lv * m / 10.0];
    let z: f64 = WEIGHTS.iter().zip(x).map(|(w, v)| w * v).sum();
    1.0 / (1.0 + (-z.clamp(-30.0, 30.0)).exp())
}

pub fn ff_line(minute: f64) -> Option<f64> {
    if minute < FF_LINE[0].0 {
        return None;
    }
    for w in FF_LINE.windows(2) {
        let ((m0, p0), (m1, p1)) = (w[0], w[1]);
        if minute <= m1 {
            return Some(p0 + (p1 - p0) * (minute - m0) / (m1 - m0));
        }
    }
    Some(FF_LINE[FF_LINE.len() - 1].1)
}

/// Which team destroyed a structure, from its name: "Turret_T1_..." and "Barracks_T1_..." belong to ORDER, so
/// destroying one is a point for CHAOS.
pub fn structure_owner(name: &str) -> Option<&'static str> {
    if name.contains("_T1_") || name.ends_with("_T1") {
        Some("ORDER")
    } else if name.contains("_T2_") || name.ends_with("_T2") {
        Some("CHAOS")
    } else {
        None
    }
}

pub fn analyse(samples: &[Sample]) -> Review {
    let points: Vec<(f64, f64)> = samples.iter().map(|s| (s.t, chance(s))).collect();
    // Biggest swings first, never two that overlap.
    let mut swings = Vec::new();
    for i in 0..samples.len() {
        for j in i + 1..samples.len() {
            if samples[j].t - samples[i].t > TURN_WINDOW {
                break;
            }
            let d = points[j].1 - points[i].1;
            if d.abs() >= TURN_MIN {
                swings.push((d.abs(), i, j));
            }
        }
    }
    swings.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut turns: Vec<Turn> = Vec::new();
    for (_, i, j) in swings {
        if turns.len() == TURNS {
            break;
        }
        let (from, to) = (samples[i].t, samples[j].t);
        if turns.iter().any(|t| from < t.to && to > t.from) {
            continue;
        }
        turns.push(Turn {
            from,
            to,
            before: points[i].1,
            after: points[j].1,
            kills: samples[j].kills - samples[i].kills,
            towers: samples[j].towers - samples[i].towers,
        });
    }
    turns.sort_by(|a, b| a.from.total_cmp(&b.from));
    let mut under: Option<f64> = None;
    let mut ff_from = None;
    for &(t, p) in &points {
        match ff_line(t / 60.0) {
            Some(line) if p < line => {
                let since = *under.get_or_insert(t);
                if t - since >= FF_HOLD {
                    ff_from = Some(since);
                    break;
                }
            }
            _ => under = None,
        }
    }
    Review { points, turns, ff_from }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(t: f64, kills: f64, towers: f64, levels: f64) -> Sample {
        Sample { t, kills, towers, levels, comp: 0.0 }
    }

    #[test]
    fn even_game_is_a_coin_flip() {
        assert!((chance(&s(600.0, 0.0, 0.0, 0.0)) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn leads_raise_the_chance_and_mirror() {
        let ahead = chance(&s(720.0, 9.0, 1.0, 5.0));
        let behind = chance(&s(720.0, -9.0, -1.0, -5.0));
        assert!(ahead > 0.7 && behind < 0.3);
        assert!((ahead + behind - 1.0).abs() < 1e-12);
    }

    #[test]
    fn surrender_line() {
        assert_eq!(ff_line(5.0), None);
        assert_eq!(ff_line(8.0), Some(0.20));
        assert!((ff_line(11.0).unwrap() - 0.14).abs() < 1e-12);
        assert_eq!(ff_line(30.0), Some(0.055));
    }

    #[test]
    fn structures_by_name() {
        assert_eq!(structure_owner("Turret_T1_C_05_A"), Some("ORDER"));
        assert_eq!(structure_owner("Barracks_T2_L1"), Some("CHAOS"));
        assert_eq!(structure_owner("Nexus"), None);
    }

    #[test]
    fn finds_the_turning_point_and_the_surrender_minute() {
        let mut game = vec![];
        let mut t = 0.0;
        while t <= 900.0 {
            // Even until minute 9, then a lost fight (−8 kills, −1 tower), then hopeless.
            let (k, tw, lv) = if t < 540.0 {
                (0.0, 0.0, 0.0)
            } else if t < 600.0 {
                (-8.0, -1.0, -3.0)
            } else {
                (-25.0, -3.0, -12.0)
            };
            game.push(s(t, k, tw, lv));
            t += SAMPLE_EVERY;
        }
        let r = analyse(&game);
        assert_eq!(r.points.len(), game.len());
        assert!(!r.turns.is_empty());
        assert!(r.turns[0].after < r.turns[0].before);
        let ff = r.ff_from.expect("a surrender would have paid off");
        assert!((480.0..=660.0).contains(&ff));
    }
}
