use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::failure::{
    graphql_error_is_intake_limit, kind_for_http, BugReportFailure, BugReportFailureKind,
};

pub(super) async fn post_graphql<T, V>(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    query: &'static str,
    variables: V,
) -> Result<T, BugReportFailure>
where
    T: DeserializeOwned,
    V: Serialize,
{
    let request = LinearGraphqlRequest { query, variables };
    let response = client
        .post(api_url)
        .header("Authorization", api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| BugReportFailure::other(format!("Linear API request failed: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|e| format!("could not read Linear response body: {e}"));
        let message = linear_http_error_message(status, &body);
        tracing::warn!(%message, "Linear API request failed");
        return Err(BugReportFailure::new(kind_for_http(status, &body), message));
    }

    let body = response
        .json::<LinearGraphqlResponse<T>>()
        .await
        .map_err(|e| {
            BugReportFailure::other(format!("Linear API response was not valid JSON: {e}"))
        })?;

    if let Some(errors) = body.errors.as_deref().filter(|errors| !errors.is_empty()) {
        let message = linear_graphql_error_message(errors);
        tracing::warn!(%message, "Linear API request returned GraphQL errors");
        return Err(BugReportFailure::new(graphql_errors_kind(errors), message));
    }

    body.data
        .ok_or_else(|| BugReportFailure::other("Linear API response did not include data"))
}

#[derive(Serialize)]
struct LinearGraphqlRequest<V> {
    query: &'static str,
    variables: V,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinearGraphqlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<LinearGraphqlError>>,
}

#[derive(Deserialize)]
pub(super) struct LinearGraphqlError {
    pub(super) message: String,
    /// Linear's machine-readable side (`type`, `code`, `userError`,
    /// `userPresentableMessage`): where a quota refusal names itself.
    #[serde(default)]
    pub(super) extensions: Option<serde_json::Value>,
}

pub(super) fn graphql_errors_kind(errors: &[LinearGraphqlError]) -> BugReportFailureKind {
    if errors
        .iter()
        .any(|error| graphql_error_is_intake_limit(&error.message, error.extensions.as_ref()))
    {
        BugReportFailureKind::IntakeUnavailable
    } else {
        BugReportFailureKind::Other
    }
}

pub(super) fn linear_http_error_message(status: StatusCode, body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return format!("Linear API failed: {status}");
    }
    format!(
        "Linear API failed: {status} {}",
        super::format::truncate_chars(trimmed, 160)
    )
}

pub(super) fn linear_graphql_error_message(errors: &[LinearGraphqlError]) -> String {
    let detail = errors
        .iter()
        .map(|error| error.message.trim())
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    if detail.is_empty() {
        "Linear API returned an unknown GraphQL error".to_string()
    } else {
        format!(
            "Linear API returned GraphQL errors: {}",
            super::format::truncate_chars(&detail, 180)
        )
    }
}
