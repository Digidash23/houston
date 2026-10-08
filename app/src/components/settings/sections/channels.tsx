import {
  type ChannelConnection,
  channelUnavailableReason,
  slackCompletionFailure,
} from "@houston/engine-adapter";
import { Button, ConfirmDialog, Skeleton } from "@houston-ai/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useChannelActions,
  useChannels,
} from "../../../hooks/queries/use-channels";
import { useSlackCompletion } from "../../../hooks/use-slack-completion";
import {
  type ChannelWatch,
  channelWatchActive,
  slackHandoff,
  startChannelWatch,
} from "../../../lib/channel-handoff";
import { slackCompletionResult } from "../../../lib/slack-completion";
import { useWorkspaceStore } from "../../../stores/workspaces";
import { channelProviderCards } from "./channel-provider-cards";
import { ChannelsSlackCard } from "./channels-slack-card";
import { ChannelsWhatsAppCard } from "./channels-whatsapp-card";

export function ChannelsSection() {
  const space = useWorkspaceStore((s) => s.current);
  return <ChannelsBody key={space?.id} spaceName={space?.name ?? ""} />;
}

function ChannelsBody({ spaceName }: { spaceName: string }) {
  const { t } = useTranslation("settings");
  const {
    connect,
    reopen,
    complete,
    link,
    linkWhatsApp,
    openWhatsApp,
    disconnect,
  } = useChannelActions();
  const [target, setTarget] = useState<ChannelConnection | null>(null);
  const [watch, setWatch] = useState<ChannelWatch | null>(null);
  const landed = useSlackCompletion(complete.mutate);
  const query = useChannels(watch);
  const unavailable = channelUnavailableReason(query.error);
  const connections = query.data?.connections ?? [];
  const busy =
    connect.isPending ||
    complete.isPending ||
    link.isPending ||
    linkWhatsApp.isPending ||
    openWhatsApp.isPending ||
    disconnect.isPending;
  const completionFailed = slackCompletionResult(
    landed,
    slackCompletionFailure(complete.error),
  );
  const slackUnavailable = [connect.error, complete.error, link.error].some(
    (error) => channelUnavailableReason(error) === "not-configured",
  );
  const whatsAppUnavailable =
    channelUnavailableReason(linkWhatsApp.error) === "not-configured";
  /** Every hand-off starts the watch: the connection arrives out of band. */
  const handOff = (start: () => void) => {
    setWatch(startChannelWatch(connections.length, Date.now()));
    start();
  };
  return (
    <section className="space-y-6">
      <header>
        <h2 className="mb-1 text-lg font-semibold text-ink">
          {t("channels.title")}
        </h2>
        <p className="text-sm text-ink-muted">{t("channels.intro")}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {t("channels.space", { name: spaceName })}
        </p>
      </header>
      {complete.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          {t("channels.slack.completing")}
        </p>
      ) : completionFailed ? (
        <p role="status" className="text-sm text-ink-muted">
          {t(
            completionFailed === "taken"
              ? "channels.slack.completeAlready"
              : "channels.slack.completeInvalid",
          )}
        </p>
      ) : null}
      {query.isPending ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : unavailable ? (
        <p className="text-sm text-ink-muted" role="status">
          {t("channels.unsupported")}
        </p>
      ) : query.data ? (
        channelProviderCards(query.data).map(
          ({ provider, connections: providerConnections }) => {
            return provider.id === "slack" ? (
              <ChannelsSlackCard
                key={provider.id}
                name={provider.name}
                connectable={provider.configured && !slackUnavailable}
                connections={providerConnections}
                busy={busy}
                connecting={connect.isPending}
                handoff={slackHandoff(connect.data, reopen.data)}
                link={link.data}
                onConnect={() =>
                  handOff(() => {
                    reopen.reset();
                    connect.mutate();
                  })
                }
                onOpen={(url) => reopen.mutate(url)}
                onLink={() => handOff(() => link.mutate())}
                onDisconnect={setTarget}
              />
            ) : (
              <ChannelsWhatsAppCard
                key={provider.id}
                name={provider.name}
                connectable={provider.configured && !whatsAppUnavailable}
                connections={providerConnections}
                busy={busy}
                waiting={channelWatchActive(
                  watch,
                  connections.length,
                  Date.now(),
                )}
                link={linkWhatsApp.data}
                onLink={() => handOff(() => linkWhatsApp.mutate())}
                onOpen={(url) => openWhatsApp.mutate(url)}
                onDisconnect={setTarget}
              />
            );
          },
        )
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={query.isFetching}
        onClick={() => {
          if (slackUnavailable || whatsAppUnavailable) {
            connect.reset();
            link.reset();
            linkWhatsApp.reset();
            disconnect.reset();
          }
          complete.reset();
          void query.refetch();
        }}
      >
        {t("channels.refresh")}
      </Button>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={t("channels.disconnectTitle", {
          provider:
            query.data?.providers.find((item) => item.id === target?.provider)
              ?.name ?? "",
        })}
        description={t("channels.disconnectDescription", {
          name: target?.accountLabel ?? "",
          provider:
            query.data?.providers.find((item) => item.id === target?.provider)
              ?.name ?? "",
        })}
        confirmLabel={t("channels.disconnect")}
        cancelLabel={t("channels.cancel")}
        variant="destructive"
        onConfirm={() => {
          if (target) disconnect.mutate(target.id);
        }}
      />
    </section>
  );
}
