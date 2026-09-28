import {
  type AgentDelegationRefusalCode,
  type AgentProfile,
  isAgentDelegationRefusalCode,
} from "@houston/protocol";
import { delegationRefusal } from "./mission-delegation-refusals";
import type { RemoteMissionRoute } from "./missions-remote";
import { remoteHeaders } from "./missions-remote-forward";

export async function readRemoteInstructions(
  route: RemoteMissionRoute,
): Promise<RemoteInstructionsResult> {
  const url = `${route.gateway.url}/agents/${encodeURIComponent(route.target.id)}/agentfile/CLAUDE.md`;
  let response: Response;
  try {
    response = await (route.fetchImpl ?? fetch)(url, {
      headers: remoteHeaders(route),
    });
  } catch (err) {
    console.error(
      `[missions] could not read ${route.target.name}'s instructions`,
      err,
    );
    return unreadable();
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    console.error(
      `[missions] unreadable instructions for ${route.target.name}`,
      err,
    );
    return unreadable();
  }
  if (!response.ok) {
    const code = (payload as { code?: unknown } | null)?.code;
    if (isAgentDelegationRefusalCode(code)) {
      const refusal = delegationRefusal(code, route.target.name);
      return { ok: false, status: response.status, code, error: refusal.error };
    }
    console.error(
      `[missions] instructions refused for ${route.target.name} (${response.status})`,
      payload,
    );
    return unreadable();
  }
  const content = (payload as { content?: unknown } | null)?.content;
  if (typeof content !== "string") {
    console.error(
      `[missions] instructions missing content for ${route.target.name}`,
    );
    return unreadable();
  }
  return {
    ok: true,
    profile: {
      id: route.target.id,
      name: route.target.name,
      ...(route.target.role ? { role: route.target.role } : {}),
      instructions: content.slice(0, 12_000),
      truncated: content.length > 12_000,
    },
  };
}

type RemoteInstructionsResult =
  | { ok: true; profile: AgentProfile }
  | {
      ok: false;
      status: number;
      code: AgentDelegationRefusalCode | "agents_unreadable";
      error: string;
    };

function unreadable(): Extract<RemoteInstructionsResult, { ok: false }> {
  return {
    ok: false,
    status: 502,
    code: "agents_unreadable",
    error:
      "could not read that AI Employee's instructions right now - try again",
  };
}
