import type { IncomingMessage, ServerResponse } from "node:http";
import {
  addressesMission,
  applyActivityUpdate,
  loadActivities,
  saveActivities,
  upsertById,
} from "@houston/domain";
import { withDocLock } from "./doc-lock";
import { json, readJson } from "./http";
import { fireActivityChanged, type MissionsCtx } from "./missions-sandbox";

/**
 * The runtime's after-turn mission title (`POST /sandbox/missions/title`): a
 * new mission's first turn titles its card in the same runtime that ran it, and
 * this route writes it. Compare-and-set under the activity doc lock: the title
 * lands only while the card still shows the `fallback` it was created with, so a
 * rename the user made while the title was generating always wins. Arrives after
 * the turn's settle report, so it is deliberately not gated on a live turn.
 */
export async function handleMissionTitle(
  ctx: MissionsCtx,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const cid =
    typeof body.conversation_id === "string" ? body.conversation_id : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const fallback = typeof body.fallback === "string" ? body.fallback : "";
  if (!cid || !title || !fallback) {
    json(res, 400, {
      error: "missing 'conversation_id', 'title' or 'fallback'",
    });
    return;
  }
  const applied = await withDocLock(`${ctx.root}#activity`, async () => {
    const { items } = await loadActivities(ctx.vfs, ctx.root);
    const current = items.find((a) => addressesMission(a, cid));
    if (!current || current.title !== fallback) return false;
    const next = applyActivityUpdate(
      current,
      { title },
      new Date().toISOString(),
    );
    await saveActivities(ctx.vfs, ctx.root, upsertById(items, next));
    return true;
  });
  if (applied) fireActivityChanged(ctx);
  json(res, 200, { ok: applied });
}
