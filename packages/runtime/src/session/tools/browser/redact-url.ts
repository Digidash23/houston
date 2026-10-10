/**
 * Query names that carry a secret: a sign-in form that submits by GET puts
 * the password in the address, and OAuth returns codes and tokens there.
 */
const SECRET_NAME = /pass|pwd|otp|code|token|secret|key/i;

export const HIDDEN = "[hidden]";

function redactParams(params: string): string {
  return params
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return SECRET_NAME.test(safeDecode(name)) ? `${name}=${HIDDEN}` : pair;
    })
    .join("&");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // Malformed escapes: judge the name as written.
    return value;
  }
}

/**
 * The address as the model, the chat and the live view may show it: values
 * of secret-looking query (and fragment) parameters and any userinfo password
 * replaced by `[hidden]`. Anything that is not an absolute URL is unchanged.
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
  const href = url.href;
  const rest = href.slice(0, href.length - url.search.length - url.hash.length);
  const search = url.search ? `?${redactParams(url.search.slice(1))}` : "";
  const hash = url.hash.includes("=")
    ? `#${redactParams(url.hash.slice(1))}`
    : url.hash;
  return `${rest}${search}${hash}`;
}
