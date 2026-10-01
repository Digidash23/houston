import {
  docKey,
  type HoustonFamily,
  normalizeActivities,
  normalizeLearnings,
  normalizeRoutineRuns,
  normalizeRoutines,
} from "@houston/domain";
import type { Vfs } from "@houston/host/src/vfs";
import type { HoustonEvent } from "@houston/protocol";
import type { OpResult } from "./op-apply";
import type { TurnServerDeps } from "./server-types";
import { publish } from "./turn-activity-doc";
import type { TurnFilesystem } from "./turn-filesystem";
import { poolIdentity } from "./turn-store";

/** The claim an op publishes under (its store writes use the same one). */
export interface OpClaimTurn {
  gcsPrefix: string;
  hostToken: string;
  claim: { token: string; bootId: string };
  conversationId: string;
}

/** The five agent-data families the gateway serves asleep reads from. */
export const AGENT_DOC_FAMILIES: readonly HoustonFamily[] = [
  "activity",
  "routines",
  "routine_runs",
  "learnings",
  "config",
];

const EVENT_FAMILY: Partial<Record<HoustonEvent["type"], HoustonFamily>> = {
  ActivityChanged: "activity",
  RoutinesChanged: "routines",
  RoutineRunsChanged: "routine_runs",
  ConfigChanged: "config",
  LearningsChanged: "learnings",
};

export type DocDeps = Pick<
  TurnServerDeps,
  "poolStoreUrl" | "fetchImpl" | "activityDocRetryDelaysMs"
>;

/** Where an op's docs go (`publish` options minus the family); null when
 *  no pool store is configured. */
export function docTarget(deps: DocDeps, turn: OpClaimTurn) {
  const baseUrl = deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (!baseUrl) return null;
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  return {
    baseUrl,
    org,
    agent,
    conversationId: turn.conversationId,
    hostToken: turn.hostToken,
    claim: turn.claim,
    fetchImpl: deps.fetchImpl ?? fetch,
    ...(deps.activityDocRetryDelaysMs
      ? { retryDelaysMs: deps.activityDocRetryDelaysMs }
      : {}),
  };
}

/**
 * Project each family's file into its doc. Reads go through `vfs`: on a lazy
 * tree a handler may have emitted the event without the family file being on
 * disk yet, and a raw read would project an EMPTY doc over real data. A read
 * that THROWS (store blip, refused size) is a diagnostic; an absent or
 * unparsable file projects the empty doc, as the pod's own projector does.
 * Answers the diagnostics (empty = every doc landed).
 */
export async function publishFamilyDocs(
  deps: DocDeps,
  turn: OpClaimTurn,
  vfs: Vfs,
  workspaceRel: string,
  families: Iterable<HoustonFamily>,
): Promise<string[]> {
  const diagnostics: string[] = [];
  const common = docTarget(deps, turn);
  if (!common) return diagnostics;
  for (const family of families) {
    const key = docKey(workspaceRel, family);
    let raw: string | null;
    try {
      raw = await vfs.readText(key);
    } catch (error) {
      diagnostics.push(
        `${family}: read failed, not projected: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    let doc: unknown;
    try {
      doc =
        raw === null
          ? emptyDoc(family)
          : normalizeFamily(family, JSON.parse(raw), key);
    } catch {
      doc = emptyDoc(family);
    }
    const outcome = await publish({ ...common, family }, doc);
    if ("error" in outcome) diagnostics.push(`${family}: ${outcome.error}`);
  }
  return diagnostics;
}

/** Re-project every family the op changed, plus the skills and custom
 *  definitions views it re-captured. */
export async function republish(
  deps: DocDeps,
  turn: OpClaimTurn,
  filesystem: TurnFilesystem,
  result: OpResult,
): Promise<string[]> {
  const common = docTarget(deps, turn);
  if (!common) return [];
  const families = new Set<HoustonFamily>();
  let skills = false;
  for (const event of result.events) {
    const family = EVENT_FAMILY[event.type];
    if (family) families.add(family);
    if (event.type === "SkillsChanged") skills = true;
  }
  const diagnostics = await publishFamilyDocs(
    deps,
    turn,
    filesystem.vfs,
    filesystem.workspaceRel,
    families,
  );
  if (skills && result.skillsView !== undefined) {
    const outcome = await publish(
      { ...common, family: "skills" },
      result.skillsView,
    );
    if ("error" in outcome) diagnostics.push(`skills: ${outcome.error}`);
  }
  if (result.customDefinitionsView !== undefined) {
    // The definitions list is a view doc (docs/view-capture.ts family), so
    // the gateway's asleep reads show the mutation immediately.
    const outcome = await publish(
      { ...common, family: "custom_definitions" },
      result.customDefinitionsView,
    );
    if ("error" in outcome)
      diagnostics.push(`custom_definitions: ${outcome.error}`);
  }
  return diagnostics;
}

const emptyDoc = (family: HoustonFamily) => (family === "config" ? {} : []);

function normalizeFamily(
  family: HoustonFamily,
  parsed: unknown,
  key: string,
): unknown {
  switch (family) {
    case "activity":
      return normalizeActivities(parsed, key).items;
    case "routines":
      return normalizeRoutines(parsed, key).items;
    case "routine_runs":
      return normalizeRoutineRuns(parsed, key).items;
    case "learnings":
      return normalizeLearnings(parsed, key).items;
    case "config":
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? parsed
        : {};
    default:
      return parsed;
  }
}
