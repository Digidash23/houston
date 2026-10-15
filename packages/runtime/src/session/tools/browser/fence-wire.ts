import { parseAuthority } from "./fence-target";

/** A proxy request's head, read off the browser's connection. */
export type ProxyRequest =
  /** `CONNECT host:port`: a tunnel (https, wss, ws). */
  | { kind: "connect"; host: string; port: number }
  /**
   * An absolute-form plain-http request, re-written for the origin server:
   * origin-form path, the proxy headers dropped, `Host` taken from the
   * request target (RFC 9112 3.2.2), `Connection: close` so the tunnel that
   * carries it ends with the one response.
   */
  | {
      kind: "forward";
      host: string;
      port: number;
      head: Buffer;
      /** The request body's exact length (Content-Length, else none). */
      bodyLength: number;
    }
  /** A body of unknown length (chunked): the proxy cannot frame it. */
  | { kind: "length_required" }
  | { kind: "malformed" };

/** A head this long without its blank line is not a browser's request. */
export const MAX_HEAD_BYTES = 64 * 1024;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "upgrade",
]);

/**
 * One well-formed field line: a token name, the colon right after it, a value
 * with no CR, LF or NUL. That refuses obs-fold (a line opening with
 * whitespace), bare CR or LF smuggled inside a line, whitespace before the
 * colon and lines with no colon at all (RFC 9112 5.1, 5.2).
 */
const FIELD_LINE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[^\r\n\0]*$/;

/**
 * A request line: the method is any RFC 9110 token, case kept (fetch sends
 * `patch` lowercase; WebDAV has `VERSION-CONTROL`).
 */
const REQUEST_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+) (\S+) HTTP\/1\.[01]$/;

/** Where the head ends (after its blank line), or -1 while it is incomplete. */
export function headEnd(buffered: Buffer): number {
  const at = buffered.indexOf("\r\n\r\n");
  return at === -1 ? -1 : at + 4;
}

export function parseProxyRequest(head: Buffer): ProxyRequest {
  const [line = "", ...fields] = head
    .toString("latin1")
    .slice(0, -4)
    .split("\r\n");
  const match = REQUEST_LINE.exec(line);
  if (!match?.[1] || !match[2]) return { kind: "malformed" };
  const [, method, target] = match;
  if (method === "CONNECT") {
    const authority = parseAuthority(target);
    return authority
      ? { kind: "connect", ...authority }
      : { kind: "malformed" };
  }
  if (!/^http:\/\//i.test(target) || !URL.canParse(target))
    return { kind: "malformed" };
  const url = new URL(target);
  if (!fields.every((field) => FIELD_LINE.test(field)))
    return { kind: "malformed" };
  const nameOf = (field: string) =>
    field.slice(0, field.indexOf(":")).toLowerCase();
  const valuesOf = (name: string) =>
    fields
      .filter((f) => nameOf(f) === name)
      .map((f) => f.slice(f.indexOf(":") + 1).trim());
  if (valuesOf("transfer-encoding").length > 0)
    return { kind: "length_required" };
  const lengths = new Set(valuesOf("content-length"));
  const [length = "0"] = lengths;
  if (lengths.size > 1 || !/^\d{1,15}$/.test(length))
    return { kind: "malformed" };
  // The target names the host: a Host field saying otherwise is dropped.
  const kept = fields.filter((field) => {
    const name = nameOf(field);
    return name !== "host" && !HOP_BY_HOP.has(name);
  });
  const rewritten = [
    `${method} ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    ...kept,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  return {
    kind: "forward",
    host: url.hostname,
    port: Number(url.port || 80),
    head: Buffer.from(rewritten, "latin1"),
    bodyLength: Number(length),
  };
}

/** The header the proxy's own answers carry, so a refusal is recognizable. */
export const FENCE_HEADER = "x-houston-fence";

/** What the proxy itself answers instead of relaying. */
export type ProxyAnswerKind =
  | "refused"
  | "unreachable"
  | "malformed"
  | "length_required";

/** The proxy's own answer: a refusal, or a failure to reach the site. */
export function proxyAnswer(kind: ProxyAnswerKind) {
  const [status, body] = {
    refused: ["403 Forbidden", "This address is not on the public web."],
    unreachable: ["502 Bad Gateway", "The site could not be reached."],
    malformed: ["400 Bad Request", "Bad request."],
    length_required: ["411 Length Required", "Length required."],
  }[kind];
  return [
    `HTTP/1.1 ${status}`,
    `${FENCE_HEADER}: ${kind}`,
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}

export const TUNNEL_OPEN = "HTTP/1.1 200 Connection Established\r\n\r\n";
