import type { AIBoardProps } from "@houston-ai/board";
import { useCallback } from "react";
import {
  browserHandoffCard,
  withBrowserHandoffCards,
} from "../../lib/browser-handoff-feed";
import { BrowserHandoffCardHost } from "./browser-handoff-card-host";

type MapFeed = NonNullable<AIBoardProps["mapFeedItems"]>;
type RenderSystem = NonNullable<AIBoardProps["renderSystemMessage"]>;

/**
 * An agent chat drawing every browser hand-off as a card the person opens the
 * live browser from. Wraps the chat panel's own feed mapping and system rows,
 * which keep doing everything else (the onboarding cards' pattern).
 */
export function useBrowserHandoffCards({
  mapFeedItems,
  renderSystemMessage,
  agentPath,
  runningSessionKey,
}: {
  mapFeedItems: MapFeed;
  renderSystemMessage: RenderSystem;
  agentPath: string | undefined;
  /** The chat whose turn is running right now, if any: only its unanswered
   *  hand-off can still be waiting. */
  runningSessionKey: string | null;
}): { mapFeedItems: MapFeed; renderSystemMessage: RenderSystem } {
  const mapWithCards = useCallback<MapFeed>(
    (ctx) =>
      mapFeedItems({
        ...ctx,
        items: withBrowserHandoffCards(
          ctx.items,
          ctx.sessionKey === runningSessionKey,
          ctx.sessionKey,
        ),
      }),
    [mapFeedItems, runningSessionKey],
  );

  const renderWithCards = useCallback<RenderSystem>(
    (message) => {
      const card = message.hostCard
        ? browserHandoffCard(message.hostCard)
        : null;
      if (card && agentPath)
        return <BrowserHandoffCardHost agentPath={agentPath} card={card} />;
      return renderSystemMessage(message);
    },
    [renderSystemMessage, agentPath],
  );

  return { mapFeedItems: mapWithCards, renderSystemMessage: renderWithCards };
}
