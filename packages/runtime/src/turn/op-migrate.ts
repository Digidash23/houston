import { join } from "node:path";
import {
  AGENT_STORE_MIGRATION_VERSION,
  migrateAgentStore,
} from "@houston/host/src/migrate/agent-store";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import type { MigrateOp } from "./op-grammar-migrate";
import { moveLegacySecrets } from "./op-migrate-custody";
import { projectMigratedStore } from "./op-migrate-project";
import { syncMigratedTree } from "./op-migrate-sync";
import { migrateHydrateFilter } from "./op-migrate-tree";
import type { DocDeps, OpClaimTurn } from "./op-republish";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { prepareTurnFilesystem } from "./turn-filesystem";
import { TurnSetupError } from "./turn-layout";

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

/**
 * The custody move, whose failure leaves the plaintext file and the rest of
 * the migration in place: the answer is incomplete (the gateway records no
 * version and runs it again later), never a failure that sends the agent to
 * a pod, whose boot would move the same secrets.
 */
async function moveCustody(
  input: MigrateOpInput,
  storeRoot: string,
): Promise<Awaited<ReturnType<typeof moveLegacySecrets>>> {
  try {
    return await moveLegacySecrets({
      storeRoot,
      op: input.op,
      ...(input.deps.fetchImpl ? { fetchImpl: input.deps.fetchImpl } : {}),
    });
  } catch (error) {
    console.error(
      `[op] migrate custody move failed, plaintext kept prefix=${input.prefix}:`,
      error,
    );
    return { moved: 0, complete: false };
  }
}

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
  let filesystem: Awaited<ReturnType<typeof prepareTurnFilesystem>>;
  try {
    filesystem = await prepareTurnFilesystem({
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
  } catch (error) {
    // The store itself refuses the run (two complete agent trees under the
    // prefix, a tree over the hydration cap): no retry over the same objects
    // changes that, so the gateway reads the code and waits for the store to
    // change instead of spending a sandbox per retry. Anything else stays a
    // bare failure the gateway retries.
    if (!(error instanceof TurnSetupError)) throw error;
    console.error(
      `[op] migrate refused by the store code=${error.code} prefix=${prefix}: ${error.message}`,
    );
    return failed(error.code, { error: error.message });
  }
  const log = (line: string, error?: unknown) =>
    error === undefined
      ? console.log(`[op] migrate ${line}`)
      : console.error(`[op] migrate ${line}`, error);
  let report: Awaited<ReturnType<typeof migrateAgentStore>>;
  let custody: Awaited<ReturnType<typeof moveLegacySecrets>>;
  const fenced = { status: 409, body: { error: "claim_fenced" } };
  try {
    report = await migrateAgentStore({
      workspacesRoot: join(filesystem.storeRoot, "workspaces"),
      agentRoot: filesystem.workspaceDir,
      ...(op.op.ownerSub ? { ownerSub: op.op.ownerSub } : {}),
      log,
    });
    // Custody is written directly, not through the claimed sync: no run
    // that lost its claim may reach it.
    if (await input.fenced()) return fenced;
    custody = await moveCustody(input, filesystem.storeRoot);
  } catch (error) {
    console.error(`[op] migrate failed before sync prefix=${prefix}:`, error);
    return failed("migration_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (await input.fenced()) return fenced;
  const synced = await syncMigratedTree({
    store,
    prefix,
    storeRoot: filesystem.storeRoot,
    manifest: filesystem.manifest,
    workspaceRel: filesystem.workspaceRel,
    generationAware: filesystem.generationAware,
  });
  if (!synced.durable) {
    console.error(
      `[op] migrate not durable: conflicts=${synced.conflicts.length} skipped=${synced.skipped.length} prefix=${prefix}`,
    );
    return failed("migration_not_durable", {
      conflicts: synced.conflicts,
      skipped: synced.skipped,
    });
  }
  const projection = await projectMigratedStore({
    deps: input.deps,
    turn: input.turn,
    store,
    prefix,
    workspaceRel: filesystem.workspaceRel,
    root: input.root,
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
    secretsMoved: custody.moved,
    uploaded: synced.uploaded.length,
    deleted: synced.deleted.length,
    docsPublished: projection.published,
    docsLagging: projection.lagging,
    routinesReprojected: projection.reprojected,
    // The gateway records the version only once these landed too.
    complete: projection.lagging.length === 0 && custody.complete,
  });
}
