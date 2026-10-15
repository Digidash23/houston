import type { ChannelConnection, WhatsAppLink } from "@houston/engine-adapter";
import { useTranslation } from "react-i18next";
import type { ChannelCardState } from "./channel-provider-cards";
import { ChannelProviderPanel } from "./channel-provider-panel";
import { WhatsAppLinkDetails } from "./channels-whatsapp-link";

/**
 * The WhatsApp card's connect flow: a connection code to send from the
 * person's own WhatsApp. "Waiting for your message" holds until that
 * connection lands or the code expires.
 */
export function ChannelsWhatsAppCard({
  name,
  state,
  busy,
  waiting,
  link,
  onLink,
  onDisconnect,
}: {
  name: string;
  state: ChannelCardState;
  busy: boolean;
  waiting: boolean;
  link: WhatsAppLink | undefined;
  onLink: () => void;
  onDisconnect: (connection: ChannelConnection) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <ChannelProviderPanel
      provider="whatsapp"
      name={name}
      state={state}
      busy={busy}
      actionLabel={link ? t("channels.newCode") : undefined}
      onConnect={onLink}
      onDisconnect={onDisconnect}
    >
      {link && (
        <WhatsAppLinkDetails link={link} busy={busy} waiting={waiting} />
      )}
    </ChannelProviderPanel>
  );
}
