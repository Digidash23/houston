//! Shared HTTP plumbing for the one-shot localhost loopback listeners used by
//! the browser-based OAuth flows.
//!
//! Both the GCIP/Google sign-in loopback (`oauth_loopback.rs`) and the
//! OpenAI Codex loopback (`codex_oauth_loopback.rs`) accept a single browser
//! redirect on `127.0.0.1`, read only the HTTP request line, and reply with a
//! tiny self-contained page. The request-line parsing and response writing are
//! identical, so they live here and both listeners call in.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Read just the HTTP request line and pull out the request target
/// (`/auth/callback?code=...`). We only need the first line, so stop as soon
/// as we've seen a `\r\n`.
pub async fn read_request_target(stream: &mut TcpStream) -> Result<String, String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            return Err("connection closed before request line".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(2).position(|w| w == b"\r\n") {
            let line = String::from_utf8_lossy(&buf[..pos]);
            let mut parts = line.split_whitespace();
            let _method = parts.next().ok_or("empty request line")?;
            let target = parts.next().ok_or("request line had no target")?;
            return Ok(target.to_string());
        }
        if buf.len() > 8192 {
            return Err("request line too long".into());
        }
    }
}

/// [`read_request_target`], bounded: a connection that has not sent its
/// request line within `limit` is an error, so it cannot hold a listener that
/// serves one connection at a time.
pub async fn read_request_target_within(
    stream: &mut TcpStream,
    limit: Duration,
) -> Result<String, String> {
    tokio::time::timeout(limit, read_request_target(stream))
        .await
        .map_err(|_| format!("no request line within {}ms", limit.as_millis()))?
}

/// Split a request target into its `(path, query)` halves. The query is
/// everything after the first `?` (empty when there is none), returned raw so
/// the caller can forward it verbatim to the webview.
pub fn split_target(target: &str) -> (&str, &str) {
    match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    }
}

/// Write a complete HTTP/1.1 response and close the connection. The request URL
/// carries a one-time code or ticket, so the page is never cached and never
/// sends that URL on as a referrer.
pub async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {len}\r\n\
         Cache-Control: no-store\r\n\
         Referrer-Policy: no-referrer\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.len(),
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|e| format!("write failed: {e}"))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    async fn pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let client = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        let (server, _) = listener.accept().await.expect("accept");
        (client, server)
    }

    #[tokio::test]
    async fn an_idle_connection_times_out_instead_of_holding_the_listener() {
        let (_client, mut server) = pair().await;
        let err = read_request_target_within(&mut server, Duration::from_millis(50))
            .await
            .expect_err("an idle socket never sends a request line");
        assert_eq!(err, "no request line within 50ms");
    }

    #[tokio::test]
    async fn a_prompt_request_line_is_read_within_the_limit() {
        let (mut client, mut server) = pair().await;
        client
            .write_all(b"GET /channels/slack?state=s HTTP/1.1\r\n\r\n")
            .await
            .expect("write");
        let target = read_request_target_within(&mut server, Duration::from_secs(5)).await;
        assert_eq!(target, Ok("/channels/slack?state=s".to_string()));
    }

    #[tokio::test]
    async fn a_response_is_never_cached_and_sends_no_referrer() {
        let (mut client, mut server) = pair().await;
        write_response(&mut server, "200 OK", "<p>ok</p>")
            .await
            .expect("write");
        drop(server);
        let mut raw = String::new();
        client.read_to_string(&mut raw).await.expect("read");
        assert_eq!(
            raw,
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 9\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n<p>ok</p>"
        );
    }

    #[test]
    fn split_target_extracts_query() {
        let (path, query) = split_target("/auth/callback?code=abc123&state=xyz");
        assert_eq!(path, "/auth/callback");
        assert_eq!(query, "code=abc123&state=xyz");
    }

    #[test]
    fn split_target_empty_query_when_no_question_mark() {
        let (path, query) = split_target("/favicon.ico");
        assert_eq!(path, "/favicon.ico");
        assert_eq!(query, "");
    }
}
