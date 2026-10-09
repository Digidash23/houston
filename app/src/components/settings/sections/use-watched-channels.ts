import {
  CHANNEL_PROVIDER_IDS,
  type ChannelProviderId,
} from "@houston/engine-adapter";
import {
  type ChannelWatch,
  channelWatchLanded,
  startChannelWatch,
} from "@houston/sdk/channels/watch";
import { useEffect, useState } from "react";
import { useChannels } from "../../../hooks/queries/use-channels";

type Watches = Partial<Record<ChannelProviderId, ChannelWatch>>;

/**
 * The channels list, polled while the Channels section has a hand-off
 * outstanding (one watch per provider, `@houston/sdk/channels/watch`). When a
 * provider's connection lands, its watch ends and `onLanded` clears whatever
 * that hand-off left on screen (a spent code, a "finish in Slack" line).
 */
export function useWatchedChannels(
  onLanded: (provider: ChannelProviderId) => void,
) {
  const [watches, setWatches] = useState<Watches>({});
  const query = useChannels(Object.values(watches));
  const connections = query.data?.connections ?? [];
  // The providers whose connection has landed, as one string so the effect
  // fires on the landing edge rather than on every render.
  const landed = CHANNEL_PROVIDER_IDS.filter((id) =>
    channelWatchLanded(watches[id], connections),
  ).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the landing edge only; `onLanded` is a fresh closure each render.
  useEffect(() => {
    if (!landed) return;
    const providers = CHANNEL_PROVIDER_IDS.filter((id) =>
      landed.split(" ").includes(id),
    );
    for (const provider of providers) onLanded(provider);
    setWatches((current) => {
      const next = { ...current };
      for (const provider of providers) delete next[provider];
      return next;
    });
  }, [landed]);
  /** Watch `provider` from now; `expiresAt` is the code it minted, if any. */
  const watch = (provider: ChannelProviderId, expiresAt?: string) =>
    setWatches((current) => ({
      ...current,
      [provider]: startChannelWatch(
        provider,
        connections,
        Date.now(),
        expiresAt,
      ),
    }));
  return { query, connections, watches, watch };
}
