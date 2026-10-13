import {
  DEFAULT_HEARTBEAT_SETTINGS,
  type HeartbeatLast,
  HeartbeatLastSchema,
  HeartbeatRunStatus,
  type HeartbeatSettingsPatch,
  type HeartbeatState,
  HeartbeatTimeSchema,
} from "@houston/protocol";
import { withDocLock } from "./doc-lock";
import { PREFERENCES_NAMESPACE } from "./preferences";
import { loadJson, saveJson, type TextStore } from "./store";

/**
 * The daily heartbeat's one document per person: the settings they chose and
 * the host's record of the last run. It lives beside the preferences doc,
 * ABOVE the agent prefixes (`ws/<workspaceId>/heartbeat.json`) of the personal
 * workspace the AI Manager lives in, so deleting an agent never touches it.
 *
 * An absent document IS the default (on, 08:00, never run), so a user who
 * predates the feature needs no migration.
 */
export const heartbeatDocKey = (workspaceId: string) =>
  `${PREFERENCES_NAMESPACE}/${workspaceId}/heartbeat.json`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The stored document: the wire state plus the `at` of the last DELIVERED run,
 * which the "only when there is news" rule compares against (heartbeat-news.ts)
 * and a later quiet or failed `last` would otherwise overwrite. Host-owned and
 * never on the wire.
 */
export interface HeartbeatDoc extends HeartbeatState {
  lastDeliveredAt: string | null;
}

const readableTime = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * Read field by field: a hand-edited bad `time` falls back to the default
 * time without also forgetting that today's briefing already ran (which would
 * fire it a second time).
 */
export function normalizeHeartbeat(raw: unknown): HeartbeatDoc {
  const doc = isRecord(raw) ? raw : {};
  const time = HeartbeatTimeSchema.safeParse(doc.time);
  const last = HeartbeatLastSchema.safeParse(doc.last);
  // A document written before the field: a delivered `last` is the answer.
  const deliveredLast =
    last.success && last.data.status === HeartbeatRunStatus.Delivered
      ? last.data.at
      : null;
  return {
    enabled:
      typeof doc.enabled === "boolean"
        ? doc.enabled
        : DEFAULT_HEARTBEAT_SETTINGS.enabled,
    time: time.success ? time.data : DEFAULT_HEARTBEAT_SETTINGS.time,
    last: last.success ? last.data : null,
    lastDeliveredAt: readableTime(doc.lastDeliveredAt)
      ? doc.lastDeliveredAt
      : deliveredLast,
  };
}

/** The wire state, without the host-owned fields. */
const toState = ({ enabled, time, last }: HeartbeatDoc): HeartbeatState => ({
  enabled,
  time,
  last,
});

export async function loadHeartbeatDoc(
  store: TextStore,
  workspaceId: string,
): Promise<HeartbeatDoc> {
  return normalizeHeartbeat(
    await loadJson<unknown>(store, heartbeatDocKey(workspaceId), null),
  );
}

export async function loadHeartbeat(
  store: TextStore,
  workspaceId: string,
): Promise<HeartbeatState> {
  return toState(await loadHeartbeatDoc(store, workspaceId));
}

/**
 * Read-modify-write under the doc lock: the person's settings write and the
 * daemon's run record land on the same document, and either one saving over
 * the other's base would lose a field.
 */
function updateHeartbeat(
  store: TextStore,
  workspaceId: string,
  edit: (current: HeartbeatDoc) => HeartbeatDoc,
): Promise<HeartbeatState> {
  const key = heartbeatDocKey(workspaceId);
  return withDocLock(key, async () => {
    const next = edit(await loadHeartbeatDoc(store, workspaceId));
    await saveJson(store, key, next);
    return toState(next);
  });
}

/** Apply the person's change. The patch is already validated by the caller. */
export function setHeartbeatSettings(
  store: TextStore,
  workspaceId: string,
  patch: HeartbeatSettingsPatch,
): Promise<HeartbeatState> {
  return updateHeartbeat(store, workspaceId, (current) => ({
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.time !== undefined ? { time: patch.time } : {}),
  }));
}

/** Record how a run ended; host-owned, the person never writes it. */
export function recordHeartbeatRun(
  store: TextStore,
  workspaceId: string,
  last: HeartbeatLast,
): Promise<HeartbeatState> {
  return updateHeartbeat(store, workspaceId, (current) => ({
    ...current,
    last,
    ...(last.status === HeartbeatRunStatus.Delivered
      ? { lastDeliveredAt: last.at }
      : {}),
  }));
}
