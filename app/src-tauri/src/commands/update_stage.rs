//! The shell's own download + install commands over the updater plugin's
//! `Update` resource (PRODUCT-1727). `check()` stays with the plugin; the
//! download runs through `update_fetch` into a persisted partial under the
//! app cache dir (resume + backoff within a call AND across calls, which the
//! plugin's single-shot request lacks), the finished file is verified against
//! the release signature exactly as the plugin would (`update_verify`), then
//! staged in the resource table until the frontend asks for the install.

use super::update_failure::DownloadFailure;
use super::update_fetch::{fetch_with_resume, DownloadEvent};
use super::update_partial::PartialDownload;
use super::update_verify::admit_release;
use reqwest::header::{HeaderValue, ACCEPT};
use std::path::PathBuf;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};
use tauri_plugin_updater::Update;

/// A silent stall reads as a failure after this long, so it can be resumed
/// instead of hanging the download for the rest of the session.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// The verified release bytes, waiting for `install_update`.
struct StagedUpdate(Vec<u8>);
impl Resource for StagedUpdate {}

fn client_for(update: &Update) -> Result<reqwest::Client, DownloadFailure> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("houston-app/{}", env!("CARGO_PKG_VERSION")))
        .read_timeout(READ_TIMEOUT);
    if let Some(timeout) = update.timeout {
        builder = builder.timeout(timeout);
    }
    if update.no_proxy {
        builder = builder.no_proxy();
    } else if let Some(ref proxy) = update.proxy {
        let proxy = reqwest::Proxy::all(proxy.as_str())
            .map_err(|e| DownloadFailure::other(format!("invalid updater proxy: {e}")))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| DownloadFailure::other(format!("build download client: {e}")))
}

fn updater_pubkey<R: Runtime>(webview: &Webview<R>) -> Result<String, DownloadFailure> {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|cfg| cfg.get("pubkey"))
        .and_then(|key| key.as_str())
        .map(str::to_string)
        .ok_or_else(|| DownloadFailure::other("updater pubkey missing from tauri.conf.json"))
}

/// `<app cache dir>/updates`: where a half-downloaded release waits for the
/// next poll. A cache dir on purpose: the OS may purge it, and a purge only
/// costs a restart from zero.
fn partials_dir<R: Runtime>(webview: &Webview<R>) -> Result<PathBuf, DownloadFailure> {
    let cache = webview
        .path()
        .app_cache_dir()
        .map_err(|e| DownloadFailure::other(format!("resolve app cache dir: {e}")))?;
    Ok(cache.join("updates"))
}

fn take_update<R: Runtime>(
    webview: &Webview<R>,
    rid: ResourceId,
) -> Result<Update, DownloadFailure> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| DownloadFailure::other(format!("update resource {rid} is gone: {e}")))?;
    Ok((*update).clone())
}

/// Download the release the plugin's `check()` found (`rid` is its `Update`
/// resource), resuming across drops and across calls, verify its signature,
/// and stage the bytes. Resolves with the staged resource id for
/// `install_update`. A rejection for a dropped link leaves the partial on
/// disk; the next call picks it up where it stopped.
#[tauri::command(rename_all = "snake_case")]
pub async fn download_update<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    on_event: Channel<DownloadEvent>,
) -> Result<ResourceId, DownloadFailure> {
    let update = take_update(&webview, rid)?;
    let pubkey = updater_pubkey(&webview)?;
    let client = client_for(&update)?;
    let mut headers = update.headers.clone();
    if !headers.contains_key(ACCEPT) {
        headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    }
    let dir = partials_dir(&webview)?;
    let mut partial = PartialDownload::open(&dir, &update.version, update.download_url.as_str())
        .map_err(|e| DownloadFailure::other(format!("open partial download: {e}")))?;
    fetch_with_resume(
        &client,
        &update.download_url,
        &headers,
        &mut partial,
        |event| {
            // Progress callback with no UI thread: a closed channel only means
            // the webview went away mid-download, and the result still returns.
            if let Err(e) = on_event.send(event) {
                tracing::warn!("[updater] progress channel closed: {e}");
            }
        },
    )
    .await?;
    let bytes = admit_release(partial, &update.signature, &pubkey).await?;
    Ok(webview.resources_table().add(StagedUpdate(bytes)))
}

/// Install the staged bytes through the plugin's installer (bundle swap on
/// macOS; msiexec hand-off + process exit on Windows).
#[tauri::command(rename_all = "snake_case")]
pub async fn install_update<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    bytes_rid: ResourceId,
) -> Result<(), String> {
    let update = take_update(&webview, rid).map_err(|e| e.message)?;
    let staged = webview
        .resources_table()
        .get::<StagedUpdate>(bytes_rid)
        .map_err(|e| format!("staged update {bytes_rid} is gone: {e}"))?;
    update.install(&staged.0).map_err(|e| e.to_string())?;
    // Windows never reaches here (the installer hand-off exits the process);
    // on macOS the bytes are on disk now and the buffer can go.
    webview
        .resources_table()
        .close(bytes_rid)
        .map_err(|e| format!("release staged buffer: {e}"))
}
