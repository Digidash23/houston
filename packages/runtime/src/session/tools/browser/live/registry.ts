import { BrowserToolError } from "../errors";
import { type HandoffInit, HandoffSession } from "./session";

/** How long an ended hand-off still answers, so a late viewer sees how it ended. */
export const ENDED_RETAIN_MS = 60_000;

/**
 * The live hand-offs of this runtime process, one per conversation. The HTTP
 * routes find the session the `browser` tool is waiting on here.
 */
export class HandoffRegistry {
  private readonly sessions = new Map<string, HandoffSession>();

  constructor(private readonly retainMs = ENDED_RETAIN_MS) {}

  /** Start a hand-off; refused while one is still waiting in that chat. */
  open(init: HandoffInit): HandoffSession {
    if (this.sessions.get(init.conversationId)?.state === "waiting")
      throw new BrowserToolError(
        "handoff_unavailable",
        "The browser is already waiting for the person in this chat.",
      );
    const session = new HandoffSession(init);
    this.sessions.set(init.conversationId, session);
    session.ended.then(() => {
      const forget = setTimeout(() => {
        if (this.sessions.get(init.conversationId) === session)
          this.sessions.delete(init.conversationId);
      }, this.retainMs);
      forget.unref();
    });
    return session;
  }

  get(conversationId: string): HandoffSession | undefined {
    return this.sessions.get(conversationId);
  }

  /** End a conversation's waiting hand-off, if any. */
  end(conversationId: string, end: "done" | "cancelled" | "expired"): void {
    this.sessions.get(conversationId)?.finish(end);
  }
}

/** The process-wide registry the tool and the runtime's HTTP routes share. */
export const sharedHandoffs = new HandoffRegistry();
