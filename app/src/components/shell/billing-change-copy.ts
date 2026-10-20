import type { BillingChoice } from "@houston/engine-adapter";
import { type AnnouncedChoice, orgSeatPrice } from "@houston/sdk";
import { useTranslation } from "react-i18next";
import { useOrgName } from "./free-org-picker-rows";

/** The pricing-change modal's one paragraph, for the notice it announces. */
export function useNoticeBody(
  notice: AnnouncedChoice,
  choice: BillingChoice,
): string {
  const { t, i18n } = useTranslation("plan");
  const orgName = useOrgName();
  const price = orgSeatPrice(i18n.language);
  const date = notice.date;
  switch (notice.kind) {
    case "pick":
      return t(
        notice.payer ? "choice.notice.pickPayer" : "choice.notice.pick",
        {
          date,
          price,
        },
      );
    case "single_org": {
      const org = choice.orgs.find((one) => one.slug === notice.orgSlug);
      const name = org ? orgName(org) : "";
      return notice.payer
        ? t("choice.notice.singleOrgPayer", { date, name })
        : t("choice.notice.singleOrg", { date, name, price });
    }
    case "member":
      return t("choice.notice.member", { date });
  }
}
