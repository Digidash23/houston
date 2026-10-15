/**
 * Words that make a parameter name a secret's wherever they appear in it, read
 * in the lowercased name with every separator removed: `newpassword`,
 * `pass1`, `userpass`, `apikey`, `sessionid`, `accesstoken` are all hidden.
 * Fails closed: a harmless name that happens to contain one (`author`,
 * `passport`) is hidden too, unless {@link HARMLESS_NAMES} lists it.
 */
const SECRET_WORDS = [
  "pass", // password, passwd, passcode, passphrase, pass1, userpass
  "pwd",
  "pswd",
  "otp",
  "token",
  "secret",
  "apikey",
  "accesskey",
  "privatekey",
  "signature",
  "ticket",
  "saml",
  "assertion",
  "auth", // oauth, authorization, authcode, author (hidden: fails closed)
  "session", // sessionid, jsessionid
  "sessid", // phpsessid
  "credential",
  "verifier",
  "cookie",
  "jwt", // magic links and SSO hand-backs
  "bearer",
  "pword",
];

/**
 * Short words that are a secret's name only as a whole token of it
 * ({@link nameTokens}): as substrings they are in every other word
 * (`monkey`, `design`, `shipping`, `inside`).
 */
const SECRET_TOKENS = new Set(["key", "sid", "sig", "pin", "pw"]);

/**
 * `code` alone is mostly harmless (`zipcode`, `country_code`, `promo_code`):
 * it is a secret as the whole name (OAuth's `?code=`) or right after one of
 * these (`verificationCode`, `sms-code`, `2facode`).
 */
const SECRET_CODE_AFTER = [
  "auth",
  "authorization",
  "verification",
  "verify",
  "otp",
  "sms",
  "mfa",
  "2fa",
  "login",
  "access",
  "security",
  "confirmation",
  "pin",
  "email",
  "device",
  "recovery",
  "backup",
  "oob", // Firebase oobCode: email sign-in and password reset
  "reset",
  "activation",
  "onetime",
  "invite",
  "confirm",
];

/**
 * Names a secret word matches that are known to carry nothing secret, as the
 * lowercased name without separators. Only names a word above actually hits
 * belong here; when unsure, a name stays hidden.
 */
const HARMLESS_NAMES = new Set([
  "footprint", // otp
  "passenger", // pass
  "passengers",
  "compass",
]);

export const HIDDEN = "[hidden]";

/** `X-Amz-Signature` → x, amz, signature; `SAMLResponse` → saml, response. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function isSecretName(name: string): boolean {
  const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!flat || HARMLESS_NAMES.has(flat)) return false;
  if (SECRET_WORDS.some((word) => flat.includes(word))) return true;
  if (nameTokens(name).some((token) => SECRET_TOKENS.has(token))) return true;
  if (!flat.endsWith("code")) return false;
  const before = flat.slice(0, -"code".length);
  return before === "" || SECRET_CODE_AFTER.some((w) => before.endsWith(w));
}

/** One `name=value` pair, its value hidden when the name is a secret's. */
function redactPair(pair: string): string {
  const eq = pair.indexOf("=");
  if (eq < 0) return pair;
  const name = pair.slice(0, eq);
  if (isSecretName(safeDecode(name))) return `${name}=${HIDDEN}`;
  // An escaped address in a value (`?next=%2Fcb%3Fcode%3DS`) carries its own
  // query: hide inside it too, re-escaping only when something was hidden.
  const value = safeDecode(pair.slice(eq + 1));
  if (!value.includes("=")) return pair;
  const inner = redactParams(value);
  return inner === value ? pair : `${name}=${encodeURIComponent(inner)}`;
}

/**
 * `a=1&b=2`, pair by pair. `?` separates pairs too: a hash-routed app keeps
 * its query in the fragment (`#/callback?code=…`), and an unescaped `?` in a
 * value (`?next=/cb?code=…`) still reads as a pair to the page that gets it.
 */
function redactParams(params: string): string {
  return params
    .split(/([?&])/)
    .map((part) => (part === "?" || part === "&" ? part : redactPair(part)))
    .join("");
}

/** Path matrix parameters (`/app;jsessionid=ABC`), segment by segment. */
function redactPath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      const [head, ...params] = segment.split(";");
      return [head, ...params.map(redactPair)].join(";");
    })
    .join("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // Malformed escapes: judge the name as written.
    return value;
  }
}

/** A `?query` or `#fragment` with its secret values hidden. */
function hidden(part: string, mark: "?" | "#"): string {
  return part.includes("=") ? `${mark}${redactParams(part.slice(1))}` : part;
}

/**
 * The address as the model, the chat and the live view may show it: values
 * of secret-looking query, fragment and path matrix parameters and any
 * userinfo password replaced by `[hidden]`. Anything that is not an absolute
 * URL is unchanged.
 */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // about:blank and its kind parse; anything else holds no query to hide.
    return raw;
  }
  if (url.password) url.password = "hidden";
  // An empty query or fragment (`/p?`, `/p#`) is kept in `href` but reads as
  // "" from `search`/`hash`, so its `?`/`#` is counted here by hand.
  let rest = url.href;
  const hash = url.hash || (rest.endsWith("#") ? "#" : "");
  rest = rest.slice(0, rest.length - hash.length);
  const search = url.search || (rest.endsWith("?") ? "?" : "");
  rest = rest.slice(0, rest.length - search.length);
  const origin = rest.slice(0, rest.length - url.pathname.length);
  const path = url.pathname.includes(";")
    ? redactPath(url.pathname)
    : url.pathname;
  return `${origin}${path}${hidden(search, "?")}${hidden(hash, "#")}`;
}
