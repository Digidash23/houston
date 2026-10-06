/**
 * Ready-to-run `curl` examples for the Houston API, so a person sees what a
 * request looks like instead of reading about it. One builder per example for
 * every surface (the key reveal, an employee's API access), matching the
 * developer docs.
 *
 * {@link apiTryKeyRequest} embeds a freshly minted key on purpose: it is shown
 * once, in the same card as the key itself, and lives only in that card's
 * local state. {@link apiStartMissionRequest} never carries a key; it reads
 * `$HOUSTON_API_KEY` like the setup prompt does.
 */
import { HOUSTON_API_KEY_ENV } from "./api-setup-prompt";

const origin = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

/** Lists the person's AI Employees: the smallest call that proves a key works. */
export function apiTryKeyRequest(input: {
  baseUrl: string;
  key: string;
}): string {
  return `curl -s ${origin(input.baseUrl)}/agents \\
  -H "Authorization: Bearer ${input.key}"`;
}

/** Starts a task with one employee, in the organization it lives in. */
export function apiStartMissionRequest(input: {
  baseUrl: string;
  agentId: string;
  orgId: string;
}): string {
  const agent = encodeURIComponent(input.agentId);
  return `curl -s -X POST ${origin(input.baseUrl)}/v1/agents/${agent}/missions \\
  -H "Authorization: Bearer $${HOUSTON_API_KEY_ENV}" \\
  -H "x-houston-org: ${input.orgId}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Say hi and tell me what you can help with."}'`;
}
