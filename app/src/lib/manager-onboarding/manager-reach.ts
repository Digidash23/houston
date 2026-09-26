// `.ts` extensions so the node test runner can import this module directly.
import type { Capabilities } from "@houston/engine-adapter";
import { integrationsSupported } from "../../components/integrations/model.ts";
import { hasSpaces } from "../org-roles.ts";
import type { ManagerReach } from "./script-types.ts";

/**
 * What the AI Manager can do on this deployment, read from its capabilities:
 * the same answer the manager's own capability map is narrowed to. Teammates
 * join a shared space, which only a deployment with spaces serves (the
 * desktop and a self-host serve no invitations); tools connect wherever an
 * integrations provider is wired. Unknown capabilities promise neither.
 */
export function managerReach(capabilities: Capabilities | null): ManagerReach {
  return {
    invite: hasSpaces(capabilities),
    connect: integrationsSupported(capabilities),
  };
}
