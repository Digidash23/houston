//! The typed failure `report_bug` rejects with (H-009, HOUSTON-APP-5FT).
//!
//! The command used to reject with Linear's bare message, so a workspace at
//! its plan's issue cap ("usage limit exceeded") read exactly like a broken
//! build: the frontend filed a per-user Sentry error with none of the
//! person's words and told them to try again, which could not work until
//! someone freed quota by hand. `IntakeUnavailable` names that operator-side
//! state (plan cap, rate limit, Linear down); the frontend
//! (`app/src/lib/bug-report-failure.ts`) delivers the report through its
//! fallback channel instead and reports the refusal as a quiet class.

use reqwest::StatusCode;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BugReportFailureKind {
    /// Linear is refusing every report for a reason on OUR side: the
    /// workspace's issue quota, a rate limit, or a Linear outage.
    IntakeUnavailable,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BugReportFailure {
    pub kind: BugReportFailureKind,
    /// The raw diagnostic: logged and reported, never shown to the user.
    pub message: String,
}

impl BugReportFailure {
    pub fn other(message: impl Into<String>) -> Self {
        Self {
            kind: BugReportFailureKind::Other,
            message: message.into(),
        }
    }

    pub fn new(kind: BugReportFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl From<String> for BugReportFailure {
    fn from(message: String) -> Self {
        Self::other(message)
    }
}

impl std::fmt::Display for BugReportFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Markers of Linear refusing on quota or rate grounds, matched lowercase
/// against an error's message and its `extensions` (`type`, `code`,
/// `userPresentableMessage`). Linear's plan cap answers "usage limit
/// exceeded" (and "exceeded the free issue limit" in the app); its rate
/// limiter answers code `RATELIMITED`.
const INTAKE_LIMIT_MARKERS: &[&str] = &[
    "usage limit",
    "usage_limit",
    "issue limit",
    "ratelimited",
    "rate limit",
];

pub(super) fn is_intake_limit_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    INTAKE_LIMIT_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

/// A GraphQL error's message plus every string in its `extensions`, so a
/// quota code Linear moves between fields still classifies.
pub(super) fn graphql_error_is_intake_limit(
    message: &str,
    extensions: Option<&serde_json::Value>,
) -> bool {
    if is_intake_limit_text(message) {
        return true;
    }
    let Some(serde_json::Value::Object(fields)) = extensions else {
        return false;
    };
    fields
        .values()
        .filter_map(serde_json::Value::as_str)
        .any(is_intake_limit_text)
}

/// A non-2xx answer: 429 and any 5xx are Linear refusing everyone, the body
/// can still name the quota on a 400.
pub(super) fn kind_for_http(status: StatusCode, body: &str) -> BugReportFailureKind {
    if status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
        || is_intake_limit_text(body)
    {
        BugReportFailureKind::IntakeUnavailable
    } else {
        BugReportFailureKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_limit_message_is_intake_unavailable() {
        assert!(graphql_error_is_intake_limit("usage limit exceeded", None));
        assert!(graphql_error_is_intake_limit(
            "You've exceeded the free issue limit",
            None
        ));
    }

    #[test]
    fn extensions_code_classifies_a_generic_message() {
        let ext = serde_json::json!({ "code": "RATELIMITED", "statusCode": 400 });
        assert!(graphql_error_is_intake_limit("Request failed", Some(&ext)));
        let ext = serde_json::json!({ "type": "usage limit exceeded" });
        assert!(graphql_error_is_intake_limit("Forbidden", Some(&ext)));
    }

    #[test]
    fn ordinary_graphql_errors_are_other() {
        let ext = serde_json::json!({ "code": "INVALID_INPUT" });
        assert!(!graphql_error_is_intake_limit(
            "teamId is invalid",
            Some(&ext)
        ));
        assert!(!graphql_error_is_intake_limit("permission denied", None));
    }

    #[test]
    fn http_rate_limit_and_outage_are_intake_unavailable() {
        assert_eq!(
            kind_for_http(StatusCode::TOO_MANY_REQUESTS, ""),
            BugReportFailureKind::IntakeUnavailable
        );
        assert_eq!(
            kind_for_http(StatusCode::BAD_GATEWAY, ""),
            BugReportFailureKind::IntakeUnavailable
        );
        assert_eq!(
            kind_for_http(
                StatusCode::BAD_REQUEST,
                "{\"errors\":[{\"message\":\"usage limit exceeded\"}]}"
            ),
            BugReportFailureKind::IntakeUnavailable
        );
        assert_eq!(
            kind_for_http(StatusCode::UNAUTHORIZED, "bad key"),
            BugReportFailureKind::Other
        );
    }

    #[test]
    fn serializes_snake_case_kind() {
        let json = serde_json::to_string(&BugReportFailure::new(
            BugReportFailureKind::IntakeUnavailable,
            "Linear API returned GraphQL errors: usage limit exceeded",
        ))
        .unwrap();
        assert_eq!(
            json,
            r#"{"kind":"intake_unavailable","message":"Linear API returned GraphQL errors: usage limit exceeded"}"#
        );
    }
}
