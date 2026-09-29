import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { normalizeActivities, parseJsonDoc } from "@houston/domain";
import type { Activity } from "@houston/protocol";
import {
  mergeActivityArrays,
  ObjectNotFoundError,
  type ObjectStore,
  trustedBase,
} from "@houston/runtime-client/object-sync";
import type { TurnFilesystem } from "./turn-filesystem";
import { turnActivityKey } from "./turn-filesystem-scope";

/** The stored board with the turn's own board edits merged onto it. */
export interface StoredBoard {
  items: Activity[];
  /**
   * Call once `items` (plus the title) IS the tree's board: sync-back then
   * guards on the generation read here and merges three-way against exactly
   * these bytes, so a card the gateway created after hydration is no longer
   * "locally new" and a concurrent write to it merges field by field.
   */
  adopt(): void;
}

/** Read the stored board fresh; null when it does not exist. */
export type RemoteActivityReader = () => Promise<StoredBoard | null>;

type BoardTree = Pick<
  TurnFilesystem,
  "storeRoot" | "workspaceRel" | "manifest" | "generationAware"
>;

interface StoredRead {
  raw: string;
  hash: string;
  generation?: string;
}

/**
 * Read the agent's `activity.json` fresh from the SAME object store (and key)
 * sync-back writes. A new mission's card is created concurrently with its first
 * send, so the tree hydrated at dispatch often predates it; this read is how
 * the after-turn title still finds the card. Downloaded to a temp file OUTSIDE
 * the hydrated tree, so it can never ride sync-back itself.
 */
export function remoteActivityReader(
  store: ObjectStore,
  prefix: string,
  tree: BoardTree,
): RemoteActivityReader {
  return async () => {
    const rel = turnActivityKey(tree.workspaceRel);
    const key = prefix ? posix.join(prefix, rel) : rel;
    const read = await readStored(store, key);
    if (!read) return null;
    const previous = tree.manifest.get(rel);
    const stored = parseJsonDoc(read.raw, key);
    // The turn's edits are its tree's board against the bytes it hydrated.
    const local = await readCards(join(tree.storeRoot, ...rel.split("/")));
    const base = trustedBase(previous);
    const rebased = Array.isArray(stored)
      ? mergeActivityArrays(
          stored,
          local ?? [],
          base === undefined ? undefined : cardsIn(parseJsonDoc(base, key)),
        )
      : stored;
    return {
      items: normalizeActivities(rebased, key).items,
      adopt: () => {
        const generation = read.generation ?? previous?.generation;
        // No generation to guard on would make a guarded store's upload
        // unconditional: keep the hydrated entry and its two-way merge.
        if (generation === undefined && tree.generationAware) return;
        tree.manifest.set(rel, {
          hash: read.hash,
          mergeBase: read.raw,
          ...(generation === undefined ? {} : { generation }),
        });
      },
    };
  };
}

/** One read with the generation it was served at, when the store has one. */
async function readStored(
  store: ObjectStore,
  key: string,
): Promise<StoredRead | null> {
  const dir = await mkdtemp(join(tmpdir(), "mission-title-"));
  const dest = join(dir, "activity.json");
  try {
    let generation: string | undefined;
    if (store.downloadVersioned)
      ({ generation } = await store.downloadVersioned(key, dest));
    else await store.download(key, dest);
    const bytes = await readFile(dest);
    return {
      raw: bytes.toString("utf8"),
      hash: createHash("sha256").update(bytes).digest("hex"),
      ...(generation === undefined ? {} : { generation }),
    };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The tree's board cards; undefined when the turn has no board file. */
async function readCards(path: string): Promise<unknown[] | undefined> {
  try {
    return cardsIn(parseJsonDoc(await readFile(path, "utf8"), path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

const cardsIn = (doc: unknown): unknown[] | undefined =>
  Array.isArray(doc) ? doc : undefined;
