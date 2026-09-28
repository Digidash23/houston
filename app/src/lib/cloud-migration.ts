/**
 * Pure logic for the first-run desktop→cloud migration wizard (HOU-719).
 *
 * The cloud-only desktop build finds the OLD local install's data
 * (`~/.houston`, written by the legacy desktop app) and offers to move every
 * legacy agent into the user's cloud account. This module owns the wizard's
 * types and the chunking of an agent's manifest into upload-sized batches;
 * the plan (target names, collision renames, resume) lives in
 * `cloud-migration-plan.ts`. I/O lives in `cloud-migration-transport.ts` /
 * `stores/cloud-migration.ts`.
 *
 * Kept dependency-free so `node --test` can exercise it directly
 * (see `app/tests/cloud-migration.test.ts`).
 */

/** `detect_legacy_houston` result — is there old desktop data on this machine. */
export interface LegacyDetection {
  hasWorkspaces: boolean;
  hasChatDb: boolean;
  workspaceDirs: string[];
  agentDirCount: number;
}

export interface SourceManifestEntry {
  path: string;
  size: number;
  /** "core" = agent memory/config/history (upload first); "file" = working files. */
  kind: "core" | "file";
}

export interface SourceExcludedEntry {
  path: string;
  size: number;
  reason: string;
}

export interface SourceAgentManifest {
  entries: SourceManifestEntry[];
  excluded: SourceExcludedEntry[];
  /** Composio toolkit slugs the legacy agent had connected. */
  integrations: string[];
  totalBytes: number;
}

/** One legacy agent, as reported by the source host's `/v1/migration/source`. */
export interface SourceAgent {
  /** `"<Workspace>/<Agent>"` — the source host's agent id. */
  id: string;
  workspaceId: string;
  name: string;
  manifest: SourceAgentManifest;
  /**
   * The legacy client-side overlay color for this agent, if the old install
   * saved one (resolved from `localStorage` — see `legacy-agent-colors.ts`).
   * Color never crosses the wire; the prepare phase reads it locally and
   * threads it here so the migrated cloud agent keeps its color. `undefined`
   * when unknown — the create path applies the default, don't default here.
   */
  color?: string;
}

export interface MigrationTask {
  sourceId: string;
  workspace: string;
  agent: string;
  /** The cloud agent name this source agent migrates into. */
  targetName: string;
  /** A previous run already completed this agent — skip it (resume). */
  alreadyDone: boolean;
  manifest: SourceAgentManifest;
  /** The legacy overlay color to seed on the created cloud agent (if any). */
  color?: string;
}

/**
 * Per-request budget of RAW (pre-zip) bytes. The binding constraint is TIME,
 * not the gateway's 64 MB import cap: the cloud ingress closes any request
 * whose body has not fully arrived within 60 s, with no response, so the
 * wizard sees a bare transport drop ("Failed to fetch" / "Load failed") and
 * every retry of that chunk dies the same way. 48 MB chunks needed a 6+ Mbps
 * uplink to make it; 8 MB clears the deadline on a 2 Mbps home connection.
 */
export const MAX_CHUNK_RAW_BYTES = 8 * 1024 * 1024;

export interface UploadChunk {
  paths: string[];
  bytes: number;
}

/**
 * Partition manifest entries into upload chunks of at most `maxBytes` summed
 * size. "core" entries (memory, config, history) go in the earliest chunks so
 * the agent is useful even if a later working-file chunk fails. The manifest
 * already excludes single files over its own cap, but an oversized entry is
 * still guarded: it rides alone in its own chunk rather than being dropped.
 */
export function chunkPaths(
  entries: SourceManifestEntry[],
  maxBytes: number = MAX_CHUNK_RAW_BYTES,
): UploadChunk[] {
  const ordered = [
    ...entries.filter((e) => e.kind === "core"),
    ...entries.filter((e) => e.kind !== "core"),
  ];
  const chunks: UploadChunk[] = [];
  let current: UploadChunk | null = null;
  for (const entry of ordered) {
    if (!current || current.bytes + entry.size > maxBytes) {
      current = { paths: [], bytes: 0 };
      chunks.push(current);
    }
    current.paths.push(entry.path);
    current.bytes += entry.size;
  }
  return chunks;
}

/** Union of every source agent's connected toolkit slugs plus the legacy
 *  account-level list, sorted, for the "reconnect your apps" checklist. */
export function collectIntegrations(
  sourceAgents: SourceAgent[],
  accountIntegrations: string[] = [],
): string[] {
  const all = new Set<string>(accountIntegrations);
  for (const a of sourceAgents) {
    for (const slug of a.manifest.integrations) all.add(slug);
  }
  return [...all].sort();
}

/**
 * The outcome the done screen persists. A clean run is final ("done"); a run
 * that left agents behind stamps "skipped", so the wizard stays closed on
 * relaunch but Settings' "Continue migration" row — which hides only on
 * "done" (`useMigrationAvailable`) — keeps offering the retry.
 */
export function doneScreenOutcome(failedAgents: number): "done" | "skipped" {
  return failedAgents > 0 ? "skipped" : "done";
}

/**
 * Whether the done screen's second step ("Reconnect your apps" + the
 * leftovers report) has anything to show. Modern legacy installs (v0.4.2x)
 * connected integrations in PLATFORM mode — account-level in Composio, no
 * per-agent `.houston/integrations.json` on disk — so the manifest's
 * integration list is empty for them and the step would render as a bare
 * shell. Skip it then; but leftovers (failed agents, excluded/rejected
 * files) must always surface, so any of those keeps the step.
 */
export function hasReconnectAppsStep(counts: {
  integrations: number;
  failedAgents: number;
  excludedFiles: number;
  rejectedFiles: number;
}): boolean {
  return (
    counts.integrations > 0 ||
    counts.failedAgents > 0 ||
    counts.excludedFiles > 0 ||
    counts.rejectedFiles > 0
  );
}

// The per-agent progress state machine (pending → … → done | error) lives in
// `cloud-migration-progress.ts`; the wizard's prepare phase (spawn source
// host, scan, resume-probe, plan) in `cloud-migration-prepare.ts`.
