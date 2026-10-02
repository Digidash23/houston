import { join, posix } from "node:path";
import { docKey, type HoustonFamily } from "@houston/domain";
import {
  canonicalJSON,
  etagRevision,
  parseDocBody,
} from "@houston/host/src/docs/wire";
import { MAX_UPLOAD_BYTES } from "@houston/host/src/turn/files-import";
import { LazyStoreVfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type ObjectStore,
  StoreConflictError,
} from "@houston/runtime-client/object-sync";
import {
  AGENT_DOC_FAMILIES,
  type DocDeps,
  docTarget,
  familyDoc,
  type OpClaimTurn,
} from "./op-republish";
import {
  type ActivityDocOptions,
  acceptPut,
  putAtRevision,
  request,
} from "./turn-activity-doc";
import { TURN_HYDRATE_MAX_BYTES } from "./turn-filesystem";

export interface MigrateProjection {
  /** Families whose doc this run created or brought up to the file. */
  published: HoustonFamily[];
  /** Projection failures: the files are durable, the docs lag. */
  lagging: string[];
  /** The routines file was rewritten in place to re-run its projections. */
  reprojected: boolean;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What a pod's boot projected that a quiet agent may never have had: every
 * family doc, and the routine schedule and trigger projections that ride a
 * routines PUT. Read from the store AFTER the migration landed, each doc's
 * revision BEFORE its file: a doc PUT another writer lands after that read is
 * a 409 here, and a writer that landed earlier wrote a file this read sees.
 * So a newer projection is never replaced by an older one. A family with no
 * file only fills a missing doc (the pod's projector answers the empty doc).
 * Failures are reported, never thrown: the files are what the store keeps.
 */
export async function projectMigratedStore(input: {
  deps: DocDeps;
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  workspaceRel: string;
  /** An empty scratch directory for the fresh reads. */
  root: string;
  /** Store-relative keys this run's sync uploaded. */
  uploaded: readonly string[];
}): Promise<MigrateProjection> {
  const out: MigrateProjection = {
    published: [],
    lagging: [],
    reprojected: false,
  };
  const objects = input.store.manifest
    ? await input.store.manifest(input.prefix)
    : [];
  const vfs = new LazyStoreVfs({
    store: input.store,
    prefix: input.prefix,
    root: input.root,
    objects,
    manifest: new Map(),
    excludes: DEFAULT_EXCLUDES,
    maxObjectBytes: MAX_UPLOAD_BYTES,
    maxBytes: TURN_HYDRATE_MAX_BYTES,
  });
  const listed = new Set(vfs.remoteKeys);
  const target = docTarget(input.deps, input.turn);
  for (const family of AGENT_DOC_FAMILIES) {
    if (!target) break;
    try {
      const opts = { ...target, family };
      if (await projectFamily(opts, family, input.workspaceRel, vfs, listed))
        out.published.push(family);
    } catch (error) {
      out.lagging.push(`${family}: ${message(error)}`);
    }
  }
  const routines = docKey(input.workspaceRel, "routines");
  const generation = objects.find(
    (o) => o.key === posix.join(input.prefix, routines),
  )?.generation;
  if (generation && !input.uploaded.includes(routines)) {
    try {
      await vfs.readBytes(routines);
      await input.store.upload(
        join(input.root, ...routines.split("/")),
        posix.join(input.prefix, routines),
        { ifGenerationMatch: generation },
      );
      out.reprojected = true;
    } catch (error) {
      // A conflict is a newer write, whose own PUT projected it.
      if (!(error instanceof StoreConflictError))
        out.lagging.push(`routines projection: ${message(error)}`);
    }
  }
  return out;
}

/** One family's doc brought up to its file; true when a PUT landed. */
async function projectFamily(
  opts: ActivityDocOptions,
  family: HoustonFamily,
  workspaceRel: string,
  vfs: LazyStoreVfs,
  listed: ReadonlySet<string>,
): Promise<boolean> {
  const seen = await request(opts);
  let revision = 0;
  let current: unknown;
  if (seen.ok) {
    const parsed = parseDocBody(await seen.text());
    revision = etagRevision(seen) ?? parsed.revision ?? 0;
    current = parsed.doc;
  } else {
    await seen.body?.cancel();
    if (seen.status !== 404) throw new Error(`GET rejected (${seen.status})`);
  }
  const key = docKey(workspaceRel, family);
  if (!listed.has(key) && current !== undefined) return false;
  const doc = familyDoc(
    family,
    listed.has(key) ? await vfs.readText(key) : null,
    key,
  );
  if (current !== undefined && canonicalJSON(current) === canonicalJSON(doc))
    return false;
  const response = await putAtRevision(opts, doc, revision);
  if (response.status === 409) {
    await response.body?.cancel();
    return false;
  }
  const outcome = await acceptPut(response);
  if ("error" in outcome) throw new Error(outcome.error);
  return "ok" in outcome;
}
