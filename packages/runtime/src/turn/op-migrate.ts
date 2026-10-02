import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_STORE_MIGRATION_VERSION,
  migrateAgentStore,
} from "@houston/host/src/migrate/agent-store";
import {
  type ObjectStore,
  syncBack,
} from "@houston/runtime-client/object-sync";
import type { MigrateOp } from "./op-grammar-migrate";
import { moveLegacySecrets } from "./op-migrate-custody";
import { projectMigratedStore } from "./op-migrate-project";
import { migrateHydrateFilter, migrateScope } from "./op-migrate-tree";
import type { DocDeps, OpClaimTurn } from "./op-republish";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { prepareTurnFilesystem } from "./turn-filesystem";

/** The worker's HTTP answer to `/op` for a migrate. */
export interface MigrateReply {
  status: number;
  body: unknown;
}

export interface MigrateOpInput {
  deps: DocDeps & Pick<TurnServerDeps, "maxHydrateBytes">;
  op: OpRequest & { op: MigrateOp };
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  /** Per-op temp directory, removed by the caller. */
  root: string;
  /** Whether the claim was fenced (checked before anything is written). */
  fenced: () => Promise<boolean>;
}

const relayed = (status: number, body: unknown): MigrateReply => ({
  status: 200,
  body: {
    ok: true,
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    events: [],
  },
});

const failed = (code: string, detail: Record<string, unknown> = {}) =>
  relayed(code === "migration_not_durable" ? 409 : 500, { code, ...detail });

/**
 * The `migrate` op: the host's boot migrations over one agent's store
 * prefix, where no pod boots to run them (host/src/migrate/agent-store.ts).
 * Hydrates only the small files the migrations read, writes back under the
 * agent-ops claim with every new file create-only and every rewrite at the
 * generation it read, so nothing another writer landed is ever replaced.
 * Answers the version reached only when every write is durable; any failure
 * leaves the agent where it was for the gateway's fallback and a later run.
 * Then the projections a pod's boot made: family docs, routine schedules.
 */
export async function executeMigrateOp(
  input: MigrateOpInput,
): Promise<MigrateReply> {
  const { op, store, prefix } = input;
  if (op.op.version > AGENT_STORE_MIGRATION_VERSION) {
    return relayed(409, {
      code: "migration_version_unsupported",
      version: AGENT_STORE_MIGRATION_VERSION,
    });
  }
  const filesystem = await prepareTurnFilesystem({
    store,
    prefix,
    root: input.root,
    claimed: true,
    allowLegacyLayout: true,
    filter: migrateHydrateFilter,
    ...(input.deps.maxHydrateBytes !== undefined
      ? { maxBytes: input.deps.maxHydrateBytes }
      : {}),
  });
  const log = (line: string, error?: unknown) =>
    error === undefined
      ? console.log(`[op] migrate ${line}`)
      : console.error(`[op] migrate ${line}`, error);
  let report: Awaited<ReturnType<typeof migrateAgentStore>>;
  let secretsMoved: number;
  try {
    report = await migrateAgentStore({
      workspacesRoot: join(filesystem.storeRoot, "workspaces"),
      agentRoot: filesystem.workspaceDir,
      ...(op.op.ownerSub ? { ownerSub: op.op.ownerSub } : {}),
      log,
    });
    secretsMoved = await moveLegacySecrets({
      storeRoot: filesystem.storeRoot,
      op,
      ...(input.deps.fetchImpl ? { fetchImpl: input.deps.fetchImpl } : {}),
    });
  } catch (error) {
    console.error(`[op] migrate failed before sync prefix=${prefix}:`, error);
    return failed("migration_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (await input.fenced())
    return { status: 409, body: { error: "claim_fenced" } };
  // Without its listing, a 412 stays a conflict: the sync's refreshed-
  // generation retry would otherwise write over the object a racing writer
  // just landed (op-seed-sync.ts does the same).
  const unlisted: ObjectStore = {
    list: (p) => store.list(p),
    download: (key, dest, opts) => store.download(key, dest, opts),
    upload: (src, key, opts) => store.upload(src, key, opts),
    delete: (key, opts) => store.delete(key, opts),
  };
  const synced = await syncBack(
    unlisted,
    prefix,
    filesystem.storeRoot,
    filesystem.manifest,
    {
      include: migrateScope(filesystem.workspaceRel),
      holdDeletesOnFailure: true,
      generations: filesystem.generationAware,
    },
  );
  if (synced.conflicts.length + synced.skipped.length + synced.outOfScope > 0) {
    console.error(
      `[op] migrate not durable: conflicts=${synced.conflicts.length} skipped=${synced.skipped.length} outOfScope=${synced.outOfScope} prefix=${prefix}`,
    );
    return failed("migration_not_durable", {
      conflicts: synced.conflicts.map((c) => c.key),
      skipped: synced.skipped.map((s) => s.key),
    });
  }
  const projection = await projectMigratedStore({
    deps: input.deps,
    turn: input.turn,
    store,
    prefix,
    workspaceRel: filesystem.workspaceRel,
    root: await mkdtemp(join(input.root, "fresh-")),
    uploaded: synced.uploaded,
  });
  if (projection.lagging.length > 0) {
    console.error(
      `[op] migrate projection lagging (the files are durable): ${projection.lagging.join("; ")} prefix=${prefix}`,
    );
  }
  return relayed(200, {
    version: AGENT_STORE_MIGRATION_VERSION,
    ...report,
    secretsMoved,
    uploaded: synced.uploaded.length,
    deleted: synced.deleted.length,
    docsPublished: projection.published,
    docsLagging: projection.lagging,
    routinesReprojected: projection.reprojected,
  });
}
