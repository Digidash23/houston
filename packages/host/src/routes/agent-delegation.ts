import { parseAgentDelegation } from "@houston/protocol";
import { authorizeAgent } from "./agent-authz";
import {
  readAgentDelegation,
  writeAgentDelegation,
} from "./agent-delegation-store";
import { withAgentPolicyLock } from "./agent-rename-policy";
import { json, readJson } from "./http";
import { defineRoute } from "./registry";

defineRoute({
  group: "agent-delegation",
  method: ["GET", "PUT"],
  path: "/v1/agents/:agentId/delegation",
  methodMismatch: "405",
  phase: "user",
  classification: "sdk",
  source: "packages/host/src/routes/agent-delegation.ts",
  async handler({ deps, userId, params, method, req, res }) {
    const agentId = params.agentId ?? "";
    const authz = await authorizeAgent(deps, userId, agentId);
    if (!authz.ok) {
      const code = authz.status === 404 ? "agent_not_found" : "not_manager";
      return json(res, authz.status, { code, error: authz.reason });
    }
    if (!deps.vfs)
      return json(res, 503, { error: "agent data not configured" });
    const vfs = deps.vfs;
    const { workspace } = authz;
    if (method === "GET") {
      const stored = await readAgentDelegation(vfs, workspace.id, agentId);
      const addressable = new Set(
        (await deps.store.listAgents(workspace.id))
          .filter((agent) => !agent.name.startsWith("."))
          .map((agent) => agent.id),
      );
      return json(res, 200, {
        ...stored,
        agents: stored.agents.filter((id) => addressable.has(id)),
      });
    }
    const parsed = parseAgentDelegation(await readJson(req), agentId);
    if (!parsed.ok)
      return json(res, 400, { code: parsed.code, error: parsed.error });
    return withAgentPolicyLock(workspace.id, async () => {
      const current = await authorizeAgent(deps, userId, agentId);
      if (!current.ok) {
        const code = current.status === 404 ? "agent_not_found" : "not_manager";
        return json(res, current.status, { code, error: current.reason });
      }
      const addressable = new Set(
        (await deps.store.listAgents(workspace.id))
          .filter((agent) => !agent.name.startsWith("."))
          .map((agent) => agent.id),
      );
      const unknown = parsed.value.agents.filter((id) => !addressable.has(id));
      if (unknown.length > 0)
        return json(res, 400, {
          code: "unknown_agent",
          error: "Choose AI Employees in the same space.",
          agents: unknown,
        });
      await writeAgentDelegation(vfs, workspace.id, agentId, parsed.value, [
        ...addressable,
      ]);
      deps.events?.emit(workspace.ownerUserId, {
        type: "AgentsChanged",
        workspaceId: workspace.id,
      });
      json(res, 200, parsed.value);
    });
  },
});
