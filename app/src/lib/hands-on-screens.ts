import type { Agent, Capabilities } from "@houston/engine-adapter";
import {
  type HandsOnSurface,
  isHandsOnSurface,
} from "@houston/protocol/interaction-types";
import { canOpenAgentSettings } from "./agent-nav.ts";
import type { RosterLoadState } from "./roster-settled.ts";

/**
 * What a hands-on errand's card needs to know about the screen it points at,
 * kept pure (no hooks, no stores) so the node runner exercises every rule.
 * Navigation itself lives in `hands-on-navigation.ts`.
 */

/** The chat-namespace key naming each screen in the person's own words. */
const SCREEN_KEYS = {
  apiKeys: "interaction.handsOnScreens.apiKeys",
  billing: "interaction.handsOnScreens.billing",
  files: "interaction.handsOnScreens.files",
  routineWebhook: "interaction.handsOnScreens.routineWebhook",
  orgDanger: "interaction.handsOnScreens.orgDanger",
  agentApiAccess: "interaction.handsOnScreens.agentApiAccess",
} as const satisfies Record<HandsOnSurface, string>;

export function handsOnScreenKey(
  surface: HandsOnSurface,
): (typeof SCREEN_KEYS)[HandsOnSurface] {
  return SCREEN_KEYS[surface];
}

/** Where an errand on ONE employee's screen stands against the roster. */
export type HandsOnAgentTarget =
  /** The roster is still loading: nothing can be said yet. */
  | { kind: "pending" }
  /** No employee named, or one the settled roster does not hold. */
  | { kind: "absent" }
  | { kind: "found"; agent: Pick<Agent, "id" | "name" | "access"> };

/**
 * Resolve the employee a step names. There is deliberately no fallback to the
 * employee on screen: a step without one (an older peer) would otherwise hand
 * the person some other employee's IDs to paste into their code.
 */
export function resolveHandsOnAgent(
  agentId: string | undefined,
  roster: RosterLoadState & {
    agents: readonly Pick<Agent, "id" | "name" | "access">[];
  },
): HandsOnAgentTarget {
  if (!agentId) return { kind: "absent" };
  const agent = roster.agents.find((a) => a.id === agentId);
  if (agent) return { kind: "found", agent };
  return roster.loaded && !roster.loading
    ? { kind: "absent" }
    : { kind: "pending" };
}

/**
 * Whether the person can open that employee's Settings, the only door to its
 * API access (drawn for its managers alone). `undefined` while the roster
 * loads, which the gate reads as reachable rather than flashing "unavailable".
 */
export function handsOnAgentSettings(
  target: HandsOnAgentTarget,
  caps: Capabilities | null | undefined,
): boolean | undefined {
  if (target.kind === "pending") return undefined;
  if (target.kind === "absent") return false;
  return canOpenAgentSettings(caps, target.agent);
}

/** The copy that names a screen: a chat-namespace key, plus the employee. */
export type HandsOnScreenLabel =
  | { key: "interaction.handsOnUnknownScreen" }
  | { key: (typeof SCREEN_KEYS)[HandsOnSurface] }
  | { key: "interaction.handsOnAgentApiAccessFor"; name: string };

/**
 * How a step names its screen. One employee's screen names that employee, so
 * two cards for two employees never read the same; a name the roster cannot
 * resolve yet falls back to the plain screen name. A screen this build does not
 * know (a newer engine named it) reads as the generic "this screen".
 */
export function handsOnScreenLabel(
  step: { surface: string; agentId?: string },
  agentName: (id: string) => string | undefined,
): HandsOnScreenLabel {
  if (!isHandsOnSurface(step.surface))
    return { key: "interaction.handsOnUnknownScreen" };
  const name =
    step.surface === "agentApiAccess" && step.agentId
      ? agentName(step.agentId)
      : undefined;
  return name
    ? { key: "interaction.handsOnAgentApiAccessFor", name }
    : { key: handsOnScreenKey(step.surface) };
}
