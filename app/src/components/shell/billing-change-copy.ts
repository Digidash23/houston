import type { BillingChoice } from "@houston/engine-adapter";
import { type ChoiceNotice, orgSeatPrice } from "@houston/sdk";
import { useTranslation } from "react-i18next";
import { useOrgName } from "./free-org-picker-rows";

export type Shown = Exclude<ChoiceNotice, { kind: "hidden" }>;

/** The two sentences: the first in full ink, the rest softer. */
export function useNoticeText(notice: Shown, choice: BillingChoice) {
  const { t, i18n } = useTranslation("plan");
  const orgName = useOrgName();
  const nameOf = (slug: string | null) => {
    const org = choice.orgs.find((candidate) => candidate.slug === slug);
    return org ? orgName(org) : "";
  };
  const price = orgSeatPrice(i18n.language);
  switch (notice.kind) {
    case "picked": {
      const paid = notice.paidOrgSlug;
      const day = notice.day;
      const rest = paid
        ? t(
            notice.othersNeedPlan
              ? "choice.picked.paidOthers"
              : "choice.picked.paid",
            {
              name: nameOf(paid),
              day,
            },
          )
        : t("choice.picked.others", { day });
      return {
        lead: t("choice.picked.lead", { name: nameOf(notice.freeOrgSlug) }),
        rest,
      };
    }
    case "single_org":
      return {
        lead: t("choice.notice.lead", { date: notice.date }),
        rest: notice.payer
          ? t("choice.notice.singleOrgPayer", {
              name: nameOf(notice.orgSlug),
              price,
            })
          : t("choice.notice.singleOrg", {
              name: nameOf(notice.orgSlug),
              price,
            }),
      };
    case "member":
      return {
        lead: t("choice.notice.lead", { date: notice.date }),
        rest: t("choice.notice.restMember", { price }),
      };
    case "pick":
      return {
        lead: t("choice.notice.lead", { date: notice.date }),
        rest: t(
          notice.payer ? "choice.notice.restPayer" : "choice.notice.rest",
          {
            price,
          },
        ),
      };
  }
}
