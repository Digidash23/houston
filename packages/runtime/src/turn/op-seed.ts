import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import type { SeedOp } from "./op-grammar-seed";
import type { DocDeps, OpClaimTurn } from "./op-republish";
import { classifySeedListing, listPrefix } from "./op-seed-listing";
import { publishSeedDocs } from "./op-seed-publish";
import { syncSeedTree, withdrawSeedTree } from "./op-seed-sync";
import { buildSeedTree, pruneListed, type SeedTree } from "./op-seed-tree";
import { RUNTIME_VIEW_SOURCES, type SeedViewSources } from "./op-seed-views";
import type { OpRequest } from "./parse-op-request";

/** The worker's HTTP answer to `/op` for a seed. */
export interface SeedReply {
  status: number;
  body: unknown;
}

export interface SeedOpInput {
  deps: DocDeps;
  op: OpRequest & { op: SeedOp };
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  /** Per-op temp directory, removed by the caller. */
  root: string;
  /** Whether the claim was fenced (checked before anything is written). */
  fenced: () => Promise<boolean>;
  /** Test seam: the provider baseline (default: this runtime's own). */
  views?: SeedViewSources;
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
  const storeRoot = await mkdtemp(join(input.root, "seed-"));
  const publishDocs = (tree: SeedTree, adopted = false) =>
    publishSeedDocs({
      adopted,
      deps: input.deps,
      turn: input.turn,
      store,
      prefix,
      objects,
      storeRoot,
      tree,
      views: input.views ?? RUNTIME_VIEW_SOURCES,
    });
  if (listing.kind === "adopt" && !payload) {
    // A young agent's adopt may follow a first seed that crashed after its
    // files landed and before its docs did: project them again.
    if (op.op.republish)
      await publishDocs(
        { id: listing.id, workspaceRel: listing.workspaceRel },
        true,
      );
    return relayed(200, { id: listing.id, adopted: true });
  }

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
  // An adopted tree that raced another writer is left to that writer's
  // own projection: this op's listing no longer shows the store.
  if (
    listing.kind === "empty" ||
    (synced.conflicts.length === 0 && (wrote > 0 || op.op.republish))
  )
    await publishDocs(tree, listing.kind === "adopt");
  return listing.kind === "empty"
    ? relayed(201, { id: tree.id, adopted: false })
    : relayed(200, { id: listing.id, adopted: true, completed: wrote });
}
