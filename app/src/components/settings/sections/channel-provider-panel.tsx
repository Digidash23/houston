import type {
  ChannelConnection,
  ChannelProviderId,
} from "@houston/engine-adapter";
import { Button } from "@houston-ai/core";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionStatusBadge } from "../../integrations/connection-status-badge";
import { SettingsCard } from "../settings-row";
import { ChannelAccountList } from "./channel-account-list";
import type { ChannelCardState } from "./channel-provider-cards";
import { CHANNEL_PROVIDER_DISPLAY } from "./channel-provider-display";

/**
 * One messaging provider's card: its mark, whether it is connected, the
 * accounts it holds, and the way to connect one more. `children` is the
 * provider's own connect flow (Slack's hand-off, WhatsApp's code), shown only
 * while the provider can connect.
 */
export function ChannelProviderPanel({
  provider,
  name,
  state,
  busy,
  actionLabel,
  onConnect,
  onDisconnect,
  children,
}: {
  provider: ChannelProviderId;
  name: string;
  state: ChannelCardState;
  busy: boolean;
  /** Replaces the connect and add labels while the provider's flow is mid-way. */
  actionLabel?: string;
  onConnect: () => void;
  onDisconnect: (connection: ChannelConnection) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation("settings");
  const display = CHANNEL_PROVIDER_DISPLAY[provider];
  const headingId = useId();
  const [initialIds] = useState(
    () =>
      new Set(state.kind === "empty" ? [] : state.connections.map((c) => c.id)),
  );
  return (
    <SettingsCard>
      <section aria-labelledby={headingId} className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <img
            src={display.logo}
            alt=""
            className="size-10 shrink-0 rounded-lg object-contain"
          />
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-sm font-medium text-ink">
              {name}
            </h3>
            {state.kind === "connected" && (
              <ConnectionStatusBadge status="active" />
            )}
            <p className="text-sm text-ink-muted">{t(display.description)}</p>
          </div>
        </div>
        {state.kind !== "empty" && state.connections.length > 0 && (
          <ChannelAccountList
            title={t(display.accountsTitle)}
            connections={state.connections}
            initialIds={initialIds}
            busy={busy}
            addLabel={
              state.kind === "connected"
                ? (actionLabel ?? t(display.addAnother))
                : undefined
            }
            onAdd={onConnect}
            onDisconnect={onDisconnect}
          />
        )}
        {state.kind === "empty" && (
          <Button disabled={busy} onClick={onConnect}>
            <Plus className="size-4" />
            {actionLabel ?? t(display.connect)}
          </Button>
        )}
        {state.kind === "unavailable" ? (
          <p role="status" className="text-sm text-ink-muted">
            {t(display.notConfigured)}
          </p>
        ) : (
          children
        )}
      </section>
    </SettingsCard>
  );
}
