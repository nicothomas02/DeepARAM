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

/// One line of text the recognizer found, with its box (in pixels of the copied picture).
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

/// The augments on offer, left to right, from the lines read off the screen. A title can wrap onto two lines
/// ("Courage of the / Colossus"), so two lines stacked on the same card are tried together first.
pub fn match_offer(lines: &[Line], names: &[(i64, String)]) -> Vec<i64> {
    let mut found: Vec<(f64, i64)> = Vec::new();
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
                    found.push((ca.min(cb), id));
                    used[i] = true;
                    used[j] = true;
                }
            }
        }
    }
    for (i, l) in lines.iter().enumerate() {
        if !used[i] {
            if let Some(id) = best_name(&norm(&l.text), names) {
                found.push((l.x + l.w / 2.0, id));
            }
        }
    }
    found.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut ids: Vec<i64> = Vec::new();
    for (_, id) in found {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids.truncate(4);
    ids
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

/// Reads the text in the card area of League's window. None when there's no game window to read.
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
                GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
            },
            System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
            UI::WindowsAndMessaging::{FindWindowW, GetClientRect, IsIconic},
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

    /// Copies a part of the screen as top-down BGRA pixels, as a screenshot does.
    fn capture(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY).is_ok();
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
        let (gx, gy, gw, gh) = game_window()?;
        let (x, y, w, h) = card_area(gx, gy, gw, gh);
        if w < 64 || h < 64 {
            return None;
        }
        let mut px = capture(x, y, w, h)?;
        if is_blank(&px) {
            return Some(Vec::new());
        }
        let (mut pw, mut ph) = (w as usize, h as usize);
        while pw > MAX_WIDTH {
            (px, pw, ph) = halve(&px, pw, ph);
        }
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
                lines.push(Line { text, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
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
