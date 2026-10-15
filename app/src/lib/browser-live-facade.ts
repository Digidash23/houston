/**
 * The browser hand-off live view as the app reaches it: the SDK's connection
 * bound to the live engine.
 *
 * Part of `./tauri` rather than a layer of its own, in its own file for the
 * reason `./delegation-facade` is (`scripts/check-boundaries.mjs` rule D names
 * this file). It takes no `engineCall` wrapper because opening returns a
 * long-lived connection, not a promise: every failure after that arrives
 * through the handlers, where the connection has already sorted connectivity
 * from refusals, and `onUnexpected` is the one the surface reports.
 */

import type {
  BrowserLiveConnection,
  BrowserLiveConnectOptions,
  BrowserLiveHandlers,
} from "@houston/engine-adapter";
import { getEngine } from "./engine";

export const browserLive = {
  open(
    agentPath: string,
    conversationId: string,
    handlers: BrowserLiveHandlers,
    options?: BrowserLiveConnectOptions,
  ): BrowserLiveConnection {
    return getEngine().openBrowserLive(
      agentPath,
      conversationId,
      handlers,
      options,
    );
  },
};
