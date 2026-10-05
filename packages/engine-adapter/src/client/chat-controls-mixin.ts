import type { DismissInteractionOutcome } from "@houston/sdk";
import type {
  ConversationImportRequest,
  ConversationImportResult,
} from "@houston/wire-types";
import { DEFAULT_AGENT_PATH } from "../synthetic";
import { stopUnsentTurn, truncateConversationVm } from "../turn-stream";
import { setActivityStatus } from "./activity-status";
import { runtimeScope } from "./chat-scope";
import { importConversation, retryPendingImports } from "./conversation-import";
import type { BaseCtor } from "./mixin";

/**
 * The one-shot controls a user applies to an OPEN conversation: Stop, the Mode
 * pill, the stepper's X, the edit-and-resend rewind, and lines said elsewhere
 * written in as its history.
 *
 * Each is one `@houston/sdk` turn command and, where the user's own view must
 * move with it, the local fold that follows — the board card a dead turn left
 * stuck on "running", the feed tail a rewind drops. The request itself lives
 * once, in the SDK (`modules/turns/conversation-controls.ts`); what stays here
 * is only what web renders.
 */
export function ChatControlsMixin<TBase extends BaseCtor>(Base: TBase) {
  class ChatControls extends Base {
    async cancelSession(agentPath: string, sessionKey: string) {
      // Abort the agent's in-flight turn. The engine reports whether a turn was
      // ACTUALLY in flight. `false` means there was nothing to abort: the turn is
      // orphaned — its board card is stuck "running" because the turn died without
      // settling (an error that never reached a terminal frame, or an app restart
      // that dropped the in-memory turn). Stop is the user's escape hatch, so in
      // that case settle the card ourselves. A genuinely live turn (`true`) is
      // settled by its own `streamTurn` when the abort lands, so we leave its
      // status alone — writing it here too would race that terminal write.
      // A message still waiting to go out (held, or for room) stops locally
      // first; the engine is asked too, in case it took it meanwhile.
      const stoppedLocally = stopUnsentTurn(agentPath, sessionKey);
      const { cancelled } = await this.ctx.sdk.turns.cancel(
        sessionKey,
        runtimeScope(this.ctx, agentPath),
      );
      if (stoppedLocally) return { cancelled: true };
      if (cancelled !== true) {
        // Orphan rescue: a user Stop on a dead turn — never a pending interaction.
        await setActivityStatus(
          this.ctx,
          agentPath,
          sessionKey,
          "needs_you",
          null,
        );
      }
      return { cancelled: cancelled === true };
    }

    /**
     * Apply a Mode-pill switch to a conversation's EXECUTING turn (Claude
     * Code's shift+tab): the runtime mutates the running turn's live-mode ref
     * so its tools adopt the new mode at their next decision. `applied: false`
     * is benign — no turn was running, and the next send pins the mode itself.
     */
    setLiveTurnMode(
      agentPath: string,
      conversationId: string,
      mode: "execute" | "plan" | "auto",
    ): Promise<{ ok: boolean; applied: boolean }> {
      return this.ctx.sdk.turns.setMode(
        conversationId,
        runtimeScope(this.ctx, agentPath),
        mode,
      );
    }

    /**
     * The stepper X / abandon appends the durable stop marker on the runtime,
     * retiring the pending interaction. This matches a real Stop — the model
     * learns nothing from it. The SDK decides what a refusal means: a
     * `turn_running` outcome is the surface's cue to catch up, not an error.
     */
    dismissInteraction(
      agentPath: string,
      conversationId: string,
    ): Promise<DismissInteractionOutcome> {
      return this.ctx.sdk.turns.dismissInteraction(
        conversationId,
        runtimeScope(this.ctx, agentPath),
      );
    }

    /**
     * Edit-and-resend rewind (PRODUCT-1217): the runtime cuts the transcript
     * at the edited user turn (and resets the model's session so the next
     * turn replays the kept context), then the VM fold drops the same tail so
     * the feed rewinds immediately. The caller follows up with a normal send
     * carrying the edited text. Throws on 409 (a turn raced the edit) — the
     * caller surfaces it; nothing was cut.
     */
    async truncateConversation(
      agentPath: string,
      sessionKey: string,
      turnId: string,
    ): Promise<void> {
      const path = agentPath || DEFAULT_AGENT_PATH;
      await this.ctx.sdk.turns.truncate(
        sessionKey,
        runtimeScope(this.ctx, path),
        turnId,
      );
      truncateConversationVm(path, sessionKey, turnId);
    }

    /**
     * Write lines said elsewhere into a conversation as its real history (the
     * AI Manager's scripted onboarding), then re-seed that chat's VM so it
     * opens showing them. The SDK owes the import until it lands.
     */
    importConversationMessages(
      agentPath: string,
      conversationId: string,
      request: ConversationImportRequest,
    ): Promise<ConversationImportResult> {
      return importConversation(this.ctx, agentPath, conversationId, request);
    }

    /** Send every import still owed to the agent at `agentPath` again;
     *  resolves with what still fails. */
    retryPendingConversationImports(agentPath: string): Promise<unknown[]> {
      return retryPendingImports(this.ctx, agentPath);
    }
  }
  return ChatControls;
}
