import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { PREFERENCES_NAMESPACE } from "@houston/domain";
import { DRAIN_STAMP_FILE } from "@houston/host/src/store-sync/drain-stamp";
import type {
  ObjectMetadata,
  ObjectStore,
} from "@houston/runtime-client/object-sync";
import { resolveListedLayout, TurnSetupError } from "./turn-layout";

/** What a seed op may do with a prefix, judged from its listing alone. */
export type SeedListing =
  | { kind: "empty" }
  | { kind: "adopt"; id: string; workspaceRel: string }
  | { kind: "refuse"; reason: string };

/** The prefix's objects with store-relative keys, nothing downloaded. */
export async function listPrefix(
  store: ObjectStore,
  prefix: string,
): Promise<{ objects: ObjectMetadata[]; rels: string[] }> {
  const objects = store.manifest
    ? await store.manifest(prefix)
    : (await store.list(prefix)).map((key) => ({
        key,
        size: 0,
        md5: "",
        updated: "",
      }));
  const rels: string[] = [];
  for (const { key } of objects) {
    if (!prefix) rels.push(key);
    else if (key.startsWith(`${prefix}/`))
      rels.push(key.slice(prefix.length + 1));
  }
  return { objects, rels };
}

/**
 * One agent tree is adopted, an empty prefix is seeded, anything else is
 * data a seed must never write over. The drain stamp and the preferences
 * namespace exist before any agent does, so they count as empty. The tree
 * rules are the turn layout's own (`resolveListedLayout`), resolved against
 * a scratch directory under `root` so the seed tree stays untouched.
 */
export async function classifySeedListing(
  rels: readonly string[],
  root: string,
): Promise<SeedListing> {
  const relevant = rels.filter(
    (rel) =>
      rel !== DRAIN_STAMP_FILE &&
      !rel.startsWith(`workspaces/${PREFERENCES_NAMESPACE}/`),
  );
  if (relevant.length === 0) return { kind: "empty" };
  try {
    const layout = await resolveListedLayout(
      await mkdtemp(join(root, "listing-")),
      rels,
      { allowEmpty: false },
    );
    if (layout.kind !== "standing")
      return { kind: "refuse", reason: "legacy per-turn layout" };
    return {
      kind: "adopt",
      id: layout.workspaceRel.replace(/^workspaces\//, ""),
      workspaceRel: layout.workspaceRel,
    };
  } catch (error) {
    if (error instanceof TurnSetupError)
      return { kind: "refuse", reason: error.message };
    throw error;
  }
}
