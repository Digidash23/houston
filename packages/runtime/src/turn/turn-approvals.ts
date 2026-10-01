import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  adoptApprovals,
  carryApprovals,
} from "@houston/host/src/assistant/approval-carry";
import { ApprovalStore } from "@houston/host/src/assistant/approvals";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { AdmittedMessages } from "./turn-admitted-messages";
import { mutateTurnDocument } from "./turn-doc-cas";
import type { TurnFilesystem } from "./turn-filesystem";

/**
 * Houston's approval records for ONE conversation, kept between single-use
 * sandboxes.
 *
 * A standing host keeps them in memory. A pool worker lives for one turn, and
 * a card is raised in one turn and answered by the message that starts the
 * next, so the records live beside the agent's runtime state, one file per
 * conversation, written with the same generation-guarded write every other
 * tool-time document uses. Only this harness writes the file: Houston's file
 * tools reach its memory document alone and it runs no code.
 *
 * Opening applies the arriving message's answers and grants (`receive`)
 * BEFORE the model can call anything, and writes the result, exactly where a
 * standing host's message route applies them. Every later change is written
 * by {@link TurnApprovals.save} while the turn's claim still holds.
 */
export interface TurnApprovals {
  readonly approvals: ApprovalStore;
  save(): Promise<void>;
}

export interface TurnApprovalsInput {
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  agentId: string;
  conversationId: string;
}

/**
 * Where one conversation's records live: in that conversation's own runtime
 * session directory, the only place a claimed turn may write besides its
 * transcript (cloud pod-store `claimIDFromKey`). Not a `.jsonl`, so neither
 * harness mistakes it for a session file.
 */
export function approvalsDocRel(
  filesystem: Pick<TurnFilesystem, "dataRel">,
  conversationId: string,
): string {
  return posix.join(
    filesystem.dataRel,
    "sessions",
    conversationId,
    "assistant-approvals.json",
  );
}

export async function openTurnApprovals(
  input: TurnApprovalsInput,
  receive: (approvals: ApprovalStore, admitted: AdmittedMessages) => void,
): Promise<TurnApprovals> {
  const relativePath = approvalsDocRel(input.filesystem, input.conversationId);
  const local = join(input.filesystem.storeRoot, ...relativePath.split("/"));
  const scope = {
    agentId: input.agentId,
    conversationId: input.conversationId,
  };
  const write = async (store: ApprovalStore, admitted: AdmittedMessages) => {
    await mkdir(dirname(local), { recursive: true });
    await writeFile(
      local,
      JSON.stringify({
        ...carryApprovals(store, input.agentId, input.conversationId),
        admitted,
      }),
    );
  };
  let approvals = new ApprovalStore();
  let admitted = new AdmittedMessages(null);
  await mutateTurnDocument({
    ...input,
    relativePath,
    // Rebuilt on every attempt: a generation conflict re-reads the file.
    apply: async () => {
      const carried = await readCarry(local);
      approvals = new ApprovalStore();
      adoptApprovals(approvals, carried, scope);
      admitted = new AdmittedMessages(
        typeof carried === "object" && carried !== null && "admitted" in carried
          ? carried.admitted
          : null,
      );
      receive(approvals, admitted);
      await write(approvals, admitted);
    },
  });
  // One save at a time: each reads, writes and uploads the same local file,
  // and an overlapping one could upload another's stale bytes.
  let saving: Promise<void> = Promise.resolve();
  const saveOnce = () =>
    mutateTurnDocument({
      ...input,
      relativePath,
      apply: () => write(approvals, admitted),
    });
  return {
    get approvals() {
      return approvals;
    },
    save: () => {
      const next = saving.then(saveOnce, saveOnce);
      saving = next.catch(() => undefined);
      return next;
    },
  };
}

/** The carried records, or nothing when the file is absent or unreadable. */
async function readCarry(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error(
      "[turn-approvals] the approval record file is unreadable; every card in it is asked again",
    );
    return null;
  }
}
