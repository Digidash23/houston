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
    assert_eq!(SLACK.timeout, Duration::from_secs(720));
}

#[test]
fn the_event_payload_is_the_channels_link_with_the_ticket() {
    assert_eq!(
        channels_deep_link("slack=Tk7-ticket.value_~9&state=q9X-_3abcDEF4567"),
        Some("houston://settings/channels?slack=Tk7-ticket.value_~9".to_string())
    );
    let link = channels_deep_link("slack=Tk7").expect("one ticket");
    assert!(crate::auth::is_channels_settings_deep_link(&link));
}

#[test]
fn a_return_without_exactly_one_ticket_gets_the_stale_page() {
    assert_eq!(channels_deep_link("state=q9X-_3abcDEF4567"), None);
    assert_eq!(channels_deep_link("slack=&state=q9X-_3abcDEF4567"), None);
    assert_eq!(channels_deep_link("slack=Tk7&slack=Tk8&state=q9X"), None);
    assert_eq!(channels_deep_link("slacker=Tk7&state=q9X"), None);
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

#[tokio::test]
async fn the_listener_binds_an_os_assigned_ipv4_port() {
    let sockets = bind_ephemeral().await.expect("bind");
    assert!(sockets.port >= 1024);
    assert!(sockets.v6.is_none());
    let client = tokio::net::TcpStream::connect(("127.0.0.1", sockets.port)).await;
    assert!(client.is_ok(), "the IPv4 loopback accepts");
}
