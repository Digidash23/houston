import { STORE_ROOT_PACKAGE_EXCLUDES } from "@houston/runtime-client/object-sync";
import type { AgentOp } from "./op-grammar";

/** Reserved claim key for agent-level writes (gateway + pod-store agree). */
export const AGENT_OPS_CLAIM_ID = "agent-ops";

/**
 * The desktop→cloud migration import's claim: the agent-ops scope plus the
 * agent's runtime conversations and pi sessions, and transcript repair of
 * the agent's conversations (gateway + pod-store agree).
 */
export const AGENT_IMPORT_CLAIM_ID = "agent-import";

/** Route ops never see the AGENT's runtime tree (`workspaces/<ws>/<agent>/
 *  .houston/runtime/`) — exactly that depth, so a user project carrying its
 *  own `.houston/runtime` directory is listed like any other file. */
const ROUTE_OP_EXCLUDES = ["workspaces/*/*/.houston/runtime/"];
/** A settings op reads/writes the runtime dir's small files only: skip the
 *  bulk (history, user files); the small .houston docs keep the layout real.
 *  A model-picker click must not pay a big agent's hydrate, nor a store-root
 *  package store. A credential op needs nothing but the agent directory to
 *  exist. */
const SETTINGS_OP_EXCLUDES = [
  ...STORE_ROOT_PACKAGE_EXCLUDES,
  "workspaces/*/*/.houston/runtime/conversations/",
  "workspaces/*/*/.houston/runtime/sessions/",
  "workspaces/*/*/files/",
  "workspaces/*/*/uploads/",
];

/** A `POST migration/import` route op (parseOpRequest proved the rest
 *  decodes and is an op route). */
export function isMigrationImport(op: AgentOp): boolean {
  return (
    op.kind === "route" && decodeURIComponent(op.rest) === "migration/import"
  );
}

/** The conversation id an op claims (its store writes and docs carry it). */
export function opClaimId(op: AgentOp): string {
  if (op.kind === "conversation" || op.kind === "reconcile")
    return op.conversationId;
  return isMigrationImport(op) ? AGENT_IMPORT_CLAIM_ID : AGENT_OPS_CLAIM_ID;
}

/**
 * What an import lists of the agent's runtime tree: its conversations and
 * sessions, so skip-existing sees the chats a previous chunk (or the agent)
 * already holds; nothing else of the runtime tree.
 */
export function importListed(rel: string): boolean {
  const s = rel.split("/");
  const runtime =
    s[0] === "workspaces" && s[3] === ".houston" && s[4] === "runtime";
  if (!runtime || s.length < 6) return true;
  return (s[5] === "conversations" || s[5] === "sessions") && s.length > 6;
}

/**
 * How an op's tree is listed. Agent-level routes (files, docs, skills) and
 * conversation ops run over a LAZY tree: the store's listing, objects
 * downloaded on first read — a Files listing or a one-file read costs one
 * round-trip, not the agent's size, and a rename fetches its one
 * conversation. The runtime tree is never listed for routes, except the
 * transcripts a migration import must see. A settings op needs the runtime
 * dir minus the bulk. A credential op touches no file at all (the gateway's
 * store is the only write); it still hydrates the layout so the
 * agent-exists check holds.
 */
export function opTreeOptions(op: AgentOp): {
  excludes?: string[];
  lazy?: boolean;
  admit?: (rel: string) => boolean;
} {
  if (isMigrationImport(op)) return { lazy: true, admit: importListed };
  switch (op.kind) {
    case "custom-oauth":
    case "first-day":
    case "route":
      return { excludes: ROUTE_OP_EXCLUDES, lazy: true };
    case "conversation":
    case "reconcile":
      return { lazy: true };
    case "settings":
    case "credential":
      return { excludes: SETTINGS_OP_EXCLUDES };
    default:
      return {};
  }
}
