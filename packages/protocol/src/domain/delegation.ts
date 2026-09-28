import { z } from "zod";

export const AGENT_DELEGATION_MODES = ["all", "picked", "off"] as const;
export type AgentDelegationMode = (typeof AGENT_DELEGATION_MODES)[number];

export interface AgentDelegation {
  mode: AgentDelegationMode;
  agents: string[];
  acceptsMissions: boolean;
}

export const DEFAULT_AGENT_DELEGATION: AgentDelegation = {
  mode: "all",
  agents: [],
  acceptsMissions: true,
};
export const MAX_DELEGATION_AGENTS = 200;

export const agentDelegationSchema = z.strictObject({
  mode: z.enum(AGENT_DELEGATION_MODES),
  agents: z.array(z.string().min(1)),
  acceptsMissions: z.boolean(),
});

export type AgentDelegationWriteRefusalCode =
  | "not_manager"
  | "agent_not_found"
  | "invalid_delegation_mode"
  | "invalid_delegation_agents"
  | "too_many_agents"
  | "unknown_agent";

export const AGENT_DELEGATION_REFUSAL_CODES = [
  "agent_scope",
  "caller_not_assigned",
  "delegation_off",
  "not_assigned",
  "agent_not_allowed",
  "agent_not_accepting",
  "mission_depth",
  "not_mission_origin",
  "no_acting_person",
] as const;
export type AgentDelegationRefusalCode =
  (typeof AGENT_DELEGATION_REFUSAL_CODES)[number];

export function isAgentDelegationRefusalCode(
  value: unknown,
): value is AgentDelegationRefusalCode {
  return AGENT_DELEGATION_REFUSAL_CODES.some((code) => code === value);
}

export type AgentDelegationParseResult =
  | { ok: true; value: AgentDelegation }
  | { ok: false; code: AgentDelegationWriteRefusalCode; error: string };

export function parseAgentDelegation(
  body: unknown,
  selfId: string,
): AgentDelegationParseResult {
  const mode = z
    .enum(AGENT_DELEGATION_MODES)
    .safeParse(
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? Reflect.get(body, "mode")
        : undefined,
    );
  if (!mode.success) {
    return {
      ok: false,
      code: "invalid_delegation_mode",
      error: "Choose all, picked, or off for delegation mode.",
    };
  }

  const parsed = agentDelegationSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_delegation_agents",
      error: "Provide agents and acceptsMissions in the delegation policy.",
    };
  }

  const { agents, acceptsMissions } = parsed.data;
  if (agents.length > MAX_DELEGATION_AGENTS) {
    return {
      ok: false,
      code: "too_many_agents",
      error: `Choose at most ${MAX_DELEGATION_AGENTS} agents.`,
    };
  }
  if (
    (mode.data !== "picked" && agents.length > 0) ||
    agents.includes(selfId)
  ) {
    return {
      ok: false,
      code: "invalid_delegation_agents",
      error: "Only picked mode may list other agents.",
    };
  }

  return {
    ok: true,
    value: { mode: mode.data, agents: [...new Set(agents)], acceptsMissions },
  };
}

export interface AgentDirectoryEntry {
  id: string;
  name: string;
  role?: string;
  space?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role?: string;
  instructions: string;
  truncated: boolean;
}
