//! The Slack return pages' copy, translated in the webview and passed to
//! `start_channels_loopback`.

use crate::oauth_loopback::pages::{page, LoopbackPages, PageLang};

/// The Slack return's copy, translated in the webview. The success page says
/// the app is finishing, never "connected": the binding happens only when the
/// app redeems the ticket, and that can still fail.
#[derive(serde::Deserialize)]
pub struct PageCopy {
    heading: String,
    body: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackReturnCopy {
    /// The webview's language, which the copy is written in.
    lang: PageLang,
    success: PageCopy,
    stale: PageCopy,
    open_button: String,
}

/// The heading doubles as the tab title.
pub(super) fn slack_pages(copy: &SlackReturnCopy) -> LoopbackPages {
    let SlackReturnCopy {
        lang,
        success,
        stale,
        open_button,
    } = copy;
    LoopbackPages {
        success: page(
            *lang,
            &success.heading,
            &success.heading,
            &success.body,
            Some(open_button.as_str()),
        ),
        stale: page(*lang, &stale.heading, &stale.heading, &stale.body, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(heading: &str) -> SlackReturnCopy {
        SlackReturnCopy {
            lang: PageLang::En,
            success: PageCopy {
                heading: heading.into(),
                body: "Houston is finishing your Slack connection. You can close this tab.".into(),
            },
            stale: PageCopy {
                heading: "This Slack link has expired".into(),
                body: "It came from an earlier attempt to connect Slack.".into(),
            },
            open_button: "Abrir Houston".into(),
        }
    }

    #[test]
    fn the_slack_pages_use_the_passed_copy_and_never_claim_a_connection() {
        let pages = slack_pages(&copy("Return to Houston"));
        assert!(pages.success.contains("<title>Return to Houston</title>"));
        assert!(pages.success.contains("<h1>Return to Houston</h1>"));
        assert!(pages
            .success
            .contains(r#"<a class="btn" href="houston://open">Abrir Houston</a>"#));
        assert!(!pages.success.contains("connected"));
        assert!(pages.stale.contains("<h1>This Slack link has expired</h1>"));
        assert!(!pages.stale.contains("houston://open"));
    }

    #[test]
    fn the_passed_copy_is_html_escaped() {
        let pages = slack_pages(&copy("<b>Houston</b> & Slack"));
        assert!(pages
            .success
            .contains("<h1>&lt;b&gt;Houston&lt;/b&gt; &amp; Slack</h1>"));
    }

    fn from_webview(lang: &str) -> SlackReturnCopy {
        serde_json::from_str(&format!(
            r#"{{"lang":"{lang}","success":{{"heading":"a","body":"b"}},"stale":{{"heading":"c","body":"d"}},"openButton":"e"}}"#
        ))
        .expect("the shape osStartChannelsLoopback sends")
    }

    #[test]
    fn the_webview_copy_deserializes_from_its_camel_case_shape() {
        let copy = from_webview("pt");
        assert_eq!(copy.lang, PageLang::Pt);
        assert_eq!(copy.open_button, "e");
        assert_eq!(copy.stale.body, "d");
    }

    #[test]
    fn both_pages_declare_the_copy_language() {
        let pages = slack_pages(&from_webview("es"));
        assert!(pages
            .success
            .starts_with("<!DOCTYPE html>\n<html lang=\"es\">\n"));
        assert!(pages
            .stale
            .starts_with("<!DOCTYPE html>\n<html lang=\"es\">\n"));
    }

    #[test]
    fn a_language_the_app_does_not_ship_renders_as_english() {
        let pages = slack_pages(&from_webview("fr"));
        assert!(pages
            .success
            .starts_with("<!DOCTYPE html>\n<html lang=\"en\">\n"));
        assert!(pages
            .stale
            .starts_with("<!DOCTYPE html>\n<html lang=\"en\">\n"));
    }
}
