// The companion on a phone (owner's PC only, Nico 2026-11-27): the same companion page, served on the home
// network so a phone's browser can show it during games. Off unless a file named `phone-companion` is in the app's
// data folder; its first line is a private token that every address must carry, so other devices on the network
// can't open it. Nothing is served to the internet: the address is the PC's own network address.
//
// The page is the app's own companion.html (from the app's built-in files) plus a few lines that ask the app for
// what the companion window was told (the same scripts, in order) about once a second.
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde_json::json;
use tauri::{AppHandle, Manager};

pub const PORT: u16 = 8792;

/// What the companion window was told: the last full view, and the small updates since (offers, picks, results).
#[derive(Default)]
struct Mirror {
    seq: u64,
    base: Option<(u64, String)>,
    tail: Vec<(u64, String)>,
}

static MIRROR: Mutex<Mirror> = Mutex::new(Mirror { seq: 0, base: None, tail: Vec::new() });

/// Owner test recording (the `record-offers` file): every script the companion was told, timed, in
/// offers/screens.jsonl, so a game can be played back later through the real companion page.
static RECORD: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);

fn record(kind: &str, script: &str) {
    let Some(path) = RECORD.lock().unwrap().clone() else { return };
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", json!({"t": ms, "kind": kind, "js": script}));
    }
}

/// The game just ended (owner recording): keeps its end-of-game stats beside the recording and notes its id, so
/// the next champion select files the whole game (including what the review showed) under offers/<gameId>/.
pub fn game_ended(app: &AppHandle, eog: &serde_json::Value) {
    let Some(dir) = recording_dir(app) else { return };
    let Some(id) = eog.get("gameId").and_then(serde_json::Value::as_i64) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("eog.json"), eog.to_string());
    let _ = std::fs::write(dir.join("last-game.txt"), id.to_string());
}

/// A new champion select: the last game's files (offers.jsonl, screens.jsonl, the offer pictures, eog.json) move
/// into offers/<gameId>/, where the nightly sync copies them to the private archive (archive/beta/<gameId>/).
pub fn file_last_game(app: &AppHandle) {
    let Some(dir) = recording_dir(app) else { return };
    let Some(id) = std::fs::read_to_string(dir.join("last-game.txt")).ok().and_then(|t| t.trim().parse::<i64>().ok())
    else {
        return;
    };
    let to = dir.join(id.to_string());
    if std::fs::create_dir_all(&to).is_err() {
        return;
    }
    // The recorder appends to these: take them out of its way first.
    let _guard = RECORD.lock().unwrap();
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let keep = name == "offers.jsonl"
            || name == "inputs.jsonl"
            || name == "screens.jsonl"
            || name == "eog.json"
            || name.ends_with(".png");
        if keep && e.path().is_file() {
            let _ = std::fs::rename(e.path(), to.join(&name));
        }
    }
    let _ = std::fs::remove_file(dir.join("last-game.txt"));
}

fn recording_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let base = app.path().app_data_dir().ok()?;
    base.join("record-offers").exists().then(|| base.join("offers"))
}

/// A whole new view (champion select, the game, the review): replaces everything before it.
pub fn full(script: &str) {
    record("full", script);
    let mut m = MIRROR.lock().unwrap();
    m.seq += 1;
    m.base = Some((m.seq, script.to_owned()));
    m.tail.clear();
}

/// A small update on top of the view (an offer read, a pick marked, the game's result).
pub fn push(script: &str) {
    record("push", script);
    let mut m = MIRROR.lock().unwrap();
    m.seq += 1;
    let seq = m.seq;
    m.tail.push((seq, script.to_owned()));
    if m.tail.len() > 200 {
        m.tail.remove(0);
    }
}

/// The scripts a page that has seen up to `after` still needs, and the newest number.
fn since(after: u64) -> (u64, Vec<String>) {
    let m = MIRROR.lock().unwrap();
    let mut out = Vec::new();
    let fresh = m.base.as_ref().is_some_and(|(s, _)| *s > after);
    if fresh {
        out.push(m.base.as_ref().unwrap().1.clone());
    }
    let from = if fresh { m.base.as_ref().unwrap().0 } else { after };
    out.extend(m.tail.iter().filter(|(s, _)| *s > from).map(|(_, x)| x.clone()));
    (m.seq, out)
}

/// The PC's address on the home network (no packet is sent: connecting a UDP socket only picks the route).
fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// Polls the app about once a second and runs what the companion window was told.
const SHIM: &str = r#"<script>
(async () => {
  let n = 0;
  for (;;) {
    try {
      const j = await (await fetch("events?after=" + n, { cache: "no-store" })).json();
      for (const s of j.scripts) { try { (0, eval)(s); } catch (e) { console.error(e); } }
      n = j.seq;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
</script>"#;

fn reply(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn serve(app: &AppHandle, mut stream: TcpStream, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }
    let path = line.split_whitespace().nth(1).unwrap_or("/");
    let Some(rest) = path.strip_prefix(&format!("/{token}/")) else {
        return reply(&mut stream, "404 Not Found", "text/plain", b"not found");
    };
    let (file, query) = rest.split_once('?').unwrap_or((rest, ""));
    if file == "events" {
        let after = query.strip_prefix("after=").and_then(|n| n.parse().ok()).unwrap_or(0);
        let (seq, scripts) = since(after);
        let body = json!({"seq": seq, "scripts": scripts}).to_string();
        return reply(&mut stream, "200 OK", "application/json", body.as_bytes());
    }
    let file = if file.is_empty() { "companion.html" } else { file };
    let Some(asset) = app.asset_resolver().get(file.to_owned()) else {
        return reply(&mut stream, "404 Not Found", "text/plain", b"not found");
    };
    let mut bytes = asset.bytes().to_vec();
    if file == "companion.html" {
        let page = String::from_utf8_lossy(&bytes).replacen("</body>", &format!("{SHIM}</body>"), 1);
        bytes = page.into_bytes();
    }
    reply(&mut stream, "200 OK", asset.mime_type(), &bytes);
}

/// Starts serving when the owner turned it on (the `phone-companion` file), and writes the address to
/// `phone-url.txt` beside it.
pub fn start(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    if dir.join("record-offers").exists() {
        let _ = std::fs::create_dir_all(dir.join("offers"));
        *RECORD.lock().unwrap() = Some(dir.join("offers").join("screens.jsonl"));
    }
    let Ok(text) = std::fs::read_to_string(dir.join("phone-companion")) else { return };
    let token: String = text.lines().next().unwrap_or("").trim().chars().filter(char::is_ascii_alphanumeric).collect();
    if token.len() < 8 {
        return;
    }
    let Ok(listener) = TcpListener::bind(("0.0.0.0", PORT)) else { return };
    if let Some(ip) = lan_ip() {
        let _ = std::fs::write(dir.join("phone-url.txt"), format!("http://{ip}:{PORT}/{token}/\n"));
    }
    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = token.clone();
            thread::spawn(move || serve(&app, stream, &token));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_page_gets_the_view_then_the_updates() {
        full("view(1)");
        push("offer(1)");
        push("taken(1)");
        let (n, s) = since(0);
        assert_eq!(s, vec!["view(1)", "offer(1)", "taken(1)"]);
        push("offer(2)");
        assert_eq!(since(n).1, vec!["offer(2)"]);
        full("view(2)");
        assert_eq!(since(n).1, vec!["view(2)"]);
    }
}
