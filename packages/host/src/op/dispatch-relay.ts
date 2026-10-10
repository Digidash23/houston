import type { HoustonEvent } from "@houston/protocol";
import { MAX_UPLOAD_BYTES } from "../turn/files-import";
import type { LazyReadRefusedError } from "../vfs";
import type { AgentOpResponse } from "./dispatch";

// Only the handlers' own JSON is safe to carry as text: a downloaded file is
// relayed byte-exact (a Latin-1 CSV through `response.text()` would be
// re-encoded), so every non-JSON body rides base64.
const TEXT_BODY = /^application\/json/i;
const RELAYED_HEADERS = ["content-disposition", "cache-control"] as const;
export const TOO_LARGE_MESSAGE =
  "file too large to fetch while the agent sleeps";
/** A lazy read of sign-in state whose private directory was refused. */
export const PRIVATE_REFUSED_MESSAGE =
  "sign-in state is unavailable while the agent sleeps";
export const PRIVATE_REFUSED_CODE = "private_state_refused";

/**
 * The 503 body for a refused lazy read: a size refusal gives the same answer
 * the relay cap gives; refused sign-in state says so, never "too large".
 */
export function lazyRefusalBody(
  reason: LazyReadRefusedError["reason"],
): string {
  return JSON.stringify(
    reason === "private"
      ? { error: PRIVATE_REFUSED_MESSAGE, code: PRIVATE_REFUSED_CODE }
      : { error: TOO_LARGE_MESSAGE },
  );
}

/** Turn the loopback handler's response into the op envelope's answer. */
export async function relayAgentOpResponse(
  response: Response,
  rest: string,
  events: HoustonEvent[],
): Promise<AgentOpResponse> {
  const contentType =
    response.headers.get("content-type") ?? "application/json";
  const headers: Record<string, string> = {};
  for (const name of RELAYED_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  const relayed = Object.keys(headers).length > 0 ? { headers } : {};
  // A download/archive is always bytes, whatever its MIME (a `.json` file
  // is `application/json` too); everything else is the handler's own JSON.
  const binaryRoute = /^files\/(download|archive)$/.test(rest);
  if (!binaryRoute && TEXT_BODY.test(contentType)) {
    return {
      status: response.status,
      contentType,
      body: await response.text(),
      ...relayed,
      events,
    };
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    // A body this size cannot ride a JSON envelope on a shared worker
    // (base64 + envelope copies). Refuse before buffering; the gateway
    // answers the read as unavailable rather than waking a pod.
    await response.body?.cancel();
    return {
      tooLarge: true,
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: TOO_LARGE_MESSAGE }),
      events,
    };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType,
    body: "",
    bodyBase64: bytes.toString("base64"),
    ...relayed,
    events,
  };
}
