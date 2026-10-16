import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@houston-ai/core";
import { Check, Copy, Download, Linkedin } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PRESS_CLASS, PRESS_STYLE } from "./org-chart-motion";
import { OrgChartSharePreview } from "./org-chart-share-preview";
import type { useOrgChartShare } from "./use-org-chart-share";

/**
 * Share the org chart: the image as it will be posted, Share on LinkedIn,
 * then Download image and Copy image. Share on LinkedIn reads "Preparing
 * your post..." while the chart's page goes up, then LinkedIn opens with a
 * post that links to it, whose preview is the image. When the image could
 * not go with the post, one line under the buttons says to download it and
 * add it; when the browser blocked LinkedIn, it links to it. The dialog
 * stays open, so the line is still there when they come back.
 */
export function OrgChartShareDialog({
  share,
}: {
  share: ReturnType<typeof useOrgChartShare>;
}) {
  const { t } = useTranslation("teams");
  const ready = share.preview.status === "ready";
  const { line, preparing } = share;
  const said = Boolean(line?.notAttached || line?.blocked);

  return (
    <Dialog open={share.open} onOpenChange={share.setOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("orgChart.share.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("orgChart.share.description")}
          </DialogDescription>
        </DialogHeader>
        <OrgChartSharePreview preview={share.preview} onRetry={share.retry} />
        <div className="flex flex-col gap-2">
          <ShareButton
            icon={
              preparing ? (
                <Spinner aria-hidden />
              ) : (
                <Linkedin className="size-4" />
              )
            }
            label={t(
              preparing
                ? "orgChart.share.linkedInPreparing"
                : "orgChart.share.linkedIn",
            )}
            disabled={preparing}
            className="h-10 w-full"
            onClick={share.linkedIn}
          />
          <div className="grid grid-cols-2 gap-2">
            <ShareButton
              variant="outline"
              disabled={!ready}
              icon={<Download className="size-4" />}
              label={t("orgChart.share.download")}
              className={share.canCopy ? undefined : "col-span-2"}
              onClick={share.download}
            />
            {share.canCopy && (
              <ShareButton
                variant="outline"
                disabled={!ready}
                icon={
                  share.copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )
                }
                label={t(
                  share.copied
                    ? "orgChart.share.copiedImage"
                    : "orgChart.share.copyImage",
                )}
                onClick={share.copyImage}
              />
            )}
          </div>
        </div>
        {/* Always mounted, so a screen reader announces the line when it
            arrives; only its words change. Empty, it is sr-only, which takes
            it out of the layout (and the dialog's gap) without hiding it. */}
        <p
          role="status"
          className={cn("text-sm text-pretty text-ink", !said && "sr-only")}
        >
          {line?.notAttached && t("orgChart.share.notAttached")}
          {line?.notAttached && line.blocked && " "}
          {line?.blocked && (
            <>
              {t("orgChart.share.linkedInBlocked")}{" "}
              <a
                href={line.blocked.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={share.followBlocked}
                className="font-medium text-link underline underline-offset-2"
              >
                {t("orgChart.share.openLinkedIn")}
              </a>
            </>
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** A pill that presses in. */
function ShareButton({
  icon,
  label,
  className,
  ...props
}: { icon: ReactNode; label: string } & ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn("rounded-full", PRESS_CLASS, className)}
      style={PRESS_STYLE}
      {...props}
    >
      {icon}
      {label}
    </Button>
  );
}
