import { join } from "node:path";
import { dispatchAgentOp } from "@houston/host/src/op/dispatch";
import { PrefixedVfs } from "@houston/host/src/vfs";
import { engineAgentId } from "./op-scope";
import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import {
  isSkillsView,
  landedSkillSlugs,
  publishSkillsView,
  type SkillsView,
} from "./turn-skills-doc";
import type { TurnRequest } from "./types";

/** The pod's own `GET skills` over the turn's tree: byte parity by construction. */
async function captureSkillsView(
  filesystem: TurnFilesystem,
): Promise<SkillsView | undefined> {
  const answer = await dispatchAgentOp({
    workspacesRoot: join(filesystem.storeRoot, "workspaces"),
    agentId: engineAgentId(filesystem),
    vfs: new PrefixedVfs(filesystem.vfs, "workspaces"),
    request: { method: "GET", rest: "skills", triggersEnabled: false },
  });
  if (answer.status !== 200) return undefined;
  const view = JSON.parse(answer.body) as unknown;
  return isSkillsView(view) ? view : undefined;
}

/**
 * Republish the skills view a claimed turn changed. The gateway serves a
 * sleeping agent's Skills tab from that doc, so without this a skill the
 * agent wrote (or deleted) stays invisible until a pod wakes. Null when the
 * turn landed no SKILL.md or has no doc system to project into.
 */
export async function publishLandedSkillsView(input: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  filesystem: TurnFilesystem;
  source: ActivityDocSource;
  landed: readonly string[];
}): Promise<ActivityDocPublishResult | null> {
  const { filesystem } = input;
  const slugs = landedSkillSlugs(filesystem.workspaceRel, input.landed);
  // Only a standing tree is an agent the host's handlers can resolve.
  if (slugs.size === 0 || filesystem.kind !== "standing") return null;
  const target = turnDocTarget(input.deps, input.turn, "skills");
  if (!target) return null;
  return publishSkillsView({
    target,
    source: input.source,
    filesystem,
    slugs,
    base: () => captureSkillsView(filesystem),
  });
}
