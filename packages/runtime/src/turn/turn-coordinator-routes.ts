import { join } from "node:path";
import type { CoordinatorScope } from "@houston/host/src/assistant/coordinator-scope";
import { LocalWorkspaceStore } from "@houston/host/src/store/local";
import { PrefixedVfs } from "@houston/host/src/vfs";
import type { TurnApprovals } from "./turn-approvals";
import type { TurnCoordinatorInput } from "./turn-coordinator";
import type { CoordinatorRoutes } from "./turn-coordinator-server";

/**
 * What the host's handlers are built from for one Houston turn: the hydrated
 * tree as the host's store and files, and the turn's approval records, made
 * durable before a spent receipt's operation leaves.
 */
export function coordinatorRoutes(
  input: TurnCoordinatorInput,
  scope: CoordinatorScope,
  claim: { workspaceId: string; agentId: string },
  approvals: () => Promise<TurnApprovals>,
): CoordinatorRoutes {
  const store = new LocalWorkspaceStore(
    join(input.filesystem.storeRoot, "workspaces"),
  );
  const vfs = new PrefixedVfs(input.filesystem.vfs, "workspaces");
  const fetchImpl = input.fetchImpl ? { fetchImpl: input.fetchImpl } : {};
  return {
    scope,
    claim,
    assistant: async () => {
      const records = await approvals();
      return {
        store,
        vfs,
        approvals: records.approvals,
        persistApprovals: () => records.save(),
        // Behind the gateway the whole catalogued surface is served.
        unservedOperations: () => new Set<string>(),
        ...fetchImpl,
      };
    },
    // Houston keeps no board: every mission it starts lands on another
    // agent, which judges the pinned provider against its own credentials.
    missions: { store, vfs, channels: {} },
  };
}
