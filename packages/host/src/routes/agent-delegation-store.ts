import { withDocLock } from "@houston/domain";
import {
  type AgentDelegation,
  DEFAULT_AGENT_DELEGATION,
  parseAgentDelegation,
} from "@houston/protocol";
import type { Vfs } from "../vfs";

import {
  CLOSED_DELEGATION,
  CorruptDelegationDocumentError,
  type DelegationDoc,
  delegationDocKey,
  readDoc,
  replaceRawEntry,
  saveDoc,
  saveEditedDoc,
} from "./agent-delegation-document";

export { delegationDocKey } from "./agent-delegation-document";

function isDefault(policy: AgentDelegation): boolean {
  return (
    policy.mode === "all" &&
    policy.agents.length === 0 &&
    policy.acceptsMissions
  );
}

export async function readAgentDelegation(
  vfs: Vfs,
  workspaceId: string,
  agentId: string,
): Promise<AgentDelegation> {
  try {
    const doc = await readDoc(vfs, delegationDocKey(workspaceId));
    const raw = doc.agents[agentId];
    if (raw === undefined) return { ...DEFAULT_AGENT_DELEGATION, agents: [] };
    const parsed = parseAgentDelegation(raw, agentId);
    return parsed.ok ? parsed.value : { ...CLOSED_DELEGATION, agents: [] };
  } catch (error) {
    if (!(error instanceof CorruptDelegationDocumentError)) throw error;
    return { ...CLOSED_DELEGATION, agents: [] };
  }
}

export function writeAgentDelegation(
  vfs: Vfs,
  workspaceId: string,
  agentId: string,
  policy: AgentDelegation,
  addressableAgentIds?: readonly string[],
): Promise<void> {
  const key = delegationDocKey(workspaceId);
  return withDocLock(key, async () => {
    let doc: DelegationDoc;
    try {
      doc = await readDoc(vfs, key);
    } catch (error) {
      if (
        !(error instanceof CorruptDelegationDocumentError) ||
        !addressableAgentIds
      )
        throw error;
      const backup = `${workspaceId}/.agent-delegation.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`;
      await vfs.writeText(backup, error.raw);
      console.error(
        `[agent-delegation] recovered corrupt document ${key} to ${backup}:`,
        error,
      );
      doc = { version: 1, agents: {}, raw: null };
      for (const id of addressableAgentIds)
        doc.agents[id] = { ...CLOSED_DELEGATION, agents: [] };
      doc.agents[agentId] = policy;
      await saveDoc(vfs, key, doc);
      return;
    }
    if (doc.raw !== null) {
      const updated = replaceRawEntry(
        doc.raw,
        agentId,
        isDefault(policy) ? null : policy,
      );
      const remaining =
        isDefault(policy) && doc.agents[agentId] !== undefined
          ? Object.keys(doc.agents).length - 1
          : Object.keys(doc.agents).length;
      if (remaining === 0) await vfs.deleteKey(key);
      else await vfs.writeText(key, updated);
      return;
    }
    if (isDefault(policy)) delete doc.agents[agentId];
    else doc.agents[agentId] = policy;
    await saveDoc(vfs, key, doc);
  });
}

export function moveAgentDelegation(
  vfs: Vfs,
  workspaceId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) return Promise.resolve();
  return changeAgentDelegation(vfs, workspaceId, fromId, toId);
}

export function pruneAgentDelegation(
  vfs: Vfs,
  workspaceId: string,
  agentId: string,
): Promise<void> {
  return changeAgentDelegation(vfs, workspaceId, agentId);
}

export function restoreAgentDelegationEntry(
  vfs: Vfs,
  workspaceId: string,
  agentId: string,
  prior: unknown | undefined,
): Promise<void> {
  const key = delegationDocKey(workspaceId);
  return withDocLock(key, async () => {
    const doc = await readDoc(vfs, key);
    if (prior === undefined) delete doc.agents[agentId];
    else doc.agents[agentId] = prior;
    await saveEditedDoc(
      vfs,
      key,
      doc,
      new Map([[agentId, prior === undefined ? null : prior]]),
    );
  });
}

function changeAgentDelegation(
  vfs: Vfs,
  workspaceId: string,
  fromId: string,
  toId?: string,
): Promise<void> {
  const key = delegationDocKey(workspaceId);
  return withDocLock(key, async () => {
    const doc = await readDoc(vfs, key);
    const edits = new Map<string, unknown | null>();
    const moved = doc.agents[fromId];
    if (moved !== undefined) {
      delete doc.agents[fromId];
      edits.set(fromId, null);
      if (toId) {
        doc.agents[toId] = moved;
        edits.set(toId, moved);
      }
    }
    for (const [id, raw] of Object.entries(doc.agents)) {
      const parsed = parseAgentDelegation(raw, id);
      if (!parsed.ok || !parsed.value.agents.includes(fromId)) continue;
      doc.agents[id] = {
        ...parsed.value,
        agents: toId
          ? [
              ...new Set(
                parsed.value.agents.map((member) =>
                  member === fromId ? toId : member,
                ),
              ),
            ]
          : parsed.value.agents.filter((member) => member !== fromId),
      };
      edits.set(id, doc.agents[id]);
    }
    await saveEditedDoc(vfs, key, doc, edits);
  });
}
