//! The HUD check (the app's hud.rs names the newest augment icon among the round's cards): a missed pick is added,
//! a wrong mark of the same round is replaced, anything else is left alone. Qiyana 2026-11-28 (level 7: the screen
//! was read late and without its middle card, the pick never marked; Back To Basics showed in the HUD).
use augtrack::{Event, Headliner, Read, Tracker};

const JEWELED: i64 = 1048;
const BASICS: i64 = 1004;
const OTHER: i64 = 1058;

fn screen(t: &mut Tracker, now: f64, ids: &[i64]) {
    let xs = [550.5, 959.5, 1368.5];
    let read = Read {
        ids: ids.to_vec(),
        xs: xs[..ids.len()].to_vec(),
        from_window: false,
        blank: false,
    };
    t.read(now, Some(read), None);
}

fn round(t: &mut Tracker) {
    t.game(0.0, 340.0, 9, true, Headliner::None, 1920.0);
    for i in 0..10 {
        screen(t, 1.0 + i as f64 * 0.3, &[JEWELED, BASICS]);
    }
    for i in 0..10 {
        screen(t, 4.0 + i as f64 * 0.3, &[OTHER, BASICS]);
    }
    for i in 0..30 {
        screen(t, 8.0 + i as f64 * 0.3, &[]);
    }
    t.game(20.0, 360.0, 9, true, Headliner::None, 1920.0);
}

#[test]
fn qiyana_missed_pick_comes_from_the_hud() {
    let mut t = Tracker::new();
    round(&mut t);
    assert!(t.picked.is_empty());
    assert!(t.round_cards().contains(&BASICS));
    t.events.clear();
    t.hud(1, BASICS);
    assert_eq!(t.picked, vec![BASICS]);
    assert_eq!(
        t.events,
        vec![Event::Hud {
            pick: BASICS,
            replaced: None
        }]
    );
    // seen again: nothing new
    t.hud(1, BASICS);
    assert_eq!(t.events.len(), 1);
}

#[test]
fn a_wrong_mark_of_the_round_is_replaced() {
    let mut t = Tracker::new();
    round(&mut t);
    t.restore(vec![3051, JEWELED], 2);
    t.events.clear();
    t.hud(2, BASICS);
    assert_eq!(t.picked, vec![3051, BASICS]);
    assert_eq!(
        t.events,
        vec![Event::Hud {
            pick: BASICS,
            replaced: Some(JEWELED)
        }]
    );
}

#[test]
fn cards_not_offered_this_round_change_nothing() {
    let mut t = Tracker::new();
    round(&mut t);
    t.hud(1, 1007);
    assert!(t.picked.is_empty());
    // all picks known and none of this round: left alone
    t.restore(vec![3051], 1);
    t.hud(1, BASICS);
    assert_eq!(t.picked, vec![3051]);
    // the round is long over
    let mut t = Tracker::new();
    round(&mut t);
    t.game(200.0, 540.0, 10, false, Headliner::None, 1920.0);
    t.hud(1, BASICS);
    assert!(t.picked.is_empty());
}

#[test]
fn an_earlier_rounds_pick_is_never_replaced() {
    let mut t = Tracker::new();
    round(&mut t);
    // Basics was the earlier round's pick and shows on this round's screen again; the newest pick is another card
    t.restore(vec![JEWELED, 3086], 2);
    t.hud(2, OTHER);
    assert_eq!(t.picked, vec![JEWELED, 3086]);
}
