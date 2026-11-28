// DeepARAM for desktop: the live site in a native window, with a tray menu and patch notifications.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod augscan;
mod companion;
mod headliner;
mod hud;
mod ingame;
mod phone;
mod procs;
mod review;
mod sharing;
mod updater;

use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

const SITE: &str = "https://deeparam.com";
const STATUS_URL: &str = "https://deeparam.com/data/app-status.json";
const POLL_EVERY: Duration = Duration::from_secs(30 * 60);
pub(crate) const HIDDEN_ARG: &str = "--hidden";

// Runs in every page: marks the site as running inside the app, shows a banner while offline,
// and adds the app's shortcuts: Ctrl+1 to Ctrl+7 for the main sections, Ctrl+Shift+C to copy the
// page's link. Back (Alt+Left), reload (F5) and zoom (Ctrl +/-/0) come with the web view.
const PAGE_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)deeparam\.com$/.test(location.hostname)) return;
  const SECTIONS = ["/", "/tier-list", "/simulator", "/patches", "/pbe", "/champions", "/kitchen"];
  const ready = (fn) => document.readyState === "loading" ? addEventListener("DOMContentLoaded", fn) : fn();
  const pill = (text) => {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:8px;background:#11151b;color:#e7ebef;border:1px solid #222a33;font:13px 'Segoe UI',Cantarell,'Noto Sans',system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)";
    return el;
  };
  addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const n = Number(e.key);
    if (!e.shiftKey && n >= 1 && n <= SECTIONS.length) {
      e.preventDefault();
      location.href = SECTIONS[n - 1];
    } else if (e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      navigator.clipboard.writeText(location.href).then(() => {
        const done = pill("Link copied");
        document.body.appendChild(done);
        setTimeout(() => done.remove(), 1600);
      });
    }
  });
  ready(() => {
    document.documentElement.dataset.app = "DESKTOP_PLATFORM";
    const bar = pill("You're offline. Pages you've already opened still work.");
    const sync = () => navigator.onLine ? bar.remove() : document.body.appendChild(bar);
    addEventListener("online", sync);
    addEventListener("offline", sync);
    sync();
  });
})();
"#;

// What the page script tags the site with, and what the tray calls launching at sign-in.
#[cfg(windows)]
const PLATFORM: &str = "windows";
#[cfg(not(windows))]
const PLATFORM: &str = "linux";
#[cfg(windows)]
const AUTOSTART_LABEL: &str = "Start with Windows";
#[cfg(not(windows))]
const AUTOSTART_LABEL: &str = "Start at login";

/// Whether the desktop shows tray icons. Windows always does; on Linux it needs a StatusNotifier host
/// (KDE, Ubuntu's GNOME, most others), and stock GNOME has none, so there closing the window quits
/// instead of leaving DeepARAM running with no icon to bring it back or quit it.
#[cfg(not(target_os = "linux"))]
fn has_tray() -> bool {
    true
}
#[cfg(target_os = "linux")]
fn has_tray() -> bool {
    static HAS: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *HAS.get_or_init(|| {
        let owned = || -> zbus::Result<bool> {
            let conn = zbus::blocking::Connection::session()?;
            let dbus = zbus::blocking::fdo::DBusProxy::new(&conn)?;
            Ok(dbus.name_has_owner("org.kde.StatusNotifierWatcher".try_into()?)?)
        };
        owned().unwrap_or(false)
    })
}

/// Launching at sign-in can't be set up from inside the Flatpak sandbox, so the tray leaves it out there.
fn autostart_available() -> bool {
    std::env::var_os("FLATPAK_ID").is_none()
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    live_patch: Option<String>,
    pbe_build: Option<String>,
    last_path: Option<String>,
    tray_hint_shown: bool,
    notifications_off: bool,
    /// The companion window (champion select picks, the game, the game's review) doesn't open by itself.
    companion_off: bool,
    /// Augment offers aren't read off the screen.
    scan_off: bool,
    /// The companion window doesn't go full screen on a second monitor during games.
    second_screen_off: bool,
    /// The companion window draws with the graphics card. Off by default: it draws on the processor, so the
    /// graphics card stays the game's (Nico 2026-11-24 saw lower frame rates with the app open).
    companion_gpu: bool,
    /// Updates aren't installed by themselves (the tray's "Update automatically").
    auto_update_off: bool,
    /// The last update installed by itself, and when (seconds): not tried again for a day if it didn't take.
    update_tried: Option<(String, u64)>,
    scan_hint_shown: bool,
    /// Flash goes on F in recommended spell pairs (off: on D, the usual key).
    flash_on_f: bool,
}

/// Which key Flash goes on in recommended spell pairs: "D" (default) or "F" (the tray's "Flash on F").
/// The owner's PC (its `record-offers` file): the companion sets his defaults once (Top 5%, Feeling lucky; Nico
/// 2026-11-28), and his later choices stick.
#[tauri::command]
fn owner_pc(app: AppHandle) -> bool {
    app.path().app_data_dir().is_ok_and(|d| d.join("record-offers").exists())
}

/// Owner recording: what the companion showed (its augment picks on a screen, the item path), a line each time it
/// changes, to offers/shown.jsonl with the wall clock, so the capture review shows it beside each round (Nico
/// 2026-11-28). Nothing is written without the `record-offers` file.
#[tauri::command]
fn shown_log(app: AppHandle, line: serde_json::Value) {
    let Ok(base) = app.path().app_data_dir() else { return };
    if !base.join("record-offers").exists() {
        return;
    }
    let dir = base.join("offers");
    let _ = std::fs::create_dir_all(&dir);
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("shown.jsonl")) {
        let _ = writeln!(f, "{}", serde_json::json!({"t": ms, "shown": line}));
    }
}

#[tauri::command]
fn flash_key(app: AppHandle) -> &'static str {
    if app.state::<Store>().saved.lock().unwrap().flash_on_f {
        "F"
    } else {
        "D"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    live_patch: Option<String>,
    pbe_build: Option<String>,
}

struct Store {
    file: PathBuf,
    saved: Mutex<Saved>,
    /// No saved state yet: the app's first launch on this PC.
    fresh: bool,
}

impl Store {
    fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("state.json");
        let fresh = !file.exists();
        let saved = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Store { file, saved: Mutex::new(saved), fresh }
    }

    fn update<R>(&self, f: impl FnOnce(&mut Saved) -> R) -> R {
        let mut saved = self.saved.lock().unwrap();
        let out = f(&mut saved);
        if let Ok(json) = serde_json::to_vec_pretty(&*saved) {
            let _ = fs::write(&self.file, json);
        }
        out
    }
}

fn is_site(url: &Url) -> bool {
    matches!(url.host_str(), Some("deeparam.com" | "www.deeparam.com"))
}

// The bundled start page is served from tauri.localhost on Windows and tauri://localhost elsewhere.
fn is_internal(url: &Url) -> bool {
    is_site(url)
        || matches!(url.scheme(), "tauri" | "about" | "data" | "blob")
        || url.host_str() == Some("tauri.localhost")
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Starting DeepARAM again, or clicking its tray icon, brings back the window already in use (PC app 1.26.24): the
/// companion while it's open (champion select or a game), the main window otherwise, so only one window opens.
///
/// A launch grace period (PC app 1.26.28): for the first seconds after DeepARAM starts, while it's still loading and
/// may be about to open the companion, a second launch only brings forward a window that's already showing; it
/// never un-hides the main window, so two windows can't end up open.
fn show_one(app: &AppHandle) {
    let loading = STARTED.get().is_none_or(|at| at.elapsed() < LAUNCH_GRACE);
    if loading {
        for label in [companion::LABEL, "main"] {
            if let Some(win) = app.get_webview_window(label).filter(|w| w.is_visible().unwrap_or(false)) {
                let _ = win.unminimize();
                let _ = win.set_focus();
                return;
            }
        }
        return;
    }
    if let Some(win) = app.get_webview_window(companion::LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    show(app);
}

fn go(app: &AppHandle, path: &str) {
    if let (Some(win), Ok(url)) = (main_window(app), Url::parse(&format!("{SITE}{path}"))) {
        let _ = win.navigate(url);
    }
    show(app);
}

pub(crate) fn auto_update_on(app: &AppHandle) -> bool {
    !app.state::<Store>().saved.lock().unwrap().auto_update_off
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn update_tried_recently(app: &AppHandle, tag: &str, now: u64) -> bool {
    let store = app.state::<Store>();
    let saved = store.saved.lock().unwrap();
    saved.update_tried.as_ref().is_some_and(|(t, at)| t == tag && now.saturating_sub(*at) < updater::RETRY_AFTER)
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn note_update_tried(app: &AppHandle, tag: &str, now: u64) {
    app.state::<Store>().update(|s| s.update_tried = Some((tag.to_owned(), now)));
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Fetches the site's current patch and test server build, and notifies when either has moved on.
/// The first check after install only records them. `manual` also reports when nothing changed.
fn check_patch(app: &AppHandle, manual: bool) {
    let status: Status = match ureq::get(STATUS_URL).call().and_then(|mut r| r.body_mut().read_json()) {
        Ok(s) => s,
        Err(_) => {
            if manual {
                notify(
                    app,
                    "Couldn't check for updates",
                    "DeepARAM couldn't be reached. Try again when you're back online.",
                );
            }
            return;
        }
    };
    let store = app.state::<Store>();
    let (new_live, new_pbe, quiet) = store.update(|s| {
        let first = s.live_patch.is_none() && s.pbe_build.is_none();
        let new_live = status.live_patch.clone().filter(|p| !first && s.live_patch.as_ref() != Some(p));
        let new_pbe = status.pbe_build.clone().filter(|b| !first && s.pbe_build.as_ref() != Some(b));
        s.live_patch = status.live_patch.clone().or(s.live_patch.take());
        s.pbe_build = status.pbe_build.clone().or(s.pbe_build.take());
        (new_live, new_pbe, s.notifications_off && !manual)
    });
    if quiet {
        return;
    }
    if let Some(patch) = &new_live {
        notify(app, &format!("Patch {patch} is live"), "The tier list, builds and simulator now use the new patch.");
    }
    if let Some(build) = &new_pbe {
        notify(app, "New PBE build", &format!("See what's changing on the test server in build {build}."));
    }
    if manual && new_live.is_none() && new_pbe.is_none() {
        let patch = status.live_patch.unwrap_or_else(|| "the current patch".into());
        notify(app, "You're up to date", &format!("DeepARAM is on patch {patch}."));
    }
}

fn start_page(store: &Store) -> WebviewUrl {
    let saved = store.saved.lock().unwrap();
    let mut url = String::from("index.html");
    let mut query = Url::parse("http://x/").unwrap();
    {
        let mut q = query.query_pairs_mut();
        if let Some(path) = &saved.last_path {
            q.append_pair("path", path);
        }
        if let Some(patch) = &saved.live_patch {
            q.append_pair("patch", patch);
        }
    }
    if let Some(q) = query.query().filter(|q| !q.is_empty()) {
        url.push('?');
        url.push_str(q);
    }
    WebviewUrl::App(url.into())
}

fn build_window(app: &AppHandle, hidden: bool) -> tauri::Result<WebviewWindow> {
    let nav = app.clone();
    let popup = app.clone();
    let loaded = app.clone();
    WebviewWindowBuilder::new(app, "main", start_page(&app.state::<Store>()))
        .title("DeepARAM")
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 600.0)
        .center()
        .visible(!hidden)
        .background_color(tauri::window::Color(9, 11, 15, 255))
        .initialization_script(PAGE_SCRIPT.replace("DESKTOP_PLATFORM", PLATFORM))
        .on_navigation(move |url| {
            if is_internal(url) {
                return true;
            }
            open_external(&nav, url);
            false
        })
        .on_new_window(move |url, _features| {
            // Links that open a new tab stay in the app when they point at the site.
            if is_site(&url) {
                if let Some(win) = main_window(&popup) {
                    let _ = win.navigate(url);
                }
            } else {
                open_external(&popup, &url);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_win, payload| {
            let url = payload.url();
            if payload.event() == PageLoadEvent::Finished && is_site(url) {
                let path = match url.query() {
                    Some(q) => format!("{}?{q}", url.path()),
                    None => url.path().to_string(),
                };
                loaded.state::<Store>().update(|s| s.last_path = Some(path));
            }
        })
        .build()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let notifications_on = !app.state::<Store>().saved.lock().unwrap().notifications_off;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(app, "open", "Open DeepARAM", true, None::<&str>)?;
    let tier = MenuItem::with_id(app, "tier", "Tier List", true, None::<&str>)?;
    let sim = MenuItem::with_id(app, "sim", "Simulator", true, None::<&str>)?;
    let patches = MenuItem::with_id(app, "patches", "Patches", true, None::<&str>)?;
    let pbe = MenuItem::with_id(app, "pbe", "PBE", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Check for patch updates", true, None::<&str>)?;
    let notes = CheckMenuItem::with_id(app, "notes", "Patch notifications", true, notifications_on, None::<&str>)?;
    let updates = CheckMenuItem::with_id(
        app,
        "updates",
        "Update automatically",
        cfg!(windows),
        auto_update_on(app),
        None::<&str>,
    )?;
    let auto = CheckMenuItem::with_id(app, "auto", AUTOSTART_LABEL, true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DeepARAM", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    // Everything for a Mayhem game shows in the companion window, never over the game.
    let (companion_on, scan_on, second_on, gpu_on, flash_f) = {
        let store = app.state::<Store>();
        let saved = store.saved.lock().unwrap();
        (!saved.companion_off, !saved.scan_off, !saved.second_screen_off, saved.companion_gpu, saved.flash_on_f)
    };
    let flash = CheckMenuItem::with_id(app, "flash", "Flash on F (off: on D)", true, flash_f, None::<&str>)?;
    let comp = CheckMenuItem::with_id(
        app,
        "companion",
        "Open by itself (champ select, game, review)",
        true,
        companion_on,
        None::<&str>,
    )?;
    let scan = CheckMenuItem::with_id(
        app,
        "scan",
        "Read augment offers off the screen",
        augscan::available(),
        scan_on && augscan::available(),
        None::<&str>,
    )?;
    let second =
        CheckMenuItem::with_id(app, "second", "Full screen on a second monitor", true, second_on, None::<&str>)?;
    let gpu = CheckMenuItem::with_id(
        app,
        "gpu",
        "Use the graphics card (from the next time it opens)",
        cfg!(windows),
        gpu_on,
        None::<&str>,
    )?;
    let companion_menu = Submenu::with_items(app, "Mayhem companion", true, &[&comp, &scan, &second, &gpu, &flash])?;
    let share = sharing::menu_item(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &sep()?,
            &tier,
            &sim,
            &patches,
            &pbe,
            &sep()?,
            &companion_menu,
            &share,
            &sep()?,
            &check,
            &notes,
            &updates,
        ],
    )?;
    if autostart_available() {
        menu.append(&auto)?;
    }
    menu.append_items(&[&sep()?, &quit])?;

    let notes_item = notes.clone();
    let auto_item = auto.clone();
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("DeepARAM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show(app),
            "tier" => go(app, "/tier-list"),
            "sim" => go(app, "/simulator"),
            "patches" => go(app, "/patches"),
            "pbe" => go(app, "/pbe"),
            "check" => {
                let app = app.clone();
                thread::spawn(move || check_patch(&app, true));
            }
            "scan" => {
                let on = scan.is_checked().unwrap_or(true);
                app.state::<Store>().update(|s| s.scan_off = !on);
            }
            "updates" => {
                let on = updates.is_checked().unwrap_or(true);
                app.state::<Store>().update(|s| s.auto_update_off = !on);
            }
            "gpu" => {
                let on = gpu.is_checked().unwrap_or(false);
                app.state::<Store>().update(|s| s.companion_gpu = on);
            }
            "flash" => {
                let on = flash.is_checked().unwrap_or(false);
                app.state::<Store>().update(|s| s.flash_on_f = on);
                companion::flash_key(app, if on { "F" } else { "D" });
            }
            "second" => {
                let on = second.is_checked().unwrap_or(true);
                app.state::<Store>().update(|s| s.second_screen_off = !on);
            }
            "share" => sharing::on_menu(app),
            "companion" => {
                let on = comp.is_checked().unwrap_or(true);
                app.state::<Store>().update(|s| s.companion_off = !on);
                if !on {
                    ingame::stop(app);
                    companion::close(app);
                }
            }
            "notes" => {
                let on = notes_item.is_checked().unwrap_or(true);
                app.state::<Store>().update(|s| s.notifications_off = !on);
            }
            "auto" => {
                let launcher = app.autolaunch();
                let _ = if auto_item.is_checked().unwrap_or(false) { launcher.enable() } else { launcher.disable() };
                let _ = auto_item.set_checked(launcher.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_one(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// When DeepARAM started, for the launch grace period.
static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
const LAUNCH_GRACE: Duration = Duration::from_secs(20);

fn main() {
    let _ = STARTED.set(std::time::Instant::now());
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            companion::companion_fullscreen,
            sharing::share_choice,
            sharing::share_status,
            sharing::my_record,
            sharing::my_trends,
            flash_key,
            owner_pc,
            shown_log,
            phone::companion_prefs
        ])
        // Must come first: a second launch focuses the running app instead of opening another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_one(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(Store::load(&handle));
            app.manage(ingame::Shared::default());
            app.manage(companion::Shared::default());
            app.manage(sharing::Sharing::load(&handle));
            // The owner's phone companion (off unless its file is in the data folder).
            phone::start(&handle);
            // First launch: start with Windows (hidden in the tray), so champion select and the game are followed
            // without opening the app first. The tray's switch turns it off.
            if handle.state::<Store>().fresh && autostart_available() {
                let _ = handle.autolaunch().enable();
                handle.state::<Store>().update(|_| ());
            }
            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            build_window(&handle, hidden)?;
            build_tray(&handle)?;
            ingame::watch(handle.clone());
            companion::watch(handle.clone());
            sharing::watch(handle.clone());
            updater::watch(handle.clone());
            // Started again by an automatic update: say so once.
            let updated = {
                let running = handle.package_info().version.to_string();
                let tried = handle.state::<Store>().saved.lock().unwrap().update_tried.clone();
                tried.filter(|(tag, _)| tag.trim_start_matches('v') == running).map(|_| running)
            };
            if let Some(v) = updated {
                handle.state::<Store>().update(|s| s.update_tried = None);
                notify(&handle, "DeepARAM updated", &format!("You're on version {v}."));
            }
            if !hidden {
                sharing::ask_once(&handle);
            }
            thread::spawn(move || loop {
                check_patch(&handle, false);
                thread::sleep(POLL_EVERY);
            });
            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the window keeps DeepARAM in the tray so patch notifications still arrive.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if win.label() != "main" || !has_tray() {
                    return;
                }
                api.prevent_close();
                let _ = win.hide();
                let app = win.app_handle();
                let first = app.state::<Store>().update(|s| !std::mem::replace(&mut s.tray_hint_shown, true));
                if first {
                    notify(
                        app,
                        "DeepARAM is still running",
                        "It's in the tray, so you'll hear about new patches. Right-click the icon to quit.",
                    );
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start DeepARAM");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn site_links_stay_in_the_app() {
        assert!(is_site(&url("https://deeparam.com/tier-list")));
        assert!(is_site(&url("https://www.deeparam.com/")));
        assert!(!is_site(&url("https://deeparam.com.example.org/")));
        assert!(!is_site(&url("https://example.com/?u=deeparam.com")));
    }

    #[test]
    fn start_page_and_web_internals_are_internal() {
        assert!(is_internal(&url("http://tauri.localhost/index.html")));
        assert!(is_internal(&url("tauri://localhost/index.html")));
        assert!(is_internal(&url("about:blank")));
        assert!(!is_internal(&url("https://www.leagueoflegends.com/")));
    }

    #[test]
    fn status_reads_the_site_json() {
        let s: Status =
            serde_json::from_str(r#"{"livePatch":"26.21","pbeBuild":"16.22.1","pbeUpdated":null}"#).unwrap();
        assert_eq!(s.live_patch.as_deref(), Some("26.21"));
        assert_eq!(s.pbe_build.as_deref(), Some("16.22.1"));
    }

    #[test]
    fn page_script_has_the_platform_slot() {
        assert!(PAGE_SCRIPT.contains("DESKTOP_PLATFORM"));
    }
}
