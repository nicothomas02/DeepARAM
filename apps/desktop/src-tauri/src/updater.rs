// Automatic updates (Nico 2026-11-24: "can app update automatically?"). Every 15 minutes the app asks GitHub for the
// newest release. If it's newer than this one, the app downloads the Windows installer, checks it against the
// release's SHA-256, installs it silently and starts again in the tray. It only does this while League is closed or
// in the lobby: never in champion select or a game. The same cadence and gating as Nico's PC app (1.25.0).
// The tray's "Update automatically" switch turns it off.
// Off Windows only the tests use the helpers below.
#![cfg_attr(not(windows), allow(dead_code))]

use std::time::Duration;

use serde_json::Value;
#[cfg(windows)]
use tauri::{AppHandle, Manager};

/// The newest release, as GitHub reports it.
#[cfg(windows)]
const LATEST: &str = "https://api.github.com/repos/nicothomas02/DeepARAM/releases/latest";
/// The owner's feed (Nico 2026-11-27): owner builds released from the private DeepARAM-PC repo (owner-app.yml),
/// read with his own read-only key from `owner-feed-token.txt` in the app's data folder. Public releases never
/// replace the owner's build, and owner builds never reach the public.
#[cfg(windows)]
const OWNER_LATEST: &str = "https://api.github.com/repos/nicothomas02/DeepARAM-PC/releases/latest";
/// The installer's fixed name in every release (release.yml), which the download page also uses.
pub const INSTALLER: &str = "DeepARAM-Windows-Setup.exe";
/// How often to look for an update, and how long after the app starts the first look waits.
pub const CHECK_EVERY: Duration = Duration::from_secs(15 * 60); // PC app 1.26.26: every 15 minutes
pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(3 * 60);
/// A version that was tried and didn't take isn't tried again for this long.
pub const RETRY_AFTER: u64 = 24 * 60 * 60;

/// "v0.3.0" or "0.3.0" as numbers. None for anything else.
pub fn version(s: &str) -> Option<(u64, u64, u64)> {
    let mut parts = s.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u64>().ok());
    let v = (parts.next()??, parts.next()??, parts.next().flatten().unwrap_or(0));
    parts.next().is_none().then_some(v)
}

/// Whether the release tagged `tag` is newer than the running version.
pub fn newer(tag: &str, running: &str) -> bool {
    matches!((version(tag), version(running)), (Some(t), Some(r)) if t > r)
}

/// Installing is safe whenever League is idle (PC app 1.26.28): closed (no client found), in the lobby, in queue or
/// on the end-of-game screen. Never from the ready check through champion select and the game. A client that runs
/// but doesn't answer counts as busy.
pub fn quiet_phase(phase: &Result<Option<String>, ()>) -> bool {
    match phase {
        Ok(None) => true,
        Ok(Some(p)) => {
            matches!(p.as_str(), "None" | "Lobby" | "Matchmaking" | "PreEndOfGame" | "WaitingForStats" | "EndOfGame")
        }
        Err(()) => false,
    }
}

/// The installer's download link and its SHA-256 (hex) from a release: GitHub's own digest of the file, or else
/// the release's "<installer>.sha256" file, fetched by `fetch`. None without a checksum: nothing unchecked runs.
/// A private release's files download from their API address (`url`) with the key, not the browser link.
pub fn installer_of(
    release: &Value,
    private: bool,
    fetch: impl Fn(&str) -> Option<String>,
) -> Option<(String, String)> {
    let link = if private { "url" } else { "browser_download_url" };
    let assets = release.get("assets")?.as_array()?;
    let named = |n: &str| assets.iter().find(|a| a.get("name").and_then(Value::as_str) == Some(n));
    let exe = named(INSTALLER)?;
    let url = exe.get(link)?.as_str()?.to_owned();
    let digest = exe
        .get("digest")
        .and_then(Value::as_str)
        .and_then(|d| d.strip_prefix("sha256:"))
        .map(str::to_owned)
        .or_else(|| {
            let sums = named(&format!("{INSTALLER}.sha256"))?.get(link)?.as_str()?.to_owned();
            fetch(&sums)?.split_whitespace().next().map(str::to_owned)
        })?
        .to_ascii_lowercase();
    (digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit())).then_some((url, digest))
}

/// The script that installs the update once the app has quit, then starts the new version in the tray.
pub fn script(setup: &str, app: &str, hidden: &str) -> String {
    format!(
        "@echo off\r\nchcp 65001 >nul\r\nping -n 4 127.0.0.1 >nul\r\n\"{setup}\" /S\r\nstart \"\" \"{app}\" {hidden}\r\n"
    )
}

/// A GitHub request; with the owner's key for the private feed. A file asks for its bytes (`raw`), not its details.
#[cfg(windows)]
fn get(url: &str, key: Option<&str>, raw: bool) -> Option<ureq::http::Response<ureq::Body>> {
    let accept = if raw { "application/octet-stream" } else { "application/vnd.github+json" };
    let req = ureq::get(url).header("User-Agent", "DeepARAM-app").header("Accept", accept);
    match key {
        Some(k) => req.header("Authorization", &format!("Bearer {k}")).call().ok(),
        None => req.call().ok(),
    }
}

/// The owner's read-only key, saved by him (never shown or logged).
#[cfg(windows)]
fn owner_key(app: &AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    let k = std::fs::read_to_string(dir.join("owner-feed-token.txt")).ok()?;
    let k = k.trim();
    (!k.is_empty() && k.chars().all(|c| c.is_ascii_graphic())).then(|| k.to_owned())
}

#[cfg(windows)]
fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// How often a downloaded update looks for a moment to install.
#[cfg(windows)]
const INSTALL_POLL: Duration = Duration::from_secs(20);

/// A verified update on disk, waiting for League to be idle: (tag, install script).
#[cfg(windows)]
static READY: std::sync::Mutex<Option<(String, std::path::PathBuf)>> = std::sync::Mutex::new(None);

/// Looks for a new version every 15 minutes and downloads it whenever one is out, even during a game (PC app
/// 1.26.28). It installs and restarts on its own the first moment League is idle (see quiet_phase): no clicks.
/// Windows only: the public app's installer is Windows'.
#[cfg(windows)]
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_AFTER);
        let mut last: Option<std::time::Instant> = None;
        loop {
            if last.is_none_or(|at| at.elapsed() >= CHECK_EVERY) {
                last = Some(std::time::Instant::now());
                download(&app);
            }
            install_when_idle(&app);
            std::thread::sleep(INSTALL_POLL);
        }
    });
}

#[cfg(not(windows))]
pub fn watch(_app: tauri::AppHandle) {}

#[cfg(windows)]
fn quiet(app: &AppHandle) -> bool {
    !crate::ingame::in_game(app)
        && crate::augscan::game_window().is_none()
        && quiet_phase(&crate::companion::client_phase())
}

/// The owner's beta (its `record-offers` file): never replaced by a public release, which lacks the owner's
/// features (Nico 2026-11-27).
#[cfg(windows)]
fn owner_pc(app: &AppHandle) -> bool {
    app.path().app_data_dir().is_ok_and(|d| d.join("record-offers").exists())
}

#[cfg(windows)]
fn download(app: &AppHandle) {
    use sha2::{Digest, Sha256};

    if !crate::auto_update_on(app) {
        return;
    }
    // The owner's PC follows only the owner feed, and only with his key: no key, no update.
    let key = if owner_pc(app) {
        match owner_key(app) {
            Some(k) => Some(k),
            None => return,
        }
    } else {
        None
    };
    let key = key.as_deref();
    let private = key.is_some();
    let feed = if private { OWNER_LATEST } else { LATEST };
    let running = app.package_info().version.to_string();
    let Some(release) = get(feed, key, false).and_then(|mut r| r.body_mut().read_json::<Value>().ok()) else { return };
    let Some(tag) = release.get("tag_name").and_then(Value::as_str).map(str::to_owned) else { return };
    if !newer(&tag, &running) || crate::update_tried_recently(app, &tag, now()) {
        return;
    }
    if READY.lock().unwrap().as_ref().is_some_and(|(t, _)| *t == tag) {
        return;
    }
    let fetch = |u: &str| get(u, key, true)?.body_mut().read_to_string().ok();
    let Some((url, sha)) = installer_of(&release, private, fetch) else { return };
    let Some(bytes) =
        get(&url, key, true).and_then(|mut r| r.body_mut().with_config().limit(400 * 1024 * 1024).read_to_vec().ok())
    else {
        return;
    };
    let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if got != sha {
        return;
    }
    let dir = std::env::temp_dir().join("DeepARAM-update");
    let setup = dir.join(format!("DeepARAM-Setup-{}.exe", tag.trim_start_matches('v')));
    let cmd = dir.join("update.cmd");
    let Ok(exe) = std::env::current_exe() else { return };
    let written = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&setup, &bytes)).and_then(|_| {
        std::fs::write(&cmd, script(&setup.to_string_lossy(), &exe.to_string_lossy(), crate::HIDDEN_ARG))
    });
    if written.is_ok() {
        *READY.lock().unwrap() = Some((tag, cmd));
    }
}

/// Installs a downloaded update once League is idle: the app quits, the installer runs silently and the new version
/// starts again in the tray.
#[cfg(windows)]
fn install_when_idle(app: &AppHandle) {
    let Some((tag, cmd)) = READY.lock().unwrap().clone() else { return };
    if !crate::auto_update_on(app) || !quiet(app) || !cmd.exists() {
        return;
    }
    crate::note_update_tried(app, &tag, now());
    *READY.lock().unwrap() = None;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let started =
        std::process::Command::new("cmd").arg("/C").arg(&cmd).creation_flags(CREATE_NO_WINDOW).spawn().is_ok();
    if started {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compares_versions() {
        assert!(newer("v0.3.0", "0.2.1"));
        assert!(newer("v0.10.0", "0.9.9"));
        assert!(!newer("v0.2.1", "0.2.1"));
        assert!(!newer("v0.2.0", "0.2.1"));
        assert!(!newer("nightly", "0.2.1"));
        assert_eq!(version("v1.2"), Some((1, 2, 0)));
        assert_eq!(version("1.2.3.4"), None);
    }

    #[test]
    fn installs_only_while_league_is_idle() {
        assert!(quiet_phase(&Ok(None)));
        assert!(quiet_phase(&Ok(Some("Lobby".into()))));
        assert!(quiet_phase(&Ok(Some("None".into()))));
        for idle in ["Matchmaking", "PreEndOfGame", "WaitingForStats", "EndOfGame"] {
            assert!(quiet_phase(&Ok(Some(idle.into()))), "{idle}");
        }
        for busy in ["ReadyCheck", "ChampSelect", "GameStart", "InProgress", "Reconnect"] {
            assert!(!quiet_phase(&Ok(Some(busy.into()))), "{busy}");
        }
        assert!(!quiet_phase(&Err(())));
    }

    #[test]
    fn needs_a_checksum() {
        let sha = "AB".repeat(32);
        let with_digest = json!({"assets": [{"name": INSTALLER, "browser_download_url": "https://x/s.exe", "digest": format!("sha256:{sha}")}]});
        assert_eq!(installer_of(&with_digest, false, |_| None), Some(("https://x/s.exe".into(), sha.to_lowercase())));
        let with_file = json!({"assets": [
            {"name": INSTALLER, "browser_download_url": "https://x/s.exe"},
            {"name": format!("{INSTALLER}.sha256"), "browser_download_url": "https://x/s.sha256"}]});
        let sum = "cd".repeat(32);
        assert_eq!(
            installer_of(&with_file, false, |u| (u == "https://x/s.sha256").then(|| format!("{sum}  {INSTALLER}\n"))),
            Some(("https://x/s.exe".into(), sum.clone()))
        );
        let without = json!({"assets": [{"name": INSTALLER, "browser_download_url": "https://x/s.exe"}]});
        assert_eq!(installer_of(&without, false, |_| None), None);
        // The owner's private feed downloads by the API address.
        let private = json!({"assets": [{"name": INSTALLER, "url": "https://api/x/1", "browser_download_url": "https://x/s.exe", "digest": format!("sha256:{sha}")}]});
        assert_eq!(installer_of(&private, true, |_| None), Some(("https://api/x/1".into(), sha.to_lowercase())));
        assert_eq!(installer_of(&with_file, false, |_| Some("not-a-sum".into())), None);
    }

    #[test]
    fn script_installs_then_restarts_in_the_tray() {
        let s = script(r"C:\Temp\DeepARAM-update\DeepARAM-Setup-0.3.0.exe", r"C:\Users\A B\DeepARAM.exe", "--hidden");
        assert!(s.contains("\"C:\\Temp\\DeepARAM-update\\DeepARAM-Setup-0.3.0.exe\" /S\r\n"));
        assert!(s.ends_with("start \"\" \"C:\\Users\\A B\\DeepARAM.exe\" --hidden\r\n"));
    }
}
