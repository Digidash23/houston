import { cn } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import type { ShareLine } from "./org-chart-share-run";

/**
 * The one line under the share dialog's buttons (`ShareLine`). Always
 * mounted, so a screen reader announces it when it arrives; only its words
 * change. Empty, it is sr-only, which takes it out of the layout without
 * hiding it.
 */
export function ShareStatusLine({
  line,
  onFollowBlocked,
}: {
  line: ShareLine | null;
  onFollowBlocked: () => void;
}) {
  const { t } = useTranslation("teams");
  return (
    <p
      role="status"
      className={cn("text-sm text-pretty text-ink", !line && "sr-only")}
    >
      {line && line.kind !== "blocked" && t(LINE_KEY[line.kind])}
      {line?.kind === "blocked" && (
        <>
          {line.image && `${t(LINE_KEY[line.image])} `}
          {t("orgChart.share.linkedInBlocked")}{" "}
          <a
            href={line.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onFollowBlocked}
            className="font-medium text-link underline underline-offset-2"
          >
            {t("orgChart.share.openLinkedIn")}
          </a>
        </>
      )}
    </p>
  );
}

const LINE_KEY = {
  copied: "orgChart.share.copied",
  saved: "orgChart.share.saved",
  reconnect: "orgChart.share.reconnect",
  wait: "orgChart.share.rateLimited",
  retry: "orgChart.share.postFailed",
  posted: "orgChart.share.posted",
} as const satisfies Record<Exclude<ShareLine["kind"], "blocked">, string>;
