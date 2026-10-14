/**
 * Create-only preference writes: `PUT /v1/preferences/:key` with body
 * `{ "value": <v>, "onlyIfAbsent": true }` writes the value only when the key
 * holds none for that org/user (absent, null or blank). When one is stored,
 * nothing is written and the answer is
 * `412 { "code": "preference_exists", "value": <stored> }`. Without the flag
 * the PUT is the ordinary unconditional write.
 *
 * A body field, not an `If-None-Match` header: the gateway's CORS allow-list
 * does not carry that header, so a webview preflight would refuse it. The host
 * and the cloud gateway's preferences handler serve the same contract; the
 * SDK's timezone seed relies on it so an explicit choice always wins and a
 * stale seed can never overwrite one.
 */
export const PREFERENCE_ONLY_IF_ABSENT_FIELD = "onlyIfAbsent";
export const PREFERENCE_EXISTS_STATUS = 412;
export const PREFERENCE_EXISTS_CODE = "preference_exists";
