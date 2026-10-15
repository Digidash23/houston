import type { ChannelConnection } from "@houston/engine-adapter";
import { cn } from "@houston-ai/core";
import { Plus, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The accounts one provider holds, in the integrations accounts-list frame:
 * each row names its account and carries its own disconnect, and the foot row
 * connects another. A row whose id the card did not hold when it mounted
 * fades in, so a connection finished in Slack or on a phone is noticed.
 */
export function ChannelAccountList({
  title,
  connections,
  initialIds,
  busy,
  addLabel,
  onAdd,
  onDisconnect,
}: {
  title: string;
  connections: ChannelConnection[];
  initialIds: ReadonlySet<string>;
  busy: boolean;
  /** Absent: the provider cannot connect more, so the list has no foot row. */
  addLabel?: string;
  onAdd: () => void;
  onDisconnect: (connection: ChannelConnection) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <div>
      <h4 className="mb-1.5 text-sm font-medium text-ink">{title}</h4>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-input">
        {connections.map((connection) => (
          <li
            key={connection.id}
            className={cn(
              "flex min-h-11 items-center gap-2 py-1 pr-1 pl-3 md:min-h-10",
              !initialIds.has(connection.id) && "row-land-in",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {connection.accountLabel}
            </span>
            <button
              type="button"
              aria-label={t("channels.disconnectAccount", {
                name: connection.accountLabel,
              })}
              disabled={busy}
              onClick={() => onDisconnect(connection)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-danger-ink outline-none transition-[background-color,scale] hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 md:size-8"
            >
              <Unplug className="size-4" />
            </button>
          </li>
        ))}
        {addLabel && (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={onAdd}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset active:bg-hover disabled:pointer-events-none disabled:opacity-50 md:min-h-10"
            >
              <Plus className="size-4 shrink-0" />
              {addLabel}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
