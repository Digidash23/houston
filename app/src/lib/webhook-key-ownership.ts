import type { Capabilities } from "@houston/engine-adapter";
import { isSpaceOwner } from "./org-roles";
import { isTeamWorkspace } from "./space-id";

/**
 * Whether the viewer owns the active space, as the SDK's webhook-key rule
 * takes it (`webhookKeyAccess`): the same owner line `isSpaceOwner` draws,
 * or undefined while the answer is not known. Capabilities still loading, a
 * capabilities fetch that failed (null past loading) and no active workspace
 * are all unknown: a null set would read as single-player and offer an action
 * the gateway then refuses. Pure, so it unit-tests under bare node.
 */
export function webhookKeyOwnership(input: {
  capabilities: Capabilities | null;
  capabilitiesLoading: boolean;
  workspaceId: string | null;
}): boolean | undefined {
  if (input.capabilitiesLoading || !input.capabilities || !input.workspaceId)
    return undefined;
  return isSpaceOwner(input.capabilities, isTeamWorkspace(input.workspaceId));
}
