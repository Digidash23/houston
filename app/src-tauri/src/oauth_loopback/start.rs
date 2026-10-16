//! What `start_oauth_loopback` answers the frontend.

/// What `start_oauth_loopback` hands back to the frontend.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LoopbackStart {
    /// A listener is bound and waiting for this attempt's redirect.
    #[serde(rename_all = "camelCase")]
    Listening {
        /// The `redirect_uri` the frontend gives the provider (the `127.0.0.1`
        /// spelling; the brokered flow derives its `localhost` continueUri from
        /// `port` instead).
        redirect_uri: String,
        /// The bound loopback port. Both `127.0.0.1` and `::1` listen on it.
        port: u16,
        /// Identifies this listener; `cancel_oauth_loopback` only acts on a match.
        attempt_id: u64,
    },
    /// A NEWER sign-in click already owns the loopback, so this (older)
    /// invocation bound nothing and released anything it had. The frontend
    /// treats it as a benign supersession — no error, no session: the newer
    /// attempt is the one the user is actually watching.
    Superseded,
    /// The requested `exact_port` is held by a foreign process (only produced
    /// when `exact_port` was given). NOT an error: the GCIP-brokered caller
    /// minted its authorize URL for that one port, so it re-mints for the next
    /// candidate and asks again.
    PortBusy,
}
