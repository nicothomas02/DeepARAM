// Augment offers, read from the player's own screen.
//
// League's Live Client Data API doesn't report augments, so at the moments Mayhem offers them (the game's first
// 90 seconds, and after reaching level 7, 11 or 15) the app copies the middle of League's window, the way a
// screenshot or a stream does, and reads the card titles with Windows' built-in text recognition. It only reads
// what is already on the player's screen: nothing touches League's process or memory, nothing is drawn over the
// game, and the picture never leaves the PC (it isn't saved either). Only Borderless or Windowed mode can be
// copied; an exclusive Fullscreen game reads as black and is skipped.
//
// The offer goes to the companion window, which ranks the offered augments next to each other as it ranks the
// rest: it highlights, the player picks (Riot: apps may highlight decisions, not make them; no win rates).
use serde_json::Value;

/// One line of text the recognizer found, with its box (in screen pixels).
#[derive(Clone, Debug)]
pub struct Line {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Augment names for matching, from /data/augment-picks.json ("augments": {id: [name, rarity]}).
pub fn names_from(picks: &Value) -> Vec<(i64, String)> {
    picks
        .get("augments")
        .and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .filter_map(|(id, v)| Some((id.parse().ok()?, norm(v.get(0)?.as_str()?))))
                .filter(|(_, n): &(i64, String)| n.len() >= 3)
                .collect()
        })
        .unwrap_or_default()
}

/// Lower case letters and digits only, so "Can't Touch This" and an OCR'd "Can’t Touch This" compare equal.
pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != *cb)).min(row[j] + 1).min(cur + 1);
            prev = cur;
        }
    }
    row[b.len()]
}

/// The augment a piece of text names, allowing a few misread letters on longer names (none on short ones).
fn best_name(text: &str, names: &[(i64, String)]) -> Option<i64> {
    if text.len() < 3 {
        return None;
    }
    names
        .iter()
        .filter(|(_, n)| n.len().abs_diff(text.len()) <= 2)
        .map(|(id, n)| (id, n, distance(text, n)))
        .filter(|(_, n, d)| *d <= n.len() * 15 / 100)
        .min_by_key(|(_, _, d)| *d)
        .map(|(id, _, _)| *id)
}

/// The augments on offer, left to right, from the lines read off the screen.
#[cfg_attr(not(test), allow(dead_code))]
pub fn match_offer(lines: &[Line], names: &[(i64, String)]) -> Vec<i64> {
    match_offer_at(lines, names).into_iter().map(|(id, _)| id).collect()
}

/// The augments on offer, left to right, each with its card's centre across (in the lines' pixels). A title can
/// wrap onto two lines ("Courage of the / Colossus"), so two lines stacked on the same card are tried together first.
pub fn match_offer_at(lines: &[Line], names: &[(i64, String)]) -> Vec<(i64, f64)> {
    let mut found: Vec<(f64, f64, f64, i64)> = Vec::new(); // centre across, top, line height, augment
    let mut used = vec![false; lines.len()];
    for (i, a) in lines.iter().enumerate() {
        for (j, b) in lines.iter().enumerate() {
            if i == j || used[i] || used[j] {
                continue;
            }
            let (ca, cb) = (a.x + a.w / 2.0, b.x + b.w / 2.0);
            let gap = b.y - (a.y + a.h);
            if (ca - cb).abs() < a.w.max(b.w) / 2.0 && gap > -a.h * 0.3 && gap < a.h * 1.2 {
                if let Some(id) = best_name(&norm(&format!("{} {}", a.text, b.text)), names) {
                    found.push((ca.min(cb), a.y.min(b.y), a.h.max(b.h), id));
                    used[i] = true;
                    used[j] = true;
                }
            }
        }
    }
    for (i, l) in lines.iter().enumerate() {
        if !used[i] {
            if let Some(id) = best_name(&norm(&l.text), names) {
                found.push((l.x + l.w / 2.0, l.y, l.h, id));
            }
        }
    }
    let found = one_row(found);
    let mut cards: Vec<(i64, f64)> = Vec::new();
    for (x, _, _, id) in found {
        if !cards.iter().any(|(c, _)| *c == id) {
            cards.push((id, x));
        }
    }
    cards.truncate(4);
    cards
}

/// Whether cards sit evenly across the screen: the widest gap between neighbours is at most 1.15 times the narrowest.
pub fn evenly_spaced(cards: &[(i64, f64)]) -> bool {
    let gaps: Vec<f64> = cards.windows(2).map(|p| (p[1].1 - p[0].1).abs()).collect();
    let (lo, hi) = gaps.iter().fold((f64::MAX, 0.0f64), |(lo, hi), g| (lo.min(*g), hi.max(*g)));
    lo > 0.0 && hi <= lo * 1.15
}

/// Four cards are a real offer only when they're evenly spaced, as Maestro's four are (PC app 1.26.26): text
/// beside the cards can read as a fourth. Uneven fours keep the three that are evenly spaced, if one set is;
/// otherwise the read counts as no offer.
pub fn check_four(cards: Vec<(i64, f64)>) -> Vec<(i64, f64)> {
    if cards.len() != 4 || evenly_spaced(&cards) {
        return cards;
    }
    let threes: Vec<Vec<(i64, f64)>> = (0..4)
        .map(|skip| cards.iter().enumerate().filter(|(i, _)| *i != skip).map(|(_, c)| *c).collect::<Vec<_>>())
        .filter(|three| evenly_spaced(three))
        .collect();
    if threes.len() == 1 {
        threes.into_iter().next().unwrap()
    } else {
        Vec::new()
    }
}

/// Card titles sit side by side on one row (PC app 1.26.28): only the names in the biggest row are kept, so a list
/// read off another window (the companion, a browser, a chat app), stacked one name under another, is dropped.
/// Names count as one row when their tops are within a line height of each other. Left to right on return.
fn one_row(found: Vec<(f64, f64, f64, i64)>) -> Vec<(f64, f64, f64, i64)> {
    let mut best: Vec<(f64, f64, f64, i64)> = Vec::new();
    for a in &found {
        let row: Vec<_> = found.iter().filter(|b| (b.1 - a.1).abs() <= a.2.max(b.2)).copied().collect();
        if row.len() > best.len() {
            best = row;
        }
    }
    best.sort_by(|a, b| a.0.total_cmp(&b.0));
    best
}

/// The card a click across at `x` landed on: the nearest card centre, if the click is within half the gap between
/// cards of it (a click between or beside the cards, or on the reroll button's row below, is none of them).
#[cfg(test)] // clicks map to cards in the shared tracker now (crates/augtrack)
pub fn card_at(cards: &[(i64, f64)], x: f64) -> Option<i64> {
    if cards.len() < 2 {
        return None;
    }
    let gap = cards.windows(2).map(|p| (p[1].1 - p[0].1).abs()).fold(f64::MAX, f64::min);
    cards
        .iter()
        .map(|(id, cx)| (*id, (x - cx).abs()))
        .filter(|(_, d)| *d <= gap / 2.0)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(id, _)| id)
}

/// The part of the game's window the cards sit in: the middle 80% across, from 10% to 70% down.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn card_area(left: i32, top: i32, width: i32, height: i32) -> (i32, i32, i32, i32) {
    (left + width / 10, top + height / 10, width * 8 / 10, height * 6 / 10)
}

/// Halves a BGRA picture (each pixel the average of four), for screens wider than the recognizer reads well.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn halve(px: &[u8], w: usize, h: usize) -> (Vec<u8>, usize, usize) {
    let (nw, nh) = (w / 2, h / 2);
    let mut out = vec![0u8; nw * nh * 4];
    for y in 0..nh {
        for x in 0..nw {
            for c in 0..4 {
                let at = |dx: usize, dy: usize| u32::from(px[((2 * y + dy) * w + 2 * x + dx) * 4 + c]);
                out[(y * nw + x) * 4 + c] = ((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4) as u8;
            }
        }
    }
    (out, nw, nh)
}

/// An all-dark copy: the game is in exclusive Fullscreen (or still loading), so there's nothing to read.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_blank(px: &[u8]) -> bool {
    px.as_chunks::<4>().0.iter().step_by(97).all(|p| p[0] < 12 && p[1] < 12 && p[2] < 12)
}

/// Where League's game window is on screen: (left, top, width, height) of its picture, if it's open.
#[cfg(windows)]
pub fn game_window() -> Option<(i32, i32, i32, i32)> {
    win::game_window()
}

#[cfg(not(windows))]
pub fn game_window() -> Option<(i32, i32, i32, i32)> {
    None
}

/// Whether League's game window is the one in front (PC app 1.26.24). Cards are read, and clicks counted, only
/// then, so another window over the game (the companion, a browser) is never read as cards or taken as a pick.
#[cfg(windows)]
pub fn league_in_front() -> bool {
    win::league_in_front()
}

#[cfg(not(windows))]
pub fn league_in_front() -> bool {
    true
}

/// Reads the text in the card area of League's window. None when there's no game window to read, or another
/// window is in front of it.
pub fn read_screen() -> Option<Vec<Line>> {
    #[cfg(debug_assertions)]
    if let Some(lines) = fake_screen() {
        return Some(lines);
    }
    #[cfg(windows)]
    return win::read_screen();
    #[cfg(not(windows))]
    None
}

/// Debug builds only, for a test game: DEEPARAM_FAKE_SCREEN names a JSON file of [text, x] pairs, read each time
/// (an empty list or a missing file means no offer on screen).
#[cfg(debug_assertions)]
fn fake_screen() -> Option<Vec<Line>> {
    let path = std::env::var("DEEPARAM_FAKE_SCREEN").ok()?;
    let rows: Vec<(String, f64)> =
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    Some(rows.into_iter().map(|(text, x)| Line { text, x, y: 200.0, w: 180.0, h: 24.0 }).collect())
}

/// The left mouse button and where the pointer is on screen: read-only input state, the way any app can ask Windows
/// for it (nothing is hooked or sent to the game). Used while an offer is up, to see which card the player clicked,
/// so the companion learns the pick without a tap (Nico 2026-11-24: no taps in game). Gives (down now, pressed since
/// the last call, x, y): the second catches a click between two samples (augtrack::Button). Only the click watcher
/// may call it, since asking takes that bit; anything else that only needs the pointer uses `pointer_at`.
#[cfg(windows)]
pub fn mouse() -> Option<(bool, bool, i32, i32)> {
    win::mouse()
}

#[cfg(not(windows))]
pub fn mouse() -> Option<(bool, bool, i32, i32)> {
    None
}

/// Where the pointer is on screen, without asking about the button.
#[cfg(windows)]
pub fn pointer_at() -> Option<(i32, i32)> {
    win::pointer_at()
}

#[cfg(not(windows))]
pub fn pointer_at() -> Option<(i32, i32)> {
    None
}

/// The screen point is on League's window, with nothing over it there. A click there lands in League even while
/// another window is active: the click that brings League back from the companion is also the pick (Fiora
/// 2026-11-27 in the owner's old app: rounds 2-4 closed with no click seen while only the active window counted).
#[cfg(windows)]
pub fn point_on_league(x: i32, y: i32) -> bool {
    win::point_on_league(x, y)
}

#[cfg(not(windows))]
pub fn point_on_league(_x: i32, _y: i32) -> bool {
    false
}

/// Owner test recording only: League's whole game window as a PNG (one per augment offer), so the screens can
/// be played back later to test augment readers (ours and others) without a live game.
#[cfg(windows)]
pub fn save_game_frame(path: &std::path::Path) -> bool {
    win::save_game_frame(path)
}

#[cfg(not(windows))]
pub fn save_game_frame(_path: &std::path::Path) -> bool {
    false
}

/// Screen reading works on Windows only (its built-in text recognition), or with a test game's fake screen.
pub fn available() -> bool {
    #[cfg(debug_assertions)]
    if std::env::var_os("DEEPARAM_FAKE_SCREEN").is_some() {
        return true;
    }
    cfg!(windows)
}

#[cfg(windows)]
mod win {
    use std::cell::RefCell;

    use windows::{
        core::w,
        Globalization::Language,
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::DataWriter,
        Win32::{
            Foundation::{POINT, RECT},
            Graphics::Gdi::{
                BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
                GetDIBits, ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, SRCCOPY,
            },
            System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
                WindowsAndMessaging::{
                    FindWindowW, GetAncestor, GetClientRect, GetCursorPos, GetForegroundWindow, IsIconic,
                    WindowFromPoint, GA_ROOT,
                },
            },
        },
    };

    use super::{card_area, halve, is_blank, Line};

    /// The recognizer reads pictures up to about 2,600 pixels across; wider screens are halved first.
    const MAX_WIDTH: usize = 2000;

    thread_local! {
        static ENGINE: RefCell<Option<OcrEngine>> = const { RefCell::new(None) };
    }

    pub fn game_window() -> Option<(i32, i32, i32, i32)> {
        unsafe {
            let hwnd = FindWindowW(None, w!("League of Legends (TM) Client")).ok()?;
            if IsIconic(hwnd).as_bool() {
                return None;
            }
            let mut r = RECT::default();
            GetClientRect(hwnd, &mut r).ok()?;
            let mut at = POINT::default();
            if !ClientToScreen(hwnd, &mut at).as_bool() {
                return None;
            }
            (r.right > 0 && r.bottom > 0).then_some((at.x, at.y, r.right, r.bottom))
        }
    }

    pub fn league_in_front() -> bool {
        unsafe { FindWindowW(None, w!("League of Legends (TM) Client")).is_ok_and(|h| GetForegroundWindow() == h) }
    }

    pub fn mouse() -> Option<(bool, bool, i32, i32)> {
        unsafe {
            let mut at = POINT::default();
            GetCursorPos(&mut at).ok()?;
            // The high bit: the button is down right now. The low bit: it was pressed since the last call.
            let st = GetAsyncKeyState(i32::from(VK_LBUTTON.0)) as u16;
            Some((st & 0x8000 != 0, st & 1 != 0, at.x, at.y))
        }
    }

    pub fn pointer_at() -> Option<(i32, i32)> {
        unsafe {
            let mut at = POINT::default();
            GetCursorPos(&mut at).ok()?;
            Some((at.x, at.y))
        }
    }

    pub fn point_on_league(x: i32, y: i32) -> bool {
        unsafe {
            let Ok(league) = FindWindowW(None, w!("League of Legends (TM) Client")) else {
                return false;
            };
            let under = WindowFromPoint(POINT { x, y });
            !under.is_invalid() && (under == league || GetAncestor(under, GA_ROOT) == league)
        }
    }

    /// Copies a part of the screen as top-down BGRA pixels, as a screenshot does, scaled to `w` x `h` during the
    /// copy (Windows' own smooth scaling, so no pass over the pixels afterwards).
    fn capture(x: i32, y: i32, sw: i32, sh: i32, w: i32, h: i32) -> Option<Vec<u8>> {
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let copied = if (sw, sh) == (w, h) {
                BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY).is_ok()
            } else {
                SetStretchBltMode(mem, HALFTONE);
                let _ = SetBrushOrgEx(mem, 0, 0, None);
                StretchBlt(mem, 0, 0, w, h, Some(screen), x, y, sw, sh, SRCCOPY).as_bool()
            };
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut px = vec![0u8; (w * h * 4) as usize];
            SelectObject(mem, old);
            let rows = if copied {
                GetDIBits(mem, bmp, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS)
            } else {
                0
            };
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            (rows == h).then_some(px)
        }
    }

    pub fn save_game_frame(path: &std::path::Path) -> bool {
        let Some((x, y, w, h)) = game_window() else { return false };
        let Some(px) = capture(x, y, w, h, w, h) else { return false };
        let rgb: Vec<u8> = px.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
        let Ok(file) = std::fs::File::create(path) else { return false };
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w as u32, h as u32);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        enc.write_header().and_then(|mut wr| wr.write_image_data(&rgb)).is_ok()
    }

    fn engine() -> Option<OcrEngine> {
        ENGINE.with(|e| {
            if e.borrow().is_none() {
                unsafe {
                    let _ = RoInitialize(RO_INIT_MULTITHREADED);
                }
                // The site's augment names are English, so English text recognition first.
                let made = Language::CreateLanguage(&"en-US".into())
                    .and_then(|l| OcrEngine::TryCreateFromLanguage(&l))
                    .or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages())
                    .ok();
                *e.borrow_mut() = made;
            }
            e.borrow().clone()
        })
    }

    pub fn read_screen() -> Option<Vec<Line>> {
        if !league_in_front() {
            return None;
        }
        let (gx, gy, gw, gh) = game_window()?;
        let (x, y, w, h) = card_area(gx, gy, gw, gh);
        if w < 64 || h < 64 {
            return None;
        }
        // Wide screens are halved as they're copied (cheap); halving after the copy is the fallback.
        let (mut pw, mut ph) = (w, h);
        while pw as usize > MAX_WIDTH {
            (pw, ph) = (pw / 2, ph / 2);
        }
        let (mut px, mut pw, mut ph) = match capture(x, y, w, h, pw, ph) {
            Some(px) => (px, pw as usize, ph as usize),
            None => (capture(x, y, w, h, w, h)?, w as usize, h as usize),
        };
        if is_blank(&px) {
            return Some(Vec::new());
        }
        while pw > MAX_WIDTH {
            (px, pw, ph) = halve(&px, pw, ph);
        }
        // The lines come back in the copied picture's pixels; screen pixels are what a click is measured in.
        let scale = w as f64 / pw as f64;
        let engine = engine()?;
        let writer = DataWriter::new().ok()?;
        writer.WriteBytes(&px).ok()?;
        let buffer = writer.DetachBuffer().ok()?;
        let bitmap =
            SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, pw as i32, ph as i32).ok()?;
        let result = engine.RecognizeAsync(&bitmap).ok()?.join().ok()?;
        let mut lines = Vec::new();
        for line in result.Lines().ok()? {
            let text = line.Text().map(|t| t.to_string()).unwrap_or_default();
            let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for word in line.Words().ok()? {
                let r = word.BoundingRect().ok()?;
                x0 = x0.min(r.X as f64);
                y0 = y0.min(r.Y as f64);
                x1 = x1.max((r.X + r.Width) as f64);
                y1 = y1.max((r.Y + r.Height) as f64);
            }
            if x1 > x0 {
                lines.push(Line {
                    text,
                    x: x as f64 + x0 * scale,
                    y: y as f64 + y0 * scale,
                    w: (x1 - x0) * scale,
                    h: (y1 - y0) * scale,
                });
            }
        }
        Some(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn names() -> Vec<(i64, String)> {
        names_from(&json!({"augments": {
            "1011": ["Can't Touch This", "prismatic"],
            "1018": ["Courage of the Colossus", "prismatic"],
            "1022": ["Deft", "silver"],
            "1007": ["Blunt Force", "silver"],
            "1100": ["Ethereal Weapon", "gold"],
            "1101": ["Mystic Punch", "gold"],
        }}))
    }

    fn line(text: &str, x: f64, y: f64) -> Line {
        Line { text: text.into(), x, y, w: 180.0, h: 24.0 }
    }

    #[test]
    fn a_list_from_another_window_is_dropped() {
        // Three real cards on one row, plus a list of names stacked down the side (the companion, Chrome, Discord).
        let lines = vec![
            line("Can't Touch This", 100.0, 200.0),
            line("Ethereal Weapon", 500.0, 205.0),
            line("Mystic Punch", 900.0, 198.0),
            line("Deft", 1300.0, 400.0),
            line("Blunt Force", 1300.0, 440.0),
        ];
        assert_eq!(match_offer(&lines, &names()), vec![1011, 1100, 1101]);
        // A list alone never makes an offer of more than one name.
        let list =
            vec![line("Deft", 1300.0, 400.0), line("Blunt Force", 1300.0, 440.0), line("Mystic Punch", 1300.0, 480.0)];
        assert!(match_offer(&list, &names()).len() <= 1);
    }

    #[test]
    fn four_cards_must_be_evenly_spaced() {
        let even = vec![(1, 100.0), (2, 400.0), (3, 700.0), (4, 1000.0)];
        assert_eq!(check_four(even.clone()), even);
        // A stray fourth beside three even cards: the three stay.
        assert_eq!(
            check_four(vec![(9, 0.0), (1, 400.0), (2, 700.0), (3, 1000.0)]),
            vec![(1, 400.0), (2, 700.0), (3, 1000.0)]
        );
        // No even set: no offer.
        assert!(check_four(vec![(1, 100.0), (2, 150.0), (3, 700.0), (4, 1000.0)]).is_empty());
        // Three cards are never touched.
        assert_eq!(check_four(vec![(1, 100.0), (2, 150.0), (3, 900.0)]).len(), 3);
    }

    #[test]
    fn reads_three_cards_left_to_right() {
        let lines = vec![
            line("Mystic Punch", 900.0, 200.0),
            line("Your abilities heal you", 880.0, 300.0),
            line("Can’t Touch This", 100.0, 200.0),
            line("Ethereal Weapom", 500.0, 200.0), // one letter misread
        ];
        assert_eq!(match_offer(&lines, &names()), vec![1011, 1100, 1101]);
    }

    #[test]
    fn joins_a_title_wrapped_onto_two_lines() {
        let lines =
            vec![line("Courage of the", 100.0, 200.0), line("Colossus", 100.0, 226.0), line("Deft", 500.0, 200.0)];
        assert_eq!(match_offer(&lines, &names()), vec![1018, 1022]);
    }

    #[test]
    fn short_names_must_match_exactly() {
        assert_eq!(match_offer(&[line("Left", 100.0, 200.0)], &names()), Vec::<i64>::new());
        assert_eq!(match_offer(&[line("DEFT", 100.0, 200.0)], &names()), vec![1022]);
    }

    #[test]
    fn descriptions_do_not_match() {
        let lines = vec![line("Gain 20% attack speed and on-hit damage", 100.0, 200.0), line("Blunt", 400.0, 200.0)];
        assert!(match_offer(&lines, &names()).is_empty());
    }

    #[test]
    fn keeps_each_cards_centre() {
        let lines = vec![line("Deft", 500.0, 200.0), line("Mystic Punch", 900.0, 200.0)];
        assert_eq!(match_offer_at(&lines, &names()), vec![(1022, 590.0), (1101, 990.0)]);
    }

    #[test]
    fn a_click_lands_on_the_nearest_card() {
        let cards = [(1, 400.0), (2, 800.0), (3, 1200.0)];
        assert_eq!(card_at(&cards, 790.0), Some(2));
        assert_eq!(card_at(&cards, 1390.0), Some(3));
        assert_eq!(card_at(&cards, 1420.0), None); // past the last card
        assert_eq!(card_at(&cards, 150.0), None);
        assert_eq!(card_at(&[(1, 400.0)], 400.0), None); // one card read isn't an offer
    }

    #[test]
    fn card_area_is_the_middle_of_the_window() {
        assert_eq!(card_area(0, 0, 1920, 1080), (192, 108, 1536, 648));
        assert_eq!(card_area(-2560, 0, 2560, 1440), (-2304, 144, 2048, 864));
    }

    #[test]
    fn halving_averages_pixels() {
        let px = [0, 0, 0, 255, 40, 40, 40, 255, 80, 80, 80, 255, 120, 120, 120, 255];
        let (out, w, h) = halve(&px, 2, 2);
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![60, 60, 60, 255]);
    }

    #[test]
    fn black_pictures_are_blank() {
        assert!(is_blank(&[0u8; 4000]));
        let mut px = vec![0u8; 4000];
        px[0] = 200;
        assert!(!is_blank(&px));
    }
}
