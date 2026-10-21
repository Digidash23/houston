import { useTranslation } from "react-i18next";
import { FallbackLink } from "./fallback-link";
import { PlanBriefingCta } from "./plan-briefing-cta";

export function PlanAnnouncementCta({
  label,
  pending,
  fallbackUrl,
  onClick,
}: {
  label: string;
  pending: boolean;
  fallbackUrl: string | null;
  onClick: () => void;
}) {
  const { t } = useTranslation("plan");
  return (
    <div className="flex flex-col gap-3">
      <PlanBriefingCta label={label} disabled={pending} onClick={onClick} />
      {fallbackUrl && (
        <FallbackLink
          className="self-center text-sm"
          href={fallbackUrl}
          command="plus_checkout_open"
        >
          {t("openCheckout")}
        </FallbackLink>
      )}
    </div>
  );
}
