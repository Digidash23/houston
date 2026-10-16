import type { MessageApproval } from "@houston/protocol/approval";
import {
  type AttachmentSend,
  prepareAttachmentSend,
} from "./attachment-message";
import type { TurnMode } from "./turn-mode";

/** One interaction reply: the composed text and what rides with it. */
export interface InteractionReply {
  text: string;
  mode: TurnMode;
  approvals?: MessageApproval[];
  /** Files attached in the card, saved and named in the prompt exactly like
   *  a composer send, so they arrive WITH the answer. */
  files: readonly File[];
}

export interface InteractionReplySendOptions {
  providerOverride: string;
  modelOverride: string;
  effortOverride?: string;
  modeOverride: TurnMode;
  approvals?: MessageApproval[];
  queuedPreview?: AttachmentSend["queuedPreview"];
}

/** The I/O an interaction reply goes through, injected so the flow is
 *  testable without the engine. */
export interface InteractionReplyPorts {
  resolvePin: () => Promise<{
    provider: string;
    model: string;
    effort?: string;
  }>;
  save: (files: File[]) => Promise<string[]>;
  send: (prompt: string, opts: InteractionReplySendOptions) => Promise<unknown>;
  /** The reply was accepted. */
  onSent: (files: readonly File[]) => void;
  /** The pin, the upload or the send failed: nothing reached the agent. */
  onFailed: (err: unknown) => void;
  /** `onSent` itself threw. The send DID land, so this is never reported to
   *  the user as a failed message. */
  onSentThrew: (err: unknown) => void;
}

/**
 * Send an interaction reply. Resolves whether the reply was accepted and
 * never rejects: the card keeps its attached files on `false`, so a retry
 * still carries them.
 */
export async function sendInteractionReply(
  reply: InteractionReply,
  ports: InteractionReplyPorts,
): Promise<boolean> {
  try {
    const [pin, attached] = await Promise.all([
      ports.resolvePin(),
      reply.files.length > 0
        ? prepareAttachmentSend(reply.text, reply.files, ports.save)
        : null,
    ]);
    await ports.send(attached?.prompt ?? reply.text, {
      providerOverride: pin.provider,
      modelOverride: pin.model,
      effortOverride: pin.effort,
      modeOverride: reply.mode,
      ...(reply.approvals?.length ? { approvals: reply.approvals } : {}),
      ...(attached ? { queuedPreview: attached.queuedPreview } : {}),
    });
  } catch (err) {
    ports.onFailed(err);
    return false;
  }
  try {
    ports.onSent(reply.files);
  } catch (err) {
    ports.onSentThrew(err);
  }
  return true;
}
