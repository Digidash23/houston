import type {
  BrowserLiveConnection,
  BrowserLiveConnectOptions,
  BrowserLiveHandlers,
} from "@houston/sdk";
import { runtimeScope } from "./chat-scope";
import type { BaseCtor } from "./mixin";

/**
 * The live view of a browser hand-off: the person drives the page the agent's
 * `browser` tool handed over. Reconnection, input batching, acks and every
 * refusal live in the SDK (`modules/browser`); this binds it to the agent's
 * runtime scope. Failures arrive through `handlers`, never as a rejection.
 */
export function BrowserLiveMixin<TBase extends BaseCtor>(Base: TBase) {
  class BrowserLive extends Base {
    openBrowserLive(
      agentPath: string,
      conversationId: string,
      handlers: BrowserLiveHandlers,
      options?: BrowserLiveConnectOptions,
    ): BrowserLiveConnection {
      return this.ctx.sdk.browser.connect(
        conversationId,
        runtimeScope(this.ctx, agentPath),
        handlers,
        options,
      );
    }
  }
  return BrowserLive;
}
