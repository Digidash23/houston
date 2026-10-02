import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { dispatchAgentOp } from "@houston/host/src/op/dispatch";
import { type LazyStoreVfs, PrefixedVfs } from "@houston/host/src/vfs";
import type { ObjectMetadata } from "@houston/runtime-client/object-sync";
import { listProviders } from "../ai/providers";
import { listProviderUsage } from "../ai/usage";
import { config } from "../config";
import type { SeedTree } from "./op-seed-tree";

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

/** What the seed's views are captured from: the agent as the store now
 *  holds it (its listing plus what this op wrote under `storeRoot`). */
export interface SeedViewInput {
  prefix: string;
  objects: ObjectMetadata[];
  storeRoot: string;
  tree: SeedTree;
  views: SeedViewSources;
}

/**
 * The views a new pod would capture: the skills list (the host's own `GET
 * skills`) and, when nothing says the agent has its own, the provider
 * baseline.
 */
export async function computeSeedViews(
  input: SeedViewInput,
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
