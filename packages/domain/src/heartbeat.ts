import {
  DEFAULT_HEARTBEAT_SETTINGS,
  type HeartbeatLast,
  HeartbeatLastSchema,
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

/** A briefing turn the runtime accepted and the host has not yet seen end. */
export interface HeartbeatPending {
  /** The nonce the turn was sent with: its user message carries it. */
  nonce: string;
  at: string;
  /** `seen` once this briefing is confirmed delivered (heartbeat-news.ts). */
  seen: string[];
}

/**
 * The stored document: the wire state plus the host-owned record the "only
 * when there is news" rule reads (heartbeat-news.ts). Never on the wire.
 */
export interface HeartbeatDoc extends HeartbeatState {
  /** Keys of the items the person has been told about. */
  seen: string[];
  pending: HeartbeatPending | null;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];

function normalizePending(raw: unknown): HeartbeatPending | null {
  if (!isRecord(raw)) return null;
  const { nonce, at, seen } = raw;
  if (typeof nonce !== "string" || typeof at !== "string") return null;
  return { nonce, at, seen: strings(seen) };
}

/**
 * Read field by field: a hand-edited bad `time` falls back to the default
 * time without also forgetting that today's briefing already ran (which would
 * fire it a second time).
 */
export function normalizeHeartbeat(raw: unknown): HeartbeatDoc {
  const doc = isRecord(raw) ? raw : {};
  const time = HeartbeatTimeSchema.safeParse(doc.time);
  const last = HeartbeatLastSchema.safeParse(doc.last);
  return {
    enabled:
      typeof doc.enabled === "boolean"
        ? doc.enabled
        : DEFAULT_HEARTBEAT_SETTINGS.enabled,
    time: time.success ? time.data : DEFAULT_HEARTBEAT_SETTINGS.time,
    last: last.success ? last.data : null,
    seen: strings(doc.seen),
    pending: normalizePending(doc.pending),
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
export function updateHeartbeatDoc(
  store: TextStore,
  workspaceId: string,
  edit: (current: HeartbeatDoc) => HeartbeatDoc | null,
): Promise<HeartbeatDoc | null> {
  const key = heartbeatDocKey(workspaceId);
  return withDocLock(key, async () => {
    const next = edit(await loadHeartbeatDoc(store, workspaceId));
    if (next) await saveJson(store, key, next);
    return next;
  });
}

async function updateHeartbeat(
  store: TextStore,
  workspaceId: string,
  edit: (current: HeartbeatDoc) => HeartbeatDoc,
): Promise<HeartbeatState> {
  return toState(
    (await updateHeartbeatDoc(store, workspaceId, edit)) as HeartbeatDoc,
  );
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

/**
 * Record a run that ended without a turn (quiet, or a turn that could not
 * start); host-owned, the person never writes it. An admitted turn goes
 * through heartbeat-briefing.ts instead.
 */
export function recordHeartbeatRun(
  store: TextStore,
  workspaceId: string,
  last: HeartbeatLast,
): Promise<HeartbeatState> {
  return updateHeartbeat(store, workspaceId, (current) => ({
    ...current,
    last,
  }));
}
