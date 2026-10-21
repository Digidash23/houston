import type { BillingChoice } from "@houston/engine-adapter";
import type { AnnouncedChoice } from "@houston/sdk";
import { useTranslation } from "react-i18next";
import { useOrgName } from "./free-org-picker-rows";

/**
 * The pricing-change modal's one paragraph, for the notice it announces. It
 * names no price: the payer step of the picker carries it.
 */
export function useNoticeBody(
  notice: AnnouncedChoice,
  choice: BillingChoice,
): string {
  const { t } = useTranslation("plan");
  const orgName = useOrgName();
  const date = notice.date;
  switch (notice.kind) {
    case "pick":
      return t(
        notice.payer ? "choice.notice.pickPayer" : "choice.notice.pick",
        { date },
      );
    case "single_org": {
      const org = choice.orgs.find((one) => one.slug === notice.orgSlug);
      const name = org ? orgName(org) : "";
      return t(
        notice.payer
          ? "choice.notice.singleOrgPayer"
          : "choice.notice.singleOrg",
        { date, name },
      );
    }
    case "member":
      return t("choice.notice.member", { date });
  }
}
