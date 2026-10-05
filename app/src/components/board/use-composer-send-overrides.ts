import { useMemo } from "react";
import type { TurnMode } from "../../lib/turn-mode";
import type { SendOverrides } from "./board-source";
import { composerSendOverrides } from "./composer-send-overrides";

/** The slice of `useAgentChatPanel`'s result a composer send is pinned by. */
export interface ComposerPinSource {
  effectiveProvider: string;
  effectiveModel: string;
  effectiveEffort: string | undefined;
  turnMode: TurnMode;
}

/** {@link composerSendOverrides} for the pin the chat panel displays,
 *  memoized on its four values so the send queue's callbacks stay stable. */
export function useComposerSendOverrides(
  panel: ComposerPinSource,
): SendOverrides {
  const {
    effectiveProvider: provider,
    effectiveModel: model,
    effectiveEffort: effort,
    turnMode,
  } = panel;
  return useMemo(
    () => composerSendOverrides({ provider, model, effort }, turnMode),
    [provider, model, effort, turnMode],
  );
}
