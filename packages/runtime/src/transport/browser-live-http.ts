import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BROWSER_LIVE_MAX_BODY_BYTES,
  BROWSER_LIVE_VIEWER,
  type BrowserLiveEvent,
  type BrowserLiveInputAnswer,
  type BrowserLiveRefusal,
  parseBrowserLiveInputRequest,
} from "@houston/wire-types";
import {
  type HandoffRegistry,
  sharedHandoffs,
} from "../session/tools/browser/live/registry";
import type { HandoffSession } from "../session/tools/browser/live/session";
import { json } from "./http-helpers";
import { cardActor } from "./interaction-owner-gate";

const HEARTBEAT_MS = 15_000;

function refuse(
  res: ServerResponse,
  status: number,
  code: BrowserLiveRefusal,
  session?: HandoffSession,
): void {
  json(res, status, {
    error: code,
    code,
    ...(session ? { state: session.state } : {}),
  });
}

/**
 * The hand-off a request may touch: the conversation's, and only for the
 * person it was handed to (the gateway-signed acting-as names them). Fails
 * closed: a hand-off started with no person named (desktop) is open to a
 * request that names nobody either, never to one signed as someone.
 */
function sessionFor(
  req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  registry: HandoffRegistry,
): HandoffSession | undefined {
  const session = registry.get(conversationId);
  if (!session) {
    refuse(res, 404, "no_handoff");
    return undefined;
  }
  if (cardActor(req.headers) !== session.owner) {
    refuse(res, 403, "not_handoff_owner");
    return undefined;
  }
  return session;
}

/** GET `/conversations/:cid/browser/live`: the live view's SSE stream. */
export function serveBrowserLive(
  req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  url: URL,
  registry: HandoffRegistry = sharedHandoffs,
): void {
  const session = sessionFor(req, res, conversationId, registry);
  if (!session) return;
  const viewer = url.searchParams.get("viewer") ?? "";
  const layout = url.searchParams.get("layout") ?? "desktop";
  if (
    !BROWSER_LIVE_VIEWER.test(viewer) ||
    (layout !== "desktop" && layout !== "phone")
  ) {
    refuse(res, 400, "invalid_input");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay?.(true);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": hb\n\n");
  }, HEARTBEAT_MS);
  const write = (event: BrowserLiveEvent): boolean => {
    if (res.writableEnded) return false;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    // An ended hand-off says how it ended, once, and the stream is over.
    if (event.type === "status" && event.state !== "waiting") res.end();
    return true;
  };
  const detach = session.attachViewer(viewer, layout, write);
  res.on("close", () => {
    clearInterval(heartbeat);
    detach();
  });
  if (res.writableEnded) clearInterval(heartbeat);
}

class BodyTooLarge extends Error {}

async function readCapped(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > BROWSER_LIVE_MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** POST `/conversations/:cid/browser/input`: one batch of the person's input. */
export async function serveBrowserInput(
  req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  registry: HandoffRegistry = sharedHandoffs,
): Promise<void> {
  const session = sessionFor(req, res, conversationId, registry);
  if (!session) return;
  let request: ReturnType<typeof parseBrowserLiveInputRequest>;
  try {
    request = parseBrowserLiveInputRequest(JSON.parse(await readCapped(req)));
  } catch {
    // Too large, not JSON, or off the contract: the client's bug, answered as
    // one. The body (typed text) is never logged.
    refuse(res, 400, "invalid_input");
    return;
  }
  if (session.state !== "waiting") {
    refuse(res, 409, "handoff_ended", session);
    return;
  }
  if (request.ack) session.ack(request.ack.viewer, request.ack.seq);
  // A batch queued behind one that finished the hand-off applies nothing
  // (session.ts); its answer then carries the ended state.
  const outcome = request.events?.length
    ? await session.apply(request.events, request.batch)
    : {};
  if (request.finish)
    session.finish(request.finish === "done" ? "done" : "cancelled");
  const answer: BrowserLiveInputAnswer = { state: session.state, ...outcome };
  json(res, 200, answer);
}
