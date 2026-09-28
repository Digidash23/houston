import { type AgentDelegation, parseAgentDelegation } from "@houston/protocol";
import type { Vfs } from "../vfs";
import { editRawAgentEntry } from "./agent-origin-rename";

export interface DelegationDoc {
  version: 1;
  agents: Record<string, unknown>;
  raw: string | null;
}

export class CorruptDelegationDocumentError extends Error {
  constructor(
    key: string,
    readonly raw: string,
    cause: unknown,
  ) {
    super(`corrupt document ${key}`, { cause });
  }
}

export const CLOSED_DELEGATION: AgentDelegation = {
  mode: "off",
  agents: [],
  acceptsMissions: false,
};

export const delegationDocKey = (workspaceId: string): string =>
  `${workspaceId}/.agent-delegation.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readDoc(vfs: Vfs, key: string): Promise<DelegationDoc> {
  const empty: DelegationDoc = { version: 1, agents: {}, raw: null };
  const raw = await vfs.readText(key);
  if (raw === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.agents))
      throw new Error("invalid document shape");
  } catch (error) {
    console.error(`[agent-delegation] corrupt document ${key}:`, error);
    throw new CorruptDelegationDocumentError(key, raw, error);
  }
  for (const [id, policy] of Object.entries(parsed.agents)) {
    const result = parseAgentDelegation(policy, id);
    if (!result.ok) {
      console.error(
        `[agent-delegation] invalid policy for ${id} in ${key}:`,
        new Error(result.code),
      );
    }
  }
  return { version: 1, agents: parsed.agents, raw };
}

export async function saveDoc(
  vfs: Vfs,
  key: string,
  doc: DelegationDoc,
): Promise<void> {
  if (Object.keys(doc.agents).length === 0) {
    await vfs.deleteKey(key);
    return;
  }
  await vfs.writeText(
    key,
    `${JSON.stringify({ version: 1, agents: doc.agents }, null, 2)}\n`,
  );
}

export async function saveEditedDoc(
  vfs: Vfs,
  key: string,
  doc: DelegationDoc,
  edits: Map<string, unknown | null>,
): Promise<void> {
  if (doc.raw === null) return saveDoc(vfs, key, doc);
  if (Object.keys(doc.agents).length === 0) return vfs.deleteKey(key);
  let raw = doc.raw;
  for (const [id, value] of edits) raw = replaceRawEntry(raw, id, value);
  if (raw !== doc.raw) await vfs.writeText(key, raw);
}

export function replaceRawEntry(
  raw: string,
  id: string,
  value: unknown | null,
): string {
  let edited = raw;
  while (
    Object.hasOwn(
      (JSON.parse(edited) as { agents: Record<string, unknown> }).agents,
      id,
    )
  ) {
    const removed = editRawAgentEntry(edited, id, null);
    if (removed === edited)
      throw new Error(`could not remove duplicate policy for ${id}`);
    edited = removed;
  }
  return value === null ? edited : editRawAgentEntry(edited, id, value);
}
