// DeepARAM for desktop: the live site in a native window, with a tray menu and patch notifications.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
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
const HIDDEN_ARG: &str = "--hidden";

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
}

impl Store {
    fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("state.json");
        let saved = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Store { file, saved: Mutex::new(saved) }
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

fn go(app: &AppHandle, path: &str) {
    if let (Some(win), Ok(url)) = (main_window(app), Url::parse(&format!("{SITE}{path}"))) {
        let _ = win.navigate(url);
    }
    show(app);
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
    let auto = CheckMenuItem::with_id(app, "auto", AUTOSTART_LABEL, true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DeepARAM", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&open, &sep()?, &tier, &sim, &patches, &pbe, &sep()?, &check, &notes])?;
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
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Must come first: a second launch focuses the running app instead of opening another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
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
            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            build_window(&handle, hidden)?;
            build_tray(&handle)?;
            thread::spawn(move || loop {
                check_patch(&handle, false);
                thread::sleep(POLL_EVERY);
            });
            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the window keeps DeepARAM in the tray so patch notifications still arrive.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !has_tray() {
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
