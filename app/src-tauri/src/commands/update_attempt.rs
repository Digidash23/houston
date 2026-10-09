//! One request of the resumable release download (`update_fetch`): resume
//! the persisted partial from its length with `Range` + `If-Range`, or fetch
//! a fresh body, and stream what comes back into the file. The loop around it
//! decides whether an outcome is retried; this module decides what the
//! server's answer means for the bytes already on disk.

use super::update_failure::{
    is_transient_status, DownloadEvent, DownloadFailure, DownloadFailureKind,
};
use super::update_partial::{PartialDownload, Sidecar};
use futures_util::StreamExt;
use reqwest::header::{
    HeaderMap, HeaderValue, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE,
};
use reqwest::{Client, StatusCode, Url};

/// What a later `If-Range` names: a strong `ETag`, else `Last-Modified`. A
/// weak ETag (`W/"..."`) cannot condition a range request and is skipped.
fn validator_of(headers: &HeaderMap) -> Option<String> {
    let etag = headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with('"'));
    etag.or_else(|| headers.get(LAST_MODIFIED).and_then(|v| v.to_str().ok()))
        .map(str::to_string)
}

/// The first byte a 206 body starts at (`Content-Range: bytes N-M/T`).
fn content_range_start(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(CONTENT_RANGE)?.to_str().ok()?;
    value
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .trim()
        .parse()
        .ok()
}

pub(super) fn io_failure(context: &str, err: std::io::Error) -> DownloadFailure {
    DownloadFailure::other(format!("{context}: {err}"))
}

pub(super) enum AttemptOutcome {
    Done,
    Retry(DownloadFailure),
}

/// Reset the partial and ask the loop to start over: the server's answer
/// cannot be joined to the bytes on disk.
async fn restart_after(
    partial: &mut PartialDownload,
    status: StatusCode,
    message: String,
) -> Result<AttemptOutcome, DownloadFailure> {
    partial
        .restart(None)
        .await
        .map_err(|e| io_failure("reset partial download", e))?;
    Ok(AttemptOutcome::Retry(DownloadFailure::range_reset(
        status, message,
    )))
}

/// One request: resume `partial` from its length, or fetch a fresh body.
/// Emits `Started` on a fresh (or restarted) body and `Progress` per chunk.
pub(super) async fn attempt(
    client: &Client,
    url: &Url,
    headers: &HeaderMap,
    partial: &mut PartialDownload,
    on_event: &mut (dyn FnMut(DownloadEvent) + Send),
) -> Result<AttemptOutcome, DownloadFailure> {
    let offset = partial.len();
    let total = partial.total();
    if matches!(total, Some(total) if offset >= total) {
        // An earlier call received everything and stopped before the check.
        return Ok(AttemptOutcome::Done);
    }
    let mut request = client.get(url.clone()).headers(headers.clone());
    let resuming = offset > 0;
    if resuming {
        request = request.header(RANGE, format!("bytes={offset}-"));
        if let Some(value) = partial
            .validator()
            .and_then(|v| HeaderValue::from_str(v).ok())
        {
            request = request.header(IF_RANGE, value);
        }
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => {
            return Ok(AttemptOutcome::Retry(DownloadFailure::transport(
                &err, offset, total,
            )))
        }
    };
    let status = response.status();
    match status {
        StatusCode::PARTIAL_CONTENT if resuming => {
            let start = content_range_start(response.headers());
            if start != Some(offset) {
                let message = format!("server resumed at {start:?}, the partial ends at {offset}");
                return restart_after(partial, status, message).await;
            }
        }
        StatusCode::RANGE_NOT_SATISFIABLE if resuming => {
            let message = format!("server has no byte {offset} to resume from");
            return restart_after(partial, status, message).await;
        }
        StatusCode::OK => {
            // A fresh body, a server that ignored the range, or a re-published
            // asset the `If-Range` no longer matched: start over.
            let sidecar = Sidecar {
                url: url.to_string(),
                validator: validator_of(response.headers()),
                total: response.content_length(),
            };
            partial
                .restart(Some(sidecar))
                .await
                .map_err(|e| io_failure("restart partial download", e))?;
            on_event(DownloadEvent::Started {
                content_length: partial.total(),
            });
        }
        status if is_transient_status(status) => {
            return Ok(AttemptOutcome::Retry(DownloadFailure::status(
                status, offset, total,
            )))
        }
        status => return Err(DownloadFailure::status(status, offset, total)),
    }
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                let failure = DownloadFailure::transport(&err, partial.len(), partial.total());
                return Ok(AttemptOutcome::Retry(failure));
            }
        };
        partial
            .append(&chunk)
            .await
            .map_err(|e| io_failure("write partial download", e))?;
        on_event(DownloadEvent::Progress {
            chunk_length: chunk.len(),
        });
    }
    if let Some(total) = partial.total() {
        if partial.len() < total {
            // The server closed the stream early without an error frame.
            return Ok(AttemptOutcome::Retry(DownloadFailure::stopped(
                DownloadFailureKind::Network,
                format!("stream ended at {} of {total} bytes", partial.len()),
                partial.len(),
                Some(total),
            )));
        }
    }
    Ok(AttemptOutcome::Done)
}
