import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentDirectoryEntry, AgentProfile } from "@houston/protocol";
import { type Static, Type } from "typebox";
import { missionCall } from "./mission-call";
import {
  LIST_AGENTS_TOOL_NAME,
  READ_AGENT_TOOL_NAME,
} from "./mission-tool-names";
import type { SandboxFetch } from "./sandbox-fetch";
import { type SessionToolErrorDetails, toolErrorResult } from "./tool-error";

export interface AgentDirectoryToolOptions {
  call: SandboxFetch;
}

type DirectoryDetails = { ok: true; count: number } | SessionToolErrorDetails;
type ProfileDetails =
  | { ok: true; id: string; truncated: boolean }
  | SessionToolErrorDetails;

const readParams = Type.Object({
  agent: Type.String({
    description:
      "The AI Employee's name, or its id if two share a name, from list_agents.",
  }),
});

export function makeAgentDirectoryTools(opts: AgentDirectoryToolOptions) {
  const call = missionCall(opts.call);
  const list = defineTool({
    name: LIST_AGENTS_TOOL_NAME,
    label: "See other AI Employees",
    description:
      "List the other AI Employees you can work with: name, role and space. Use it before handing work to one with start_mission (set 'agent'), or before reading its instructions with read_agent or its missions with list_missions. If this is turned off for you the answer says so; tell the user plainly and do the work yourself.",
    promptSnippet: "List other AI Employees",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(
      _id,
      _params,
      signal,
    ): Promise<AgentToolResult<DirectoryDetails>> {
      const result = await call<{ agents: AgentDirectoryEntry[] }>(
        "GET",
        "/agents",
        undefined,
        signal,
      );
      if (!result.ok) return toolErrorResult(result.error);
      if (!Array.isArray(result.data?.agents)) {
        return toolErrorResult({
          code: "host_error",
          message: "The AI Employee list came back in an unreadable shape.",
        });
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result.data.agents) },
        ],
        details: { ok: true, count: result.data.agents.length },
      };
    },
  });
  const read = defineTool({
    name: READ_AGENT_TOOL_NAME,
    label: "Read an AI Employee's instructions",
    description:
      "Read another AI Employee's instructions (its job description) to understand what it does before giving it work. For its missions use list_missions and read_mission with 'agent'.",
    promptSnippet: "Read an AI Employee's instructions",
    parameters: readParams,
    executionMode: "sequential",
    async execute(
      _id,
      params: Static<typeof readParams>,
      signal,
    ): Promise<AgentToolResult<ProfileDetails>> {
      const agent = params.agent.trim();
      if (!agent) {
        return toolErrorResult({
          code: "agent_not_found",
          message: "Name an AI Employee from list_agents.",
        });
      }
      const result = await call<AgentProfile>(
        "GET",
        `/agents/read?agent=${encodeURIComponent(agent)}`,
        undefined,
        signal,
      );
      if (!result.ok) return toolErrorResult(result.error);
      const profile = result.data;
      if (
        typeof profile?.id !== "string" ||
        typeof profile.instructions !== "string"
      ) {
        return toolErrorResult({
          code: "host_error",
          message:
            "The AI Employee's instructions came back in an unreadable shape.",
        });
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(profile) }],
        details: { ok: true, id: profile.id, truncated: profile.truncated },
      };
    },
  });
  return [list, read];
}
