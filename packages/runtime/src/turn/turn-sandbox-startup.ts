import { bootGondolinVm } from "../code-vm/gondolin";
import { TurnCodeVm } from "../code-vm/turn-code-vm";
import { config } from "../config";
import type { TurnServerDeps } from "./server-types";
import { startTurnCoordinator } from "./turn-coordinator";
import type { TurnFilesystem } from "./turn-filesystem";
import { makeTurnSandboxFetch } from "./turn-sandbox";
import type { poolIdentity, resolveTurnStore } from "./turn-store";
import type { TurnRequest } from "./types";

/** Build the grant-bound sandbox after identity validation. */
export function createTurnSandbox(input: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  identity: ReturnType<typeof poolIdentity> | undefined;
  resolved: ReturnType<typeof resolveTurnStore>;
  filesystem: TurnFilesystem;
}): ReturnType<typeof makeTurnSandboxFetch> | null {
  const { turn, identity } = input;
  if (!turn.grant || !turn.hostToken || !identity) return null;
  // A VM only for a turn allowed to run code; it boots on warm, not here.
  const bootCodeVm =
    input.deps.bootCodeVm ??
    (config.codeRunTarget === "vm" ? bootGondolinVm : undefined);
  const codeVm =
    bootCodeVm && turn.grant.scopes.includes("code-run")
      ? new TurnCodeVm(bootCodeVm)
      : undefined;
  // Houston's own turn: the gateway marked it, and bound the token to the
  // owner, who is the person this turn acts for.
  const coordinator =
    turn.coordinator && turn.actingAs
      ? startTurnCoordinator({
          turn,
          ownerId: turn.actingAs.userId,
          token: turn.coordinator.token,
          gatewayUrl: turn.grant.url,
          agentSlug: identity.agent,
          store: input.resolved.store,
          prefix: input.resolved.prefix,
          filesystem: input.filesystem,
          ...(input.deps.fetchImpl ? { fetchImpl: input.deps.fetchImpl } : {}),
        })
      : undefined;
  return makeTurnSandboxFetch({
    grant: turn.grant,
    hostToken: turn.hostToken,
    store: input.resolved.store,
    prefix: input.resolved.prefix,
    filesystem: input.filesystem,
    workspaceId: turn.workspaceId,
    conversationId: turn.conversationId,
    ...(turn.actingAs ? { actingAs: turn.actingAs } : {}),
    orgSlug: identity.org,
    agentSlug: identity.agent,
    ...(input.deps.fetchImpl ? { fetchImpl: input.deps.fetchImpl } : {}),
    ...(codeVm ? { codeVm } : {}),
    ...(coordinator ? { coordinator } : {}),
  });
}
