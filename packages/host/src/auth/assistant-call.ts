/**
 * Whether a request was made BY the AI Manager (PRODUCT-1928), which is what
 * stamps `started_by: "houston"` on a mission it creates.
 *
 * Two deployments, two proofs, never mixed:
 *  - GATEWAY-FRONTED (a managed pod): the gateway, which alone knows the
 *    verified principal is the assistant credential, mints `via: "assistant"`
 *    into the acting-as token. It strips any client acting header, so the pod
 *    may read the claim exactly as it reads `sub` for `created_by`.
 *  - DESKTOP / SELF-HOST: the manager's dispatcher loops back into this same
 *    host with the SAME per-boot bearer the app holds, so the bearer proves
 *    nothing about who called. The dispatcher adds {@link ASSISTANT_CALL_HEADER}
 *    carrying a secret minted in this process instead.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import {
  ACTING_AS_HEADER,
  ACTING_VIA_ASSISTANT,
  actingViaFromHeader,
} from "./acting";

export const ASSISTANT_CALL_HEADER = "x-houston-assistant-call";

// Minted per host process and held only in its memory: never logged, never in
// an env var a spawned runtime inherits, never in a response. It leaves this
// process only on the dispatcher's loopback request to itself, so no app,
// browser or agent can learn it and dress a request up as the manager's.
const PROOF = randomBytes(32).toString("base64url");
const PROOF_BYTES = Buffer.from(PROOF);

/** The header the dispatcher's loopback self-gateway sends. Only that caller. */
export function assistantCallHeaders(): Record<string, string> {
  return { [ASSISTANT_CALL_HEADER]: PROOF };
}

/** True for 127.0.0.0/8, ::1 and their IPv4-mapped form. */
function fromLoopback(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress ?? "";
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) return v4.startsWith("127.");
  return address === "::1";
}

/** Constant-time match against this process's proof, any length refused. */
function carriesProof(req: IncomingMessage): boolean {
  const raw = req.headers[ASSISTANT_CALL_HEADER];
  if (typeof raw !== "string") return false;
  const offered = Buffer.from(raw);
  return (
    offered.length === PROOF_BYTES.length &&
    timingSafeEqual(offered, PROOF_BYTES)
  );
}

/**
 * Whether THIS request was made by the AI Manager. The `via` claim counts
 * ONLY behind the gateway: off it, an acting header is untrusted client input.
 * The proof counts ONLY off the gateway, and only from a loopback peer, since
 * the dispatcher that sends it calls this very host at 127.0.0.1.
 */
export function isAssistantRequest(
  deps: { gatewayFronted?: boolean },
  req: IncomingMessage,
): boolean {
  if (deps.gatewayFronted) {
    return (
      actingViaFromHeader(req.headers[ACTING_AS_HEADER]) ===
      ACTING_VIA_ASSISTANT
    );
  }
  return fromLoopback(req) && carriesProof(req);
}
