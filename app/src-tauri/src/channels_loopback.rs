//! Loopback listener for the gateway's return from a desktop-started Slack
//! connect.
//!
//! The `houston://settings/channels` deep link makes the browser ask "Open
//! Houston?" before it follows. A plain `http://127.0.0.1` redirect does not,
//! so the desktop binds a listener, names its port and a fresh `state` in the
//! connect request, and the gateway 303s the approving browser to
//! `/channels/slack?state=<state>&slack=<ticket>`. The ticket still reaches
//! only the browser that approved: nothing here polls the gateway.
//!
//! The binding, state check, pages, emit and focus are the sign-in listener's
//! (`oauth_loopback`), but nothing is shared with a sign-in attempt. The port
//! is OS-assigned rather than one of the fixed sign-in candidates, and attempts
//! live in their own registry keyed by id, so a Slack connect and a sign-in
//! never supersede or cancel each other. Slack attempts do not supersede one
//! another either: an earlier tab the person finishes still lands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::oauth_loopback::callback::{query_param, LoopbackRoute};
use crate::oauth_loopback::listener::{spawn_listener, BoundSockets, ListenerTask};
use crate::oauth_loopback::pages::{slack_stale_page, slack_success_page};
use crate::oauth_loopback::state::ActiveListener;

/// The path the gateway redirects to. The sign-in path is never served here.
pub const SLACK_PATH: &str = "/channels/slack";

/// The gateway's Slack flow lifetime: past it no redirect can arrive.
const SLACK_TIMEOUT: Duration = Duration::from_secs(600);

static SLACK: LoopbackRoute = LoopbackRoute {
    tag: "channels-loopback",
    path: SLACK_PATH,
    timeout: SLACK_TIMEOUT,
    deep_link: channels_deep_link,
    success_page: slack_success_page,
    stale_page: slack_stale_page,
    release: |app, id| app.state::<ChannelsLoopbackState>().take(id).map(drop),
};

/// The event payload for an accepted return: the very link the gateway's
/// deep-link page opens, so the settings landing and its link gate handle both
/// paths the same way. The ticket goes through verbatim; the webview parses it.
pub fn channels_deep_link(query: &str) -> String {
    match query_param(query, "slack") {
        Some(ticket) => format!("houston://settings/channels?slack={ticket}"),
        None => "houston://settings/channels".to_string(),
    }
}

/// The nonce shape the gateway accepts (`^[A-Za-z0-9_-]{16,128}$`). Checked
/// here too, so an empty `state` can never make `state=` an accepted redirect.
pub fn is_valid_state(state: &str) -> bool {
    (16..=128).contains(&state.len())
        && state
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Every Slack listener still waiting, keyed by attempt id.
#[derive(Default)]
pub struct ChannelsLoopbackState {
    active: Mutex<HashMap<u64, ActiveListener>>,
    next_id: AtomicU64,
}

impl ChannelsLoopbackState {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<u64, ActiveListener>>, String> {
        self.active
            .lock()
            .map_err(|e| format!("channels loopback state lock poisoned: {e}"))
    }

    /// Ids start at 1, so 0 is never a live attempt.
    fn mint_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn insert(&self, listener: ActiveListener) -> Result<(), String> {
        self.lock()?.insert(listener.id, listener);
        Ok(())
    }

    fn take(&self, id: u64) -> Result<Option<ActiveListener>, String> {
        Ok(self.lock()?.remove(&id))
    }
}

/// What `start_channels_loopback` hands back: the port the connect request
/// names, and the id `cancel_channels_loopback` acts on.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelsLoopbackStart {
    port: u16,
    attempt_id: u64,
}

/// `127.0.0.1` only: the gateway redirects to that literal address, so no
/// browser resolves a name to `::1` on the way back.
async fn bind_ephemeral() -> Result<BoundSockets, String> {
    let v4 = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("could not bind a Slack return listener: {e}"))?;
    let port = v4
        .local_addr()
        .map_err(|e| format!("could not read the Slack return port: {e}"))?
        .port();
    Ok(BoundSockets { v4, v6: None, port })
}

/// Bind a listener that waits up to ten minutes for the gateway's redirect
/// carrying `expected_state`, then emits the Channels link and focuses the app.
#[tauri::command(rename_all = "snake_case")]
pub async fn start_channels_loopback(
    app: AppHandle,
    state: State<'_, ChannelsLoopbackState>,
    expected_state: String,
) -> Result<ChannelsLoopbackStart, String> {
    if !is_valid_state(&expected_state) {
        return Err("The Slack return state must be a 16-128 character nonce.".into());
    }
    let sockets = bind_ephemeral().await?;
    let port = sockets.port;
    let attempt_id = state.mint_id();
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let (freed_tx, freed_rx) = oneshot::channel::<()>();
    // Registered before the task starts, so a listener that ends at once still
    // finds its own entry to release.
    state.insert(ActiveListener {
        id: attempt_id,
        cancel: cancel_tx,
        freed: freed_rx,
    })?;
    tracing::info!("[channels-loopback] attempt {attempt_id} listening on 127.0.0.1:{port}");
    spawn_listener(ListenerTask {
        app,
        route: &SLACK,
        sockets,
        attempt_id,
        expected_state,
        cancel_rx,
        freed_tx,
    });
    Ok(ChannelsLoopbackStart { port, attempt_id })
}

/// Free a Slack listener whose connect never reached the browser. A no-op for
/// an id that already ended.
#[tauri::command(rename_all = "snake_case")]
pub fn cancel_channels_loopback(
    state: State<'_, ChannelsLoopbackState>,
    attempt_id: u64,
) -> Result<(), String> {
    match state.take(attempt_id)? {
        Some(listener) => {
            if listener.cancel.send(()).is_err() {
                tracing::debug!("[channels-loopback] cancel {attempt_id}: listener already ended");
            }
        }
        None => tracing::debug!("[channels-loopback] cancel {attempt_id}: no such listener"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loopback_util::split_target;
    use crate::oauth_loopback::callback::{decide, CallbackDecision, CALLBACK_PATH};

    const STATE: &str = "q9X-_3abcDEF4567";

    #[test]
    fn the_slack_return_is_accepted_only_with_its_own_state() {
        let (path, query) = split_target("/channels/slack?state=q9X-_3abcDEF4567&slack=Tk7.t_~9");
        assert_eq!(path, SLACK_PATH);
        assert_eq!(decide(query, STATE), CallbackDecision::Accept);
        assert_eq!(
            decide("state=someone-elses-nonce&slack=Tk7", STATE),
            CallbackDecision::Stale
        );
        assert_eq!(decide("slack=Tk7", STATE), CallbackDecision::Stale);
    }

    #[test]
    fn the_slack_and_sign_in_paths_never_overlap() {
        assert_ne!(SLACK.path, CALLBACK_PATH);
        assert_eq!(SLACK.timeout, Duration::from_secs(600));
    }

    #[test]
    fn the_event_payload_is_the_channels_link_with_the_ticket() {
        assert_eq!(
            channels_deep_link("state=q9X-_3abcDEF4567&slack=Tk7-ticket.value_~9"),
            "houston://settings/channels?slack=Tk7-ticket.value_~9"
        );
        assert_eq!(
            channels_deep_link("state=q9X-_3abcDEF4567"),
            "houston://settings/channels"
        );
        assert!(crate::auth::is_channels_settings_deep_link(
            &channels_deep_link("slack=Tk7")
        ));
    }

    #[test]
    fn only_a_gateway_shaped_nonce_is_a_valid_state() {
        assert!(is_valid_state(STATE));
        assert!(is_valid_state(&"a".repeat(128)));
        assert!(!is_valid_state(""));
        assert!(!is_valid_state("short-nonce"));
        assert!(!is_valid_state(&"a".repeat(129)));
        assert!(!is_valid_state("q9X-_3abcDEF456="));
        assert!(!is_valid_state("q9X-_3abcDEF 4567"));
    }

    fn listener(id: u64) -> (ActiveListener, oneshot::Receiver<()>) {
        let (cancel, cancel_rx) = oneshot::channel::<()>();
        let (_freed_tx, freed) = oneshot::channel::<()>();
        (ActiveListener { id, cancel, freed }, cancel_rx)
    }

    #[test]
    fn attempts_are_kept_side_by_side_and_taken_by_id() {
        let state = ChannelsLoopbackState::default();
        assert_eq!(state.mint_id(), 1);
        assert_eq!(state.mint_id(), 2);
        let (first, _rx1) = listener(1);
        let (second, _rx2) = listener(2);
        state.insert(first).unwrap();
        state.insert(second).unwrap();
        assert_eq!(state.take(1).unwrap().map(|l| l.id), Some(1));
        assert!(state.take(1).unwrap().is_none());
        assert_eq!(state.take(2).unwrap().map(|l| l.id), Some(2));
    }

    #[tokio::test]
    async fn the_listener_binds_an_os_assigned_ipv4_port() {
        let sockets = bind_ephemeral().await.expect("bind");
        assert!(sockets.port >= 1024);
        assert!(sockets.v6.is_none());
        let client = tokio::net::TcpStream::connect(("127.0.0.1", sockets.port)).await;
        assert!(client.is_ok(), "the IPv4 loopback accepts");
    }
}
