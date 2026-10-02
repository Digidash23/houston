import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { dispatchAgentOp } from "@houston/host/src/op/dispatch";
import { MAX_UPLOAD_BYTES } from "@houston/host/src/turn/files-import";
import { LazyStoreVfs, PrefixedVfs } from "@houston/host/src/vfs";
import {
  DEFAULT_EXCLUDES,
  type ObjectMetadata,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { listProviders } from "../ai/providers";
import { listProviderUsage } from "../ai/usage";
import { config } from "../config";
import { publishIfAbsent } from "./op-doc-create";
import {
  AGENT_DOC_FAMILIES,
  type DocDeps,
  docTarget,
  type OpClaimTurn,
  publishFamilyDocs,
} from "./op-republish";
import type { SeedTree } from "./op-seed-tree";
import { publish } from "./turn-activity-doc";
import { TURN_HYDRATE_MAX_BYTES } from "./turn-filesystem";

/**
 * The provider answers a brand-new agent's pod gives: the runtime's baseline
 * (no settings, no credential, no custom endpoint). Both read the worker's
 * own `dataDir`, which a pool worker never writes an agent's state into; the
 * gateway overlays the connected set and active provider on every asleep
 * serve, so the baseline's unconfigured rows are the right ones.
 */
export interface SeedViewSources {
  providers: () => unknown;
  providerUsage: () => Promise<unknown>;
  dataDir: string;
}

export const RUNTIME_VIEW_SOURCES: SeedViewSources = {
  providers: () => listProviders(),
  providerUsage: () => listProviderUsage(),
  dataDir: config.dataDir,
};

const AGENT_STATE_FILES = [
  "settings.json",
  "auth.json",
  "custom-endpoint.json",
];

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
    views = await computeViews(input, vfs);
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
        vfs,
        input.tree.workspaceRel,
        AGENT_DOC_FAMILIES,
      );
      for (const [family, doc] of views) {
        const opts = { ...target, family };
        const outcome =
          input.adopted && PROVIDER_VIEWS.has(family)
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

async function computeViews(
  input: SeedPublishInput,
  vfs: LazyStoreVfs,
): Promise<[string, unknown][]> {
  const out: [string, unknown][] = [];
  // The host resolves the agent from its folder; an adopt wrote nothing.
  await mkdir(join(input.storeRoot, ...input.tree.workspaceRel.split("/")), {
    recursive: true,
  });
  const skills = await dispatchAgentOp({
    workspacesRoot: join(input.storeRoot, "workspaces"),
    agentId: input.tree.id,
    vfs: new PrefixedVfs(vfs, "workspaces"),
    request: { method: "GET", rest: "skills", triggersEnabled: false },
  });
  if (skills.status === 200) out.push(["skills", JSON.parse(skills.body)]);
  else
    console.error(
      `[op] seed skills view not captured: ${skills.status} prefix=${input.prefix}`,
    );
  const state = AGENT_STATE_FILES.filter((file) =>
    existsSync(join(input.views.dataDir, file)),
  );
  if (state.length > 0) {
    // A reused worker's config dir would publish another agent's providers.
    console.warn(
      `[op] seed provider views skipped: worker data dir holds ${state.join(", ")} prefix=${input.prefix}`,
    );
    return out;
  }
  const runtime = posix.join(
    input.prefix,
    input.tree.workspaceRel,
    ".houston",
    "runtime",
  );
  const own = AGENT_STATE_FILES.filter((file) =>
    input.objects.some((o) => o.key === posix.join(runtime, file)),
  );
  if (own.length > 0) {
    // An adopted agent with its own provider state: the baseline would be
    // wrong for it, and its pod keeps its own view current.
    console.warn(
      `[op] seed provider views skipped: the agent holds ${own.join(", ")} prefix=${input.prefix}`,
    );
    return out;
  }
  out.push(["providers", input.views.providers()]);
  out.push(["provider_usage", await input.views.providerUsage()]);
  return out;
}
