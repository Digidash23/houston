import { mkdir, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { realAgents, standingTree } from "./turn-layout-agents";

/** Stable internal codes for failures before provider execution. */
export type TurnSetupCode =
  | "credential_write_failed"
  | "hydrate_over_cap"
  | "layout_unexpected"
  /** The agent's store still holds the pre-v0.4 flat layout: only the
   *  `migrate` op may run until its boot migration has (turn-layout-legacy). */
  | "agent_not_migrated"
  /** Houston's message reused a nonce for other words: a host refuses it. */
  | "message_refused";

/** A setup failure the internal turn stream exposes as a stable code. */
export class TurnSetupError extends Error {
  constructor(
    readonly code: TurnSetupCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TurnSetupError";
  }
}

/** Resolved pi directories and their object-store-relative data path. */
export interface TurnLayout {
  kind: "standing" | "cloudrun";
  workspaceDir: string;
  workspaceRel: string;
  dataDir: string;
  dataRel: string;
}

const storeRelative = (storeRoot: string, path: string) =>
  relative(storeRoot, path).split(sep).join("/");

/**
 * Resolve the hydrated agent tree into the directories pi consumes. An EMPTY
 * tree is a legitimate first turn only for an unclaimed (legacy per-workspace)
 * runtime; a claimed pool turn targets a standing agent that already exists,
 * so zero hydrated objects there means the hydrate missed (a blank prefix)
 * and running would seed a second layout beside the real one.
 *
 * The dispatch names the agent's store prefix, never its folder. The
 * preferences namespace (`workspaces/ws/`) counts as absent: alone it makes
 * no `workspaces/` folder (the tree is then per-turn or empty), and it is
 * never an agent candidate. A single remaining folder is the agent even
 * without markers (a load-test agent may hold only schemas and a runtime
 * tree); among several, the ones carrying an agent's files win, and only two
 * REAL agents are ambiguous. `listed` is the store listing, keys relative to
 * `storeRoot`.
 */
export async function resolveTurnLayout(
  storeRoot: string,
  opts: { allowEmpty?: boolean; listed?: readonly string[] } = {},
): Promise<TurnLayout> {
  const standing = await standingTree(storeRoot);
  const rootEntries = (
    await readdir(storeRoot, { withFileTypes: true })
  ).filter((entry) => standing.present || entry.name !== "workspaces");
  const rootDirectories = new Set(
    rootEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const hasWorkspaces = standing.present;
  const hasData = rootDirectories.has("data");
  const hasWorkspace = rootDirectories.has("workspace");
  const candidates = standing.candidates;
  const agents =
    candidates.length > 1
      ? await realAgents(storeRoot, candidates, opts.listed ?? [])
      : candidates;

  if ((hasWorkspaces && hasData) || agents.length > 1) {
    throw new TurnSetupError(
      "layout_unexpected",
      "hydrated store contains more than one agent layout",
    );
  }
  if (candidates.length > 1 && agents.length === 0) {
    throw new TurnSetupError(
      "layout_unexpected",
      `hydrated store has ${candidates.length} agent folders and none carries an agent's files`,
    );
  }
  if (agents.length === 1) {
    const workspaceDir = agents[0] as string;
    const dataDir = join(workspaceDir, ".houston", "runtime");
    await mkdir(dataDir, { recursive: true });
    return {
      kind: "standing",
      workspaceDir,
      workspaceRel: storeRelative(storeRoot, workspaceDir),
      dataDir,
      dataRel: storeRelative(storeRoot, dataDir),
    };
  }
  if (
    hasData ||
    hasWorkspace ||
    (rootEntries.length === 0 && (opts.allowEmpty ?? true))
  ) {
    const workspaceDir = join(storeRoot, "workspace");
    const dataDir = join(storeRoot, "data");
    await Promise.all([
      mkdir(workspaceDir, { recursive: true }),
      mkdir(dataDir, { recursive: true }),
    ]);
    return {
      kind: "cloudrun",
      workspaceDir,
      workspaceRel: "workspace",
      dataDir,
      dataRel: "data",
    };
  }
  throw new TurnSetupError(
    "layout_unexpected",
    rootEntries.length === 0
      ? "hydrated store is empty; a claimed turn needs an existing agent"
      : "hydrated store does not contain a recognized agent layout",
  );
}

/**
 * The directories the layout resolver and the host's agent lookup key on,
 * without a single download: `workspaces/<ws>/<agent>` for the standing
 * layout, `data` / `workspace` for the per-turn one. Deeper directories
 * appear as objects materialize.
 */
export async function layoutSkeleton(
  storeRoot: string,
  rels: readonly string[],
) {
  const dirs = new Set<string>();
  for (const rel of rels) {
    const segments = rel.split("/");
    const depth = segments[0] === "workspaces" ? 3 : 1;
    if (segments.length > depth) dirs.add(segments.slice(0, depth).join("/"));
  }
  await Promise.all(
    [...dirs].map((dir) =>
      mkdir(join(storeRoot, ...dir.split("/")), { recursive: true }),
    ),
  );
}

/** Lay out a store listing's skeleton, then resolve the layout against it. */
export async function resolveListedLayout(
  storeRoot: string,
  listed: readonly string[],
  opts: { allowEmpty?: boolean },
): Promise<TurnLayout> {
  await layoutSkeleton(storeRoot, listed);
  return resolveTurnLayout(storeRoot, { ...opts, listed });
}
