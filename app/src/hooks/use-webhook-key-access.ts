/**
 * Whether the signed-in person may create or rotate a routine's webhook key,
 * by the SDK's creator-only rule (`webhookKeyAccess`). This hook only
 * supplies the genuine inputs: the routine's creator, the session's user id,
 * and whether the viewer owns the active space (`isSpaceOwner`, the same gate
 * the rest of the app draws). The gateway stays the enforcer.
 */

import { type WebhookKeyAccess, webhookKeyAccess } from "@houston/sdk";
import { isSpaceOwner } from "../lib/org-roles";
import { isTeamWorkspace } from "../lib/space-id";
import { useWorkspaceStore } from "../stores/workspaces";
import { useCapabilities } from "./use-capabilities";
import { useSession } from "./use-session";

export function useWebhookKeyAccess(
  createdBy: string | undefined,
): WebhookKeyAccess {
  const { data: session } = useSession();
  const { capabilities, isLoading } = useCapabilities();
  const workspace = useWorkspaceStore((s) => s.current);
  // Unknown until the capabilities answer: a null set before the fetch would
  // read as single-player and offer an action the gateway then refuses.
  const ownsSpace = isLoading
    ? undefined
    : isSpaceOwner(
        capabilities,
        workspace ? isTeamWorkspace(workspace.id) : false,
      );
  return webhookKeyAccess({
    createdBy,
    viewerId: session?.uid ?? null,
    ownsSpace,
  });
}
