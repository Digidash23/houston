import {
  type ConversationOp,
  parseConversationOp,
} from "./op-grammar-conversation";
import {
  type CustomOAuthOp,
  parseCustomOAuthOp,
} from "./op-grammar-custom-oauth";
import { str } from "./op-grammar-fields";
import { type MigrateOp, parseMigrateOp } from "./op-grammar-migrate";
import { parseReconcileOp, type ReconcileOp } from "./op-grammar-reconcile";
import { parseSeedOp, type SeedOp } from "./op-grammar-seed";
import { parseSettingsOp, type SettingsOp } from "./op-grammar-settings";
import {
  isBinaryBodyOpRoute,
  isOpRoute,
  isReadOpRoute,
} from "./op-route-allowlist";

/**
 * The op grammar: every operation shape a pool worker will run for a
 * sleeping agent, and the strict parser that admits it (parse-op-request.ts
 * owns the surrounding claim/credential envelope). `route` ops run the
 * host's own route handlers against the hydrated workspace; the other kinds
 * are the runtime's own.
 */
export type AgentOp =
  | {
      kind: "route";
      method: string;
      rest: string;
      /** Raw query string without the `?` (files routes take `?path=`). */
      query?: string;
      body?: string;
      /** Binary request body (a migration zip), base64 — a JSON envelope
       *  cannot carry raw bytes. Mutually exclusive with `body`. */
      bodyBase64?: string;
      contentType?: string;
    }
  | { kind: "title"; text: string }
  | SettingsOp
  | {
      kind: "credential";
      action: "api-key";
      provider: string;
      apiKey: string;
      /** Azure OpenAI's per-resource endpoint, arriving with the key. */
      endpoint?: string;
    }
  | ConversationOp
  | { kind: "first-day"; body: string }
  | CustomOAuthOp
  | SeedOp
  | MigrateOp
  | ReconcileOp;

export { ID, str } from "./op-grammar-fields";

export function parseAgentOp(raw: Record<string, unknown>): AgentOp {
  switch (raw.kind) {
    case "custom-oauth":
      return parseCustomOAuthOp(raw);
    case "route":
      return parseRouteOp(raw);
    case "title":
      return { kind: "title", text: str(raw.text, "op.text") };
    case "settings":
      return parseSettingsOp(raw);
    case "credential": {
      if (raw.action !== "api-key") throw new Error("invalid 'op.action'");
      return {
        kind: "credential",
        action: "api-key",
        provider: str(raw.provider, "op.provider"),
        apiKey: str(raw.apiKey, "op.apiKey"),
        ...(typeof raw.endpoint === "string" && raw.endpoint
          ? { endpoint: raw.endpoint }
          : {}),
      };
    }
    case "conversation":
      return parseConversationOp(raw);
    case "first-day":
      return {
        kind: "first-day",
        body: typeof raw.body === "string" ? raw.body : "{}",
      };
    case "seed":
      return parseSeedOp(raw);
    case "migrate":
      return parseMigrateOp(raw);
    case "reconcile":
      return parseReconcileOp(raw);
    default:
      throw new Error("invalid 'op.kind'");
  }
}

function parseRouteOp(raw: Record<string, unknown>): AgentOp {
  const method = str(raw.method, "op.method").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error("op.method is not an HTTP method");
  }
  const rest = str(raw.rest, "op.rest");
  if (rest.includes("..") || rest.startsWith("/"))
    throw new Error("invalid 'op.rest'");
  // Defense in depth: the worker accepts only the op-route shapes the
  // gateway classifier dispatches — a valid-token caller cannot reach a
  // handler surface (e.g. POST agentfile) the public path never exposes.
  // Match the DECODED path: the handlers decode, so the allowlist must
  // see what they see (`%2Ehouston` is `.houston`).
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    throw new Error("invalid 'op.rest'");
  }
  if (decoded.includes("..") || decoded.startsWith("/")) {
    throw new Error("invalid 'op.rest'");
  }
  if (!isOpRoute(decoded)) {
    throw new Error("op.rest is not an op route");
  }
  // Reads run as ops only where the gateway has no doc to serve them
  // from: the Files tab and arbitrary agent files.
  if (method === "GET" && !isReadOpRoute(decoded)) {
    throw new Error("op.rest is not a read op route");
  }
  if (typeof raw.bodyBase64 === "string" && !isBinaryBodyOpRoute(decoded)) {
    throw new Error("op.bodyBase64 is not accepted for this route");
  }
  // And the converse: a binary route must never smuggle its payload as a
  // text body — a zip in a UTF-8 string is corrupt.
  if (
    isBinaryBodyOpRoute(decoded) &&
    typeof raw.body === "string" &&
    raw.body.length > 0
  ) {
    throw new Error("this route's body rides 'op.bodyBase64'");
  }
  const query =
    typeof raw.query === "string" && raw.query.length <= 4096
      ? raw.query.replace(/^\?/, "")
      : undefined;
  return {
    kind: "route",
    method,
    rest,
    ...(query ? { query } : {}),
    ...(typeof raw.body === "string" ? { body: raw.body } : {}),
    ...(typeof raw.bodyBase64 === "string"
      ? { bodyBase64: raw.bodyBase64 }
      : {}),
    ...(typeof raw.contentType === "string"
      ? { contentType: raw.contentType }
      : {}),
  };
}
