import { BrowserToolError } from "../errors";
import { type HandoffInit, HandoffSession } from "./session";

/** How long an ended hand-off still answers, so a late viewer sees how it ended. */
export const ENDED_RETAIN_MS = 60_000;

/**
 * The live hand-offs of this runtime process: each chat's latest, and every
 * ended one for {@link ENDED_RETAIN_MS} by its id. The HTTP routes find the
 * session the `browser` tool is waiting on here.
 */
export class HandoffRegistry {
  private readonly latest = new Map<string, HandoffSession>();
  /** Ended hand-offs by `handoffId`, so a view of one learns how it ended. */
  private readonly ended = new Map<string, HandoffSession>();

  constructor(private readonly retainMs = ENDED_RETAIN_MS) {}

  /** Start a hand-off; refused while one is still waiting in that chat. */
  open(init: HandoffInit): HandoffSession {
    if (this.latest.get(init.conversationId)?.state === "waiting")
      throw new BrowserToolError(
        "handoff_unavailable",
        "The browser is already waiting for the person in this chat.",
      );
    const { conversationId } = init;
    const session = new HandoffSession(init);
    this.latest.set(conversationId, session);
    session.ended.then(() => {
      this.ended.set(session.handoffId, session);
      const forget = setTimeout(() => {
        this.ended.delete(session.handoffId);
        if (this.latest.get(conversationId) === session)
          this.latest.delete(conversationId);
      }, this.retainMs);
      forget.unref();
    });
    return session;
  }

  /** The chat's latest hand-off: waiting, or ended within the retain window. */
  get(conversationId: string): HandoffSession | undefined {
    return this.latest.get(conversationId);
  }

  /**
   * The chat's hand-off `handoffId` names: its latest, or an earlier one that
   * ended within the retain window. Undefined once it is forgotten.
   */
  find(conversationId: string, handoffId: string): HandoffSession | undefined {
    const latest = this.latest.get(conversationId);
    if (latest?.handoffId === handoffId) return latest;
    const ended = this.ended.get(handoffId);
    return ended?.conversationId === conversationId ? ended : undefined;
  }

  /** End a conversation's waiting hand-off, if any. */
  end(conversationId: string, end: "done" | "cancelled" | "expired"): void {
    this.latest.get(conversationId)?.finish(end);
  }
}

/** The process-wide registry the tool and the runtime's HTTP routes share. */
export const sharedHandoffs = new HandoffRegistry();
