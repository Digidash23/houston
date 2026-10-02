import { MAX_UPLOAD_BYTES } from "@houston/host/src/turn/files-import";
import { LazyStoreVfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type ObjectMetadata,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { publishIfAbsent } from "./op-doc-create";
import {
  AGENT_DOC_FAMILIES,
  type DocDeps,
  docTarget,
  type OpClaimTurn,
  publishFamilyDocs,
} from "./op-republish";
import type { SeedTree } from "./op-seed-tree";
import { computeSeedViews, type SeedViewSources } from "./op-seed-views";
import { type ActivityDocOptions, publish } from "./turn-activity-doc";
import { TURN_HYDRATE_MAX_BYTES } from "./turn-filesystem";
import {
  isSkillsView,
  publishSkillsView,
  type SkillsView,
  viewSlugs,
} from "./turn-skills-doc";

export interface SeedPublishInput {
  deps: DocDeps;
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  /** The listing the seed decided on; with `storeRoot` (what this op
   *  wrote), the agent exactly as the store now holds it. */
  objects: ObjectMetadata[];
  storeRoot: string;
  tree: SeedTree;
  views: SeedViewSources;
  /** An adopted tree, not a fresh seed: its pod may have captured its own
   *  provider views, which the baseline must never replace. */
  adopted?: boolean;
}

/** Views a pod captures from live state; an adopt only fills them in. */
const PROVIDER_VIEWS = new Set(["providers", "provider_usage"]);

/**
 * Everything the gateway serves a sleeping agent from, so the app's first
 * reads of an agent born asleep never wake a pod: the five family docs, the
 * skills list (the host's own `GET skills`) and the provider baseline. A
 * failed publish is a logged projection lag, never a failed seed.
 */
export async function publishSeedDocs(input: SeedPublishInput): Promise<void> {
  const target = docTarget(input.deps, input.turn);
  if (!target) return;
  const vfs = new LazyStoreVfs({
    store: input.store,
    prefix: input.prefix,
    root: input.storeRoot,
    objects: input.objects,
    manifest: new Map(),
    excludes: DEFAULT_EXCLUDES,
    maxObjectBytes: MAX_UPLOAD_BYTES,
    maxBytes: TURN_HYDRATE_MAX_BYTES,
  });
  let views: [string, unknown][] = [];
  const failures: string[] = [];
  try {
    views = await computeSeedViews(input, vfs);
  } catch (error) {
    failures.push(`views: ${String(error)}`);
  }
  const round = async () => {
    // The files are durable: a throw here (a network failure) is a lag to
    // log, never a failed seed.
    try {
      const out = await publishFamilyDocs(
        input.deps,
        input.turn,
        { store: input.store, prefix: input.prefix },
        input.tree.workspaceRel,
        AGENT_DOC_FAMILIES,
      );
      for (const [family, doc] of views) {
        const opts = { ...target, family };
        const outcome =
          family === "skills" && isSkillsView(doc)
            ? await publishSeedSkills(input, opts, doc)
            : input.adopted && PROVIDER_VIEWS.has(family)
              ? await publishIfAbsent(opts, doc)
              : await publish(opts, doc);
        if ("error" in outcome) out.push(`${family}: ${outcome.error}`);
      }
      return out;
    } catch (error) {
      return [`publish: ${String(error)}`];
    }
  };
  let lag = await round();
  if (lag.length > 0) {
    // One more round: a blip on the doc PUT is the common case.
    await new Promise((resolve) => setTimeout(resolve, 500));
    lag = await round();
  }
  failures.push(...lag);
  if (failures.length > 0) {
    // The files ARE durable; asleep reads lag until the next projection.
    console.error(
      `[op] seed projection failed after a durable sync: ${failures.join("; ")} prefix=${input.prefix}`,
    );
  }
}

/**
 * The skills view, merged per slug: only the skills this seed's listing
 * held move, each read back from the store after the doc revision is. A
 * turn may land and publish a skill (or delete one) after that listing, and
 * the seed's whole captured list would drop (or bring back) it.
 */
const publishSeedSkills = (
  input: SeedPublishInput,
  target: ActivityDocOptions,
  captured: SkillsView,
) =>
  publishSkillsView({
    target,
    source: { store: input.store, prefix: input.prefix },
    filesystem: input.tree,
    slugs: viewSlugs(captured),
    base: async () => captured,
  });
