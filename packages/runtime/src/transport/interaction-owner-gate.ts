import type { IncomingHttpHeaders } from "node:http";
import { ROUTINE_FIRE_HEADER } from "@houston/protocol";
import { actingFromHeaders } from "../session/acting-context";
import { decodeActingAuthor } from "../session/attribution";
import type { CardAnswer } from "../session/turn-start-failure";
import { storedCardRefuses } from "../store/conversation-card";
import { notInteractionOwnerBody } from "../store/interaction-owner";
import { json, type RouteContext } from "./http-helpers";

/**
 * The person a request acts as, for the card-owner rule: while a card is live,
 * only the person it is for may answer, dismiss, import into, or truncate the
 * conversation. Only the gateway-signed acting-as token names that person; the
 * bare `x-houston-acting-user` header is not proof of who is asking.
 */
export function cardActor(headers: IncomingHttpHeaders): string | undefined {
  return decodeActingAuthor(actingFromHeaders(headers)?.actingAs)?.userId;
}

/** Answer 403 (and return true) when the request's person may not touch the
 *  conversation's live card. */
export function refuseNonCardOwner(ctx: RouteContext, id: string): boolean {
  if (!storedCardRefuses(id, cardActor(ctx.req.headers))) return false;
  json(ctx.res, 403, notInteractionOwnerBody);
  return true;
}

/**
 * Whether the host fired this message for a routine run (`ROUTINE_FIRE_HEADER`).
 * Trusted because only the host's own `fireTurn` sets it: a client's message
 * reaches this runtime through the host's `forward`, which sends a header list
 * it builds itself (bearer, content type, acting-as, Last-Event-ID, Accept),
 * never the client's headers.
 */
export function isRoutineFire(headers: IncomingHttpHeaders): boolean {
  return headers[ROUTINE_FIRE_HEADER] === "1";
}

/** The person a message answers a live card as; undefined when it is exempt
 *  (no signed identity, or a routine run). */
export function sendAnswerer(headers: IncomingHttpHeaders): string | undefined {
  return isRoutineFire(headers) ? undefined : cardActor(headers);
}

/** The turn option that judges a queued send again right before it starts. */
export function queuedCardAnswer(
  userId: string | undefined,
  onRefused: () => void,
): { cardAnswer?: CardAnswer } {
  return userId ? { cardAnswer: { userId, onRefused } } : {};
}
