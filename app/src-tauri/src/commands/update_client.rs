//! The HTTP client and signing key a release download runs with, both read
//! from what the updater plugin was configured with.

use super::update_failure::DownloadFailure;
use std::time::Duration;
use tauri::{Manager, Runtime, Webview};
use tauri_plugin_updater::Update;

/// A silent stall reads as a failure after this long, so it can be resumed
/// instead of hanging the download for the rest of the session.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

pub fn client_for(update: &Update) -> Result<reqwest::Client, DownloadFailure> {
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

pub fn updater_pubkey<R: Runtime>(webview: &Webview<R>) -> Result<String, DownloadFailure> {
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
