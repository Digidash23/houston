import { Clock, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderStatuses } from "../../hooks/use-provider-statuses";
import { providerReconnectNoticeFor } from "../../lib/provider-reconnect-notice";
import { providerName } from "../../lib/providers";
import { tauriProvider } from "../../lib/tauri";

type LaunchState = "idle" | "waiting" | "failed";

/**
 * A quiet pill at the top of the workspace, shown a few days before a hosted
 * Claude subscription login ends (the provider ends it about 28 days after the
 * sign-in). Pressing it runs the same sign-in every reconnect surface runs
 * (`tauriProvider.launchLogin`); the finished login refreshes the provider
 * statuses, which move the deadline out and clear the pill. When to show it is
 * the SDK's rule (`providerReconnectNotices`).
 */
export function ProviderReconnectNotice() {
  const { t } = useTranslation("shell");
  const { statuses } = useProviderStatuses();
  const [launch, setLaunch] = useState<LaunchState>("idle");
  const notice = providerReconnectNoticeFor(statuses, Date.now());
  if (!notice) return null;

  const provider = providerName(notice.provider);
  const signIn = async () => {
    setLaunch("waiting");
    try {
      await tauriProvider.launchLogin(notice.provider);
    } catch {
      // `launchLogin` already reported the failure; the pill only offers
      // the retry.
      setLaunch("failed");
    }
  };
  const label =
    notice.daysLeft === 0
      ? t("providerReconnectNotice.dueToday", { provider })
      : t("providerReconnectNotice.dueIn", {
          provider,
          count: notice.daysLeft,
        });
  const action =
    launch === "waiting"
      ? t("providerReconnect.waiting")
      : launch === "failed"
        ? t("providerReconnect.launchError")
        : t("providerReconnect.signInAgain");

  return (
    <div role="status" className="shrink-0 px-4 pt-3">
      <button
        type="button"
        onClick={signIn}
        disabled={launch === "waiting"}
        data-testid="provider-reconnect-notice"
        className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-line bg-chip-subtle/50 px-3 py-1 text-left text-xs font-medium text-ink transition-colors hover:bg-chip-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-80"
      >
        {launch === "waiting" ? (
          <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <Clock aria-hidden className="size-3.5 shrink-0" />
        )}
        <span>{label}</span>
        <span className="font-semibold underline underline-offset-2">
          {action}
        </span>
      </button>
    </div>
  );
}
