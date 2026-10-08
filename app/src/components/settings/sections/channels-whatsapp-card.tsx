import type { ChannelConnection, WhatsAppLink } from "@houston/engine-adapter";
import { Button } from "@houston-ai/core";
import { MessageCircle, Plus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { SettingsCard } from "../settings-row";
import { ChannelConnectionRow } from "./channel-connection-row";
import { ChannelLinkCommand } from "./channel-link-command";
import { useChannelLinkExpired } from "./use-channel-link-expired";

function WhatsAppLinkDetails({
  link,
  busy,
  waiting,
  onOpen,
}: {
  link: WhatsAppLink;
  busy: boolean;
  waiting: boolean;
  onOpen: (url: string) => void;
}) {
  const { t } = useTranslation("settings");
  const expired = useChannelLinkExpired(link.expiresAt);
  const command = (
    <ChannelLinkCommand
      key={link.code}
      link={link}
      instruction={t("channels.whatsapp.sendTo", { phone: link.phoneNumber })}
      label={t("channels.whatsapp.commandLabel")}
    />
  );
  return (
    <div className="space-y-3">
      {expired ? (
        command
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => onOpen(link.url)}
            >
              {t("channels.whatsapp.open")}
            </Button>
            <p className="text-sm text-ink-muted">
              {t("channels.whatsapp.ready")}
            </p>
            <details className="text-sm text-ink">
              <summary className="cursor-pointer">
                {t("channels.whatsapp.typeInstead")}
              </summary>
              <div className="mt-3">{command}</div>
            </details>
          </div>
          <div className="hidden space-y-3 md:block">
            <div className="inline-block rounded-xl bg-background p-3">
              <QRCodeSVG
                value={link.url}
                className="size-40"
                fgColor="var(--ht-ink)"
                bgColor="transparent"
                role="img"
                aria-label={t("channels.whatsapp.qrLabel")}
              />
            </div>
            <p className="text-sm text-ink-muted">
              {t("channels.whatsapp.scan")}
            </p>
            {command}
            <Button variant="link" onClick={() => onOpen(link.url)}>
              {t("channels.whatsapp.open")}
            </Button>
          </div>
        </>
      )}
      {waiting && (
        <p role="status" className="text-sm text-ink-muted">
          {t("channels.whatsapp.waiting")}
        </p>
      )}
    </div>
  );
}

export function ChannelsWhatsAppCard({
  name,
  connectable,
  connections,
  busy,
  waiting,
  link,
  onLink,
  onOpen,
  onDisconnect,
}: {
  name: string;
  connectable: boolean;
  connections: ChannelConnection[];
  busy: boolean;
  waiting: boolean;
  link: WhatsAppLink | undefined;
  onLink: () => void;
  onOpen: (url: string) => void;
  onDisconnect: (connection: ChannelConnection) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsCard>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <MessageCircle className="size-5 text-ink-muted" />
          <div>
            <h3 className="text-sm font-medium text-ink">{name}</h3>
            <p className="text-sm text-ink-muted">
              {t("channels.whatsapp.description")}
            </p>
          </div>
        </div>
        {!connections.length && (
          <p className="text-sm text-ink-muted">{t("channels.empty")}</p>
        )}
        {connections.map((connection) => (
          <ChannelConnectionRow
            key={connection.id}
            connection={connection}
            busy={busy}
            onDisconnect={onDisconnect}
          />
        ))}
        {connectable ? (
          <div className="space-y-3">
            <Button disabled={busy} onClick={onLink}>
              <Plus className="size-4" />
              {t(link ? "channels.newCode" : "channels.whatsapp.connect")}
            </Button>
            {link && (
              <WhatsAppLinkDetails
                link={link}
                busy={busy}
                waiting={waiting}
                onOpen={onOpen}
              />
            )}
          </div>
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            {t("channels.whatsapp.notConfigured")}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
