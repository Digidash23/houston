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
 * then Download image and Copy image. Share on LinkedIn publishes the chart's
 * page when clicked and reads "Preparing your post..." meanwhile, then Open
 * LinkedIn, which posts the page's link, whose preview is the image; where
 * there is no page, one line under the buttons
 * says where the image went (on the clipboard, or saved), so the person knows
 * to paste it. The dialog stays open, so the line is still there when they
 * come back from LinkedIn.
 */
export function OrgChartShareDialog({
  share,
}: {
  share: ReturnType<typeof useOrgChartShare>;
}) {
  const { t } = useTranslation("teams");
  const ready = share.preview.status === "ready";
  const { line } = share;
  const preparing = share.linkedInStep === "preparing";

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
            label={t(LINKEDIN_LABEL[share.linkedInStep])}
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
          className={cn(
            "text-sm text-pretty text-ink",
            !line?.line && "sr-only",
          )}
        >
          {line?.line &&
            (line.line === "blocked"
              ? t("orgChart.share.linkedInBlocked")
              : t(`orgChart.share.${line.line}`))}
          {line?.blocked && line.url && (
            <>
              {" "}
              <a
                href={line.url}
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

const LINKEDIN_LABEL = {
  share: "orgChart.share.linkedIn",
  preparing: "orgChart.share.linkedInPreparing",
  open: "orgChart.share.linkedInReady",
} as const;

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
