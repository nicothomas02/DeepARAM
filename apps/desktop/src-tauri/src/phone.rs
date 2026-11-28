// The companion on a phone (owner's PC only, Nico 2026-11-27): the same companion page, served on the home
// network so a phone's browser can show it during games (his iPhone Duo, open, on its right half). Off unless a
// file named `phone-companion` is in the app's data folder; its first line is a private token that every address
// must carry, so other devices on the network can't open it. Nothing is served to the internet: the address is the
// PC's own network address.
//
// The page is the app's own companion.html (from the app's built-in files, so the same engine and the same views as
// the window) plus a few lines that ask the app for what the window was told, in order. The phone waits on the
// app (long poll), so an offer or a pick shows the moment the window gets it.
//
// The phone has to end up where the window is: picks, offers seen and rerolled, items bought all change what the
// page recommends, and they arrive as small updates between whole views. So the app keeps every script of the game
// since champion select, in order (only a whole view right after another whole view replaces it), and a page that
// opens or reloads mid-game replays them all. The window's settings (Feeling lucky, bracket, owned only, this patch
// only), the Flash key and the "your record" nudge reach the phone too.
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{Condvar, Mutex},
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub const PORT: u16 = 8792;

/// How long a phone's request waits for something new before the app answers "nothing yet".
const WAIT: Duration = Duration::from_secs(10);

/// More than any game sends (a long game is a few hundred whole views and updates); past it, the oldest go.
const KEEP: usize = 3000;

/// What the companion window was told this game (since champion select), in order: (number, whole view?, script).
struct Mirror {
    seq: u64,
    log: Vec<(u64, bool, String)>,
    /// The window's settings as it last reported them (JSON), for the phone to use the same.
    prefs: String,
}

static MIRROR: Mutex<Mirror> = Mutex::new(Mirror { seq: 0, log: Vec::new(), prefs: String::new() });
static CHANGED: Condvar = Condvar::new();

/// This run of the app: a phone that sees a different one (the app restarted or updated) reloads the page.
fn instance() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| {
        let ns = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        format!("{:x}", ns ^ u128::from(std::process::id()))
    })
}

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
            || name == "shown.jsonl"
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

/// A whole new view (champion select, the game, the review). A new champion select starts a new game's list.
pub fn full(script: &str) {
    record("full", script);
    let mut m = MIRROR.lock().unwrap();
    m.seq += 1;
    let seq = m.seq;
    let pick = script.starts_with("window.showPick(");
    let in_pick = m.log.iter().rev().find(|e| e.1).is_some_and(|e| e.2.starts_with("window.showPick("));
    if pick && !in_pick {
        m.log.clear();
    } else if m.log.last().is_some_and(|e| e.1 && same_moment(&e.2, script)) {
        // The same view again with nothing in between that the page keeps track of: the newer one says all the older
        // one did. (A different view stays: the review's recap reads the game's last update.)
        m.log.pop();
    }
    m.log.push((seq, true, script.to_owned()));
    trim(&mut m);
    CHANGED.notify_all();
}

/// A small update on top of the view (an offer read, a pick marked, the game's result).
pub fn push(script: &str) {
    record("push", script);
    let mut m = MIRROR.lock().unwrap();
    m.seq += 1;
    let seq = m.seq;
    m.log.push((seq, false, script.to_owned()));
    trim(&mut m);
    CHANGED.notify_all();
}

/// Which view a script shows ("window.showGame" of "window.showGame({...})").
fn view_of(script: &str) -> &str {
    script.split('(').next().unwrap_or(script)
}

/// Whether a whole view can stand in for the one before it. Game updates only when nothing the page keeps track of
/// changed in between: level (augment levels), dead or alive (a screen owed comes at the next death), items (what
/// you bought, for the review) and the offer on screen.
fn same_moment(old: &str, new: &str) -> bool {
    if view_of(old) != view_of(new) {
        return false;
    }
    let key = |s: &str| -> Option<Value> {
        let v: Value = serde_json::from_str(s.strip_prefix("window.showGame(")?.strip_suffix(')')?).ok()?;
        Some(json!([v["champ"], v["level"], v["dead"], v["items"], v["offer"]]))
    };
    view_of(new) != "window.showGame" || key(old).is_some_and(|k| Some(k) == key(new))
}

fn trim(m: &mut Mirror) {
    if m.log.len() > KEEP {
        let over = m.log.len() - KEEP;
        m.log.drain(..over);
    }
}

/// The window's settings changed (or it just opened): the phone takes the same.
#[tauri::command]
pub fn companion_prefs(prefs: Value) {
    let text = prefs.to_string();
    let mut m = MIRROR.lock().unwrap();
    if m.prefs != text {
        m.prefs = text;
        m.seq += 1;
        CHANGED.notify_all();
    }
}

/// The scripts a page that has run everything up to `after` still needs, in order, and the newest number. A page
/// that has run nothing (or an older game) gets the whole game so far.
fn since(after: u64) -> (u64, Vec<String>) {
    let m = MIRROR.lock().unwrap();
    (m.seq, m.log.iter().filter(|e| e.0 > after).map(|e| e.2.clone()).collect())
}

/// Waits (up to `wait`) until there's something newer than `after`, then answers as `since` does, with the settings.
fn wait_since(after: u64, wait: Duration) -> Value {
    {
        let m = MIRROR.lock().unwrap();
        let _ = CHANGED.wait_timeout_while(m, wait, |m| m.seq <= after).unwrap();
    }
    let (seq, scripts) = since(after);
    let prefs = MIRROR.lock().unwrap().prefs.clone();
    json!({ "id": instance(), "seq": seq, "scripts": scripts, "prefs": prefs })
}

/// The PC's address on the home network (no packet is sent: connecting a UDP socket only picks the route).
fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// Added to the page's head on the phone: Home Screen app look (full screen, the app's icon), a few phone-only
/// styles, and how the page asks the app for what it would get from the window's app calls.
const HEAD: &str = r##"<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="DeepARAM">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="#090b0f">
<link rel="apple-touch-icon" href="icon.png">
<link rel="manifest" href="manifest.webmanifest">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body { padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); -webkit-tap-highlight-color: transparent; }
  /* Short screens (the folded phone on its side): a slim header, so the augments and items stay in view. */
  @media (max-height: 520px) { .hero { min-height: 0 !important; padding: 8px 14px !important; } .hero > img { width: 36px !important; height: 36px !important; } .hero .title { font-size: 20px !important; } }
  #phoneLink { position: fixed; top: max(6px, env(safe-area-inset-top)); right: max(6px, env(safe-area-inset-right)); z-index: 60; padding: 2px 8px; border-radius: 99px; font: 600 11px/1.6 system-ui, sans-serif; background: #f0776f; color: #090b0f; }
  #phoneLink[hidden] { display: none; }
  #phoneApp { display: block; margin: 24px auto 0; width: fit-content; padding: 10px 16px; border-radius: 10px; background: #181d26; color: #5cc0ff; font: 600 15px system-ui, sans-serif; text-decoration: none; }
  body:not(.idle) #phoneApp { display: none; }
</style>
<script>
  window.PHONE = true;
  window.phoneInvoke = (cmd) => fetch("invoke/" + cmd, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
</script>"##;

/// Added to the end of the page on the phone: waits on the app for what the window was told and runs it, in order.
/// A different app run (restart, update) reloads the page; no answer shows "Offline" until the app answers again.
const SHIM: &str = r##"<script>
// Inside the iPhone app (apps/ios Companion.swift): after each update, what's on screen in a few words, so the app
// can come to the front in champion select and games and keep a Live Activity. In Safari: a link that opens this
// page in the app (shown before games only).
const toApp = window.webkit?.messageHandlers?.deeparam;
const told = () => { if (toApp && window.companionState) try { toApp.postMessage(window.companionState()); } catch (e) {} };
// Again a moment later: the item path finishes drawing after its data loads.
const tell = () => { told(); setTimeout(told, 1500); };
if (!toApp) {
  const a = document.createElement("a");
  a.id = "phoneApp"; a.textContent = "Open in the DeepARAM app";
  a.href = "deeparam://companion?url=" + encodeURIComponent(location.href.split("#")[0].split("?")[0]);
  document.body.append(a);
}
(async () => {
  const link = document.createElement("div");
  link.id = "phoneLink"; link.textContent = "Offline"; link.hidden = true;
  document.body.append(link);
  let n = 0, id = null, prefs = "", fails = 0;
  for (;;) {
    const stop = new AbortController();
    // The app answers within 10 s even with nothing new, so 15 s without an answer means the PC is out of reach.
    const timer = setTimeout(() => stop.abort(), 15000);
    try {
      const r = await fetch("events?after=" + n, { cache: "no-store", signal: stop.signal });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (id && j.id !== id) { location.reload(); return; }
      id = j.id;
      if (j.prefs && j.prefs !== prefs) { prefs = j.prefs; try { window.applyPrefs?.(JSON.parse(prefs)); } catch (e) { console.error(e); } }
      // In order, each one finished before the next (champion select's view loads data first, and a page opening
      // mid-game must not have it land on top of the game).
      for (const s of j.scripts) {
        try {
          const r = (0, eval)(s);
          if (r && typeof r.then === "function") await Promise.race([r.catch(() => {}), new Promise((t) => setTimeout(t, 5000))]);
        } catch (e) { console.error(e); }
      }
      n = j.seq; fails = 0; link.hidden = true;
      tell();
    } catch (e) {
      fails++;
      link.hidden = false;
      await new Promise((r) => setTimeout(r, Math.min(4000, 500 * fails)));
    } finally { clearTimeout(timer); }
  }
})();
// Keeps the screen on during games where the browser allows it (it needs a secure page, so mostly not over Wi-Fi).
const awake = () => { if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").catch(() => {}); };
awake(); document.addEventListener("visibilitychange", awake);
</script>"##;

const MANIFEST: &str = r##"{"name":"DeepARAM","short_name":"DeepARAM","start_url":"./","scope":"./","display":"standalone","background_color":"#090b0f","theme_color":"#090b0f","icons":[{"src":"icon.png","sizes":"512x512","type":"image/png"}]}"##;

fn reply(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// The request's path, after reading the whole request head (closing with unread bytes can reset the connection
/// before the phone reads the answer).
fn read_path(stream: &TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream);
    let mut first = String::new();
    reader.read_line(&mut first).ok()?;
    for _ in 0..100 {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }
    let mut parts = first.split_whitespace();
    let method = parts.next()?;
    (method == "GET" || method == "HEAD").then(|| parts.next().unwrap_or("/").to_owned())
}

/// The page as the phone gets it: the window's page with the phone's head and the script that follows the app.
fn phone_page(html: &str) -> String {
    html.replacen("</head>", &format!("{HEAD}\n</head>"), 1).replacen("</body>", &format!("{SHIM}\n</body>"), 1)
}

fn serve(app: &AppHandle, mut stream: TcpStream, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let Some(path) = read_path(&stream) else {
        return reply(&mut stream, "400 Bad Request", "text/plain", b"bad request");
    };
    let Some(rest) = path.strip_prefix(&format!("/{token}/")) else {
        // The address without its last slash: the page's relative links need it.
        if path == format!("/{token}") {
            let head = format!("HTTP/1.1 301 Moved Permanently\r\nLocation: /{token}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            let _ = stream.write_all(head.as_bytes());
            return;
        }
        return reply(&mut stream, "404 Not Found", "text/plain", b"not found");
    };
    let (file, query) = rest.split_once('?').unwrap_or((rest, ""));
    match file {
        "events" => {
            let after =
                query.split('&').find_map(|kv| kv.strip_prefix("after=")).and_then(|n| n.parse().ok()).unwrap_or(0);
            let body = wait_since(after, WAIT).to_string();
            return reply(&mut stream, "200 OK", "application/json", body.as_bytes());
        }
        // The two app calls the page makes on its own: which key Flash goes on, and the "your record" nudge.
        "invoke/flash_key" => {
            let body = json!(crate::flash_key(app.clone())).to_string();
            return reply(&mut stream, "200 OK", "application/json", body.as_bytes());
        }
        "invoke/my_record" => {
            let body = tauri::async_runtime::block_on(crate::sharing::my_record()).to_string();
            return reply(&mut stream, "200 OK", "application/json", body.as_bytes());
        }
        "manifest.webmanifest" => {
            return reply(&mut stream, "200 OK", "application/manifest+json", MANIFEST.as_bytes())
        }
        _ => {}
    }
    let file = if file.is_empty() { "companion.html" } else { file };
    // Only the companion and what it loads: never the main window's page, and nothing outside the app's files.
    if file == "index.html" || file.contains("..") {
        return reply(&mut stream, "404 Not Found", "text/plain", b"not found");
    }
    let Some(asset) = app.asset_resolver().get(file.to_owned()) else {
        return reply(&mut stream, "404 Not Found", "text/plain", b"not found");
    };
    let mut bytes = asset.bytes().to_vec();
    if file == "companion.html" {
        bytes = phone_page(&String::from_utf8_lossy(&bytes)).into_bytes();
    }
    reply(&mut stream, "200 OK", asset.mime_type(), &bytes);
}

/// Starts serving when the owner turned it on (the `phone-companion` file), and writes the addresses to
/// `phone-url.txt` beside it: the PC's network address, then its name (the name keeps working if the router hands
/// the PC a new address, where the phone can look names up).
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
    let listener = match TcpListener::bind(("0.0.0.0", PORT)) {
        Ok(l) => l,
        Err(e) => {
            let _ = std::fs::write(dir.join("phone-url.txt"), format!("Not serving: port {PORT} is taken ({e})\n"));
            return;
        }
    };
    let mut urls = String::new();
    if let Some(ip) = lan_ip() {
        urls += &format!("http://{ip}:{PORT}/{token}/\n");
    }
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        urls += &format!("http://{}.local:{PORT}/{token}/\n", name.to_lowercase());
    }
    let _ = std::fs::write(dir.join("phone-url.txt"), urls);
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

    // One test, since the mirror is shared by the whole app.
    #[test]
    fn the_phone_ends_up_where_the_window_is() {
        full("window.showPick(1)");
        full("window.showPick(2)");
        push("window.setFlashKey('F')");
        // A new page gets the latest champion select view, then the update.
        assert_eq!(since(0).1, vec!["window.showPick(2)", "window.setFlashKey('F')"]);
        let g = |t: u32, level: u32, dead: bool| {
            format!(
                "window.showGame({})",
                json!({"t": t, "champ": "Ahri", "level": level, "dead": dead, "items": [], "offer": []})
            )
        };
        full(&g(1, 1, false));
        let (seen, _) = since(0);
        push("window.showOffer([1,2,3])");
        full(&g(2, 1, false));
        push("window.autoTaken(2)");
        full(&g(3, 1, false));
        full(&g(4, 1, false));
        // A page that kept up gets every update, even ones a whole view followed before it asked.
        assert_eq!(
            since(seen).1,
            vec!["window.showOffer([1,2,3])".to_owned(), g(2, 1, false), "window.autoTaken(2)".into(), g(4, 1, false)]
        );
        // A page that opens mid-game replays the game so far, so its picks and offers match the window's.
        assert_eq!(
            since(0).1,
            vec![
                "window.showPick(2)".to_owned(),
                "window.setFlashKey('F')".into(),
                g(1, 1, false),
                "window.showOffer([1,2,3])".into(),
                g(2, 1, false),
                "window.autoTaken(2)".into(),
                g(4, 1, false),
            ]
        );
        // A death, a level or a buy stays: the page counts screens owed and buys from them.
        full(&g(5, 1, true));
        full(&g(6, 1, false));
        full(&g(7, 2, false));
        full(&g(8, 2, false));
        assert_eq!(since(0).1[6..], [g(4, 1, false), g(5, 1, true), g(6, 1, false), g(8, 2, false)]);
        // The game's last update stays under the review (its recap reads it).
        full("window.showReview({})");
        assert_eq!(since(0).1[9..], [g(8, 2, false), "window.showReview({})".into()]);
        // Champion select again: a new game's list.
        full("window.showPick(3)");
        assert_eq!(since(0).1, vec!["window.showPick(3)"]);
        let (n, _) = since(0);
        assert_eq!(wait_since(n, Duration::from_millis(10))["scripts"], json!([]));
        companion_prefs(json!({ "lucky": true }));
        let w = wait_since(n, Duration::from_millis(10));
        assert_eq!(w["prefs"], json!("{\"lucky\":true}"));
        assert_eq!(w["scripts"], json!([]));
    }

    #[test]
    fn the_phone_page_follows_the_app() {
        let page = phone_page("<html><head><title>x</title></head><body><main></main></body></html>");
        assert!(page.contains("apple-mobile-web-app-capable"));
        assert!(page.find("phoneInvoke").unwrap() < page.find("<main>").unwrap());
        assert!(page.find("events?after=").unwrap() > page.find("<main>").unwrap());
    }
}
