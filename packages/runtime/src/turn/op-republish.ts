import {
  docKey,
  type HoustonFamily,
  normalizeActivities,
  normalizeLearnings,
  normalizeRoutineRuns,
  normalizeRoutines,
} from "@houston/domain";
import type { HoustonEvent } from "@houston/protocol";
import type { OpResult } from "./op-apply";
import { publishOpStoreDocs } from "./op-store-docs";
import type { TurnServerDeps } from "./server-types";
import { publish } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import type { TurnFilesystem } from "./turn-filesystem";
import { poolIdentity } from "./turn-store";
import { publishStoreDoc } from "./turn-store-doc";
import { docNotLandedReason } from "./turn-view-publish";

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
 * Project each family's file into its doc, derived from what the STORE holds
 * once the doc revision is read (publishStoreDoc): the writer's own tree is a
 * snapshot from its listing, and a turn may have landed and published the
 * same family since, so projecting the snapshot would roll that back. A read
 * that THROWS (store blip, refused size) is a diagnostic; an absent or
 * unparsable file projects the empty doc, as the pod's own projector does.
 * Answers the diagnostics (empty = every doc landed).
 */
export async function publishFamilyDocs(
  deps: DocDeps,
  turn: OpClaimTurn,
  source: ActivityDocSource,
  workspaceRel: string,
  families: Iterable<HoustonFamily>,
): Promise<string[]> {
  const diagnostics: string[] = [];
  const common = docTarget(deps, turn);
  if (!common) return diagnostics;
  for (const family of families) {
    const key = docKey(workspaceRel, family);
    const outcome = await publishStoreDoc(
      { ...common, family },
      source,
      key,
      (raw) => projectFamily(family, raw, key),
    );
    if ("error" in outcome) diagnostics.push(`${family}: ${outcome.error}`);
  }
  return diagnostics;
}

/** Re-project every family the op changed, the skills its landed SKILL.md
 *  writes and deletes changed (`landed`), and the custom definitions view it
 *  re-captured. Skills and learnings are read back through `source`. */
export async function republish(
  deps: DocDeps,
  turn: OpClaimTurn,
  filesystem: TurnFilesystem,
  result: OpResult,
  landed: readonly string[],
  source: ActivityDocSource,
): Promise<string[]> {
  const common = docTarget(deps, turn);
  if (!common) return [];
  const families = new Set<HoustonFamily>();
  for (const event of result.events) {
    const family = EVENT_FAMILY[event.type];
    if (family) families.add(family);
  }
  const learnings = families.delete("learnings");
  const diagnostics = await publishFamilyDocs(
    deps,
    turn,
    source,
    filesystem.workspaceRel,
    families,
  );
  diagnostics.push(
    ...(await publishOpStoreDocs({
      common,
      source,
      filesystem,
      result,
      landed,
      learnings,
    })),
  );
  if (result.customDefinitionsView !== undefined) {
    // The definitions list is a view doc (docs/view-capture.ts family), so
    // the gateway's asleep reads show the mutation immediately.
    const outcome = await publish(
      { ...common, family: "custom_definitions" },
      result.customDefinitionsView,
    );
    const failure = docNotLandedReason(outcome);
    if (failure) diagnostics.push(`custom_definitions: ${failure}`);
  }
  return diagnostics;
}

const emptyDoc = (family: HoustonFamily) => (family === "config" ? {} : []);

function projectFamily(
  family: HoustonFamily,
  raw: string | null,
  key: string,
): unknown {
  if (raw === null) return emptyDoc(family);
  try {
    return normalizeFamily(family, JSON.parse(raw), key);
  } catch {
    return emptyDoc(family);
  }
}

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
