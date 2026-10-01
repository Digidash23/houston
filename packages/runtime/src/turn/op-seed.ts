import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOAD_BYTES } from "@houston/host/src/turn/files-import";
import { LazyStoreVfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type ObjectMetadata,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import type { SeedOp } from "./op-grammar-seed";
import {
  AGENT_DOC_FAMILIES,
  type OpClaimTurn,
  publishFamilyDocs,
} from "./op-republish";
import { classifySeedListing, listPrefix } from "./op-seed-listing";
import { syncSeedTree, withdrawSeedTree } from "./op-seed-sync";
import { buildSeedTree, pruneListed, type SeedTree } from "./op-seed-tree";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { TURN_HYDRATE_MAX_BYTES } from "./turn-filesystem";

/** The worker's HTTP answer to `/op` for a seed. */
export interface SeedReply {
  status: number;
  body: unknown;
}

export interface SeedOpInput {
  deps: Pick<
    TurnServerDeps,
    "poolStoreUrl" | "fetchImpl" | "activityDocRetryDelaysMs"
  >;
  op: OpRequest & { op: SeedOp };
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  /** Per-op temp directory, removed by the caller. */
  root: string;
  /** Whether the claim was fenced (checked before anything is written). */
  fenced: () => Promise<boolean>;
}

const RESTORE_PENDING = {
  error: "agent data restore pending",
  code: "restore_pending",
};

const relayed = (status: number, body: unknown): SeedReply => ({
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
 * The `seed` op: decide from the store listing alone (nothing downloaded),
 * then adopt the one agent tree, seed an empty prefix exactly as the pod's
 * `POST /agents` would, or refuse anything else as data a seed must never
 * write over. Every upload is create-only; a seeding race withdraws this
 * op's files and decides again once, which adopts the winner's tree.
 */
export function executeSeedOp(input: SeedOpInput): Promise<SeedReply> {
  return seedOnce(input, true);
}

async function seedOnce(
  input: SeedOpInput,
  mayRetry: boolean,
): Promise<SeedReply> {
  const { op, store, prefix } = input;
  const seeds = Object.keys(op.op.seeds ?? {});
  // The agent-ops claim cannot write the runtime tree: such a seed is the
  // pod's to create, never silently dropped here.
  if (seeds.some((key) => key.startsWith(".houston/runtime/")))
    return { status: 200, body: { ok: true, decline: true } };
  const { objects, rels } = await listPrefix(store, prefix);
  const listing = await classifySeedListing(rels, input.root);
  if (listing.kind === "refuse") {
    console.warn(`[op] seed refused: ${listing.reason} prefix=${prefix}`);
    return relayed(409, RESTORE_PENDING);
  }
  const payload = op.op.claudeMd !== undefined || op.op.seeds !== undefined;
  if (listing.kind === "adopt" && !payload)
    return relayed(200, { id: listing.id, adopted: true });

  const storeRoot = await mkdtemp(join(input.root, "seed-"));
  const actor = op.actingAs?.userId;
  let tree: SeedTree;
  if (listing.kind === "adopt") {
    // A seed that crashed half-way is completed: the payload files the
    // adopted tree lacks, never one it holds.
    const [workspaceId = "", name = ""] = listing.id.split("/");
    tree = await buildSeedTree(storeRoot, op.op, actor, { workspaceId, name });
    await pruneListed(storeRoot, tree, new Set(rels));
  } else {
    tree = await buildSeedTree(storeRoot, op.op, actor);
  }
  if (await input.fenced())
    return { status: 409, body: { error: "claim_fenced" } };
  const synced = await syncSeedTree(store, prefix, storeRoot, tree);
  if (synced.skipped.length > 0) {
    console.error(
      `[op] seed not durable: skipped=${synced.skipped.length} prefix=${prefix}`,
    );
    return relayed(413, {
      error: "file too large to store",
      files: synced.skipped.map((s) => s.key),
    });
  }
  if (synced.conflicts.length > 0) {
    console.warn(
      `[op] seed raced another writer: conflicts=${synced.conflicts.map((c) => c.key).join(",")} prefix=${prefix}`,
    );
    if (listing.kind === "empty") {
      await withdrawSeedTree(store, prefix, synced);
      return mayRetry ? seedOnce(input, false) : relayed(409, RESTORE_PENDING);
    }
  }
  const wrote = synced.uploaded.length;
  if (listing.kind === "empty" || (wrote > 0 && synced.conflicts.length === 0))
    await publishDocs(input, objects, storeRoot, tree);
  return listing.kind === "empty"
    ? relayed(201, { id: tree.id, adopted: false })
    : relayed(200, { id: listing.id, adopted: true, completed: wrote });
}

/**
 * The five family docs, read through the listing plus what this op wrote:
 * an adopted tree's existing files project as they are in the store.
 */
async function publishDocs(
  input: SeedOpInput,
  objects: ObjectMetadata[],
  storeRoot: string,
  tree: SeedTree,
): Promise<void> {
  const vfs = new LazyStoreVfs({
    store: input.store,
    prefix: input.prefix,
    root: storeRoot,
    objects,
    manifest: new Map(),
    excludes: DEFAULT_EXCLUDES,
    maxObjectBytes: MAX_UPLOAD_BYTES,
    maxBytes: TURN_HYDRATE_MAX_BYTES,
  });
  const run = () =>
    publishFamilyDocs(
      input.deps,
      input.turn,
      vfs,
      tree.workspaceRel,
      AGENT_DOC_FAMILIES,
    );
  let failures = await run();
  if (failures.length > 0) {
    // One more round: a blip on the doc PUT is the common case.
    await new Promise((resolve) => setTimeout(resolve, 500));
    failures = await run();
  }
  if (failures.length > 0) {
    // The files ARE durable; asleep reads lag until the next projection.
    console.error(
      `[op] seed projection failed after a durable sync: ${failures.join("; ")} prefix=${input.prefix}`,
    );
  }
}
