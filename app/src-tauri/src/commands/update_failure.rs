//! The wire shapes of the shell's resumable release download
//! (`update_fetch.rs`): the progress events and the typed failure the
//! frontend classifies (`app/src/lib/update-download-failure.ts`), with the
//! constructors that name a failure's class from what the transport said.

use reqwest::StatusCode;
use serde::Serialize;

/// Mirrors the plugin's `DownloadEvent` so the frontend's progress fold
/// (`update-download-progress.ts`) reads both shapes unchanged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// Why a download gave up. `Network` is the transport-shaped class (connect,
/// TLS, timeout, a body cut mid-stream): expected on a bad link, retried here
/// and reported quietly by the frontend. `Upstream` is the release host
/// answering a transient status (a 5xx, 429, 408: PRODUCT-1811), retried the
/// same way and reported quietly too. `Http` is any other status, final on
/// first sight: a 404 is how a leaked staging build surfaces. Everything
/// else is a bug.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadFailureKind {
    Network,
    Upstream,
    Http,
    Signature,
    Other,
}

impl DownloadFailureKind {
    /// The classes the download loop retries instead of surfacing, and whose
    /// partial file is kept for the next call.
    pub fn is_retryable(self) -> bool {
        matches!(self, Self::Network | Self::Upstream)
    }
}

/// A status the release host answers while it is briefly unable to serve:
/// the request may succeed a moment later, so it is retried, and a budget
/// spent on it reports as the host being unavailable, not as a bug.
pub fn is_transient_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_EARLY
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

/// The failure the frontend receives: the class, the message of the LAST
/// attempt, and where the stream stopped, so Sentry shows the byte position.
/// `received` counts the bytes ON DISK, the ones the next call resumes from.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DownloadFailure {
    pub kind: DownloadFailureKind,
    pub message: String,
    pub received: u64,
    pub total: Option<u64>,
    pub attempts: u32,
    /// The status the release host answered, for the `Upstream` and `Http`
    /// classes; the frontend tags the Sentry event with it.
    pub status: Option<u16>,
}

impl DownloadFailure {
    pub fn other(message: impl Into<String>) -> Self {
        Self::stopped(DownloadFailureKind::Other, message, 0, None)
    }

    /// Where the stream stopped, in the class the caller names.
    pub fn stopped(
        kind: DownloadFailureKind,
        message: impl Into<String>,
        received: u64,
        total: Option<u64>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            received,
            total,
            attempts: 0,
            status: None,
        }
    }

    /// A `reqwest` error, classified by its transport shape.
    pub fn transport(err: &reqwest::Error, received: u64, total: Option<u64>) -> Self {
        let kind = if err.is_connect()
            || err.is_timeout()
            || err.is_request()
            || err.is_body()
            || err.is_decode()
        {
            DownloadFailureKind::Network
        } else {
            DownloadFailureKind::Other
        };
        Self::stopped(kind, err.to_string(), received, total)
    }

    /// A status answer: a transient one is `Upstream`, the rest `Http`.
    pub fn status(status: StatusCode, received: u64, total: Option<u64>) -> Self {
        let kind = if is_transient_status(status) {
            DownloadFailureKind::Upstream
        } else {
            DownloadFailureKind::Http
        };
        Self {
            status: Some(status.as_u16()),
            ..Self::stopped(
                kind,
                format!("Download request failed with status: {status}"),
                received,
                total,
            )
        }
    }

    /// The release host answered a range request with bytes that cannot be
    /// joined to the partial; the file was reset and the retry starts over.
    pub fn range_reset(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status: Some(status.as_u16()),
            ..Self::stopped(DownloadFailureKind::Upstream, message, 0, None)
        }
    }

    pub fn signature(message: String, len: u64) -> Self {
        Self::stopped(
            DownloadFailureKind::Signature,
            format!("release signature did not verify: {message}"),
            len,
            Some(len),
        )
    }
}
