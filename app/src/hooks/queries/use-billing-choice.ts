import type {
  BillingChoice,
  BillingChoicePick,
  BillingChoiceSave,
} from "@houston/engine-adapter";
import { nextChoiceDeadline } from "@houston/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { showExpectedStateToast } from "../../lib/error-toast";
import { hasSpaces } from "../../lib/org-roles";
import { queryKeys } from "../../lib/query-keys";
import { tauriOrg } from "../../lib/tauri";
import { useCapabilities } from "../use-capabilities";

/**
 * True once the browser is idle after mount, so the announcement's one read
 * never competes with the board's first paint.
 */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => setReady(true), { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => setReady(true), 500);
    return () => clearTimeout(id);
  }, []);
  return ready;
}

/** The account-wide free-org pick. Cloud only (`caps.spaces`). */
export function useBillingChoice() {
  const { capabilities } = useCapabilities();
  const idle = useAfterFirstPaint();
  return useQuery({
    queryKey: queryKeys.billingChoice(),
    queryFn: tauriOrg.getBillingChoice,
    enabled: idle && hasSpaces(capabilities),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

type Cached = BillingChoice | null | undefined;

/**
 * Save the pick. A refusal the person can act on shows its own copy and
 * resolves with the outcome; anything else is reported by the engine call.
 */
export function useSetBillingChoice() {
  const client = useQueryClient();
  const { t } = useTranslation("plan");
  return useMutation({
    mutationFn: (pick: BillingChoicePick) => tauriOrg.setBillingChoice(pick),
    onSuccess: async (outcome: BillingChoiceSave) => {
      if (outcome.kind === "saved") {
        client.setQueryData(queryKeys.billingChoice(), outcome.choice);
        return;
      }
      showExpectedStateToast(
        t(`choice.refused.${outcome.kind}.title`),
        t(`choice.refused.${outcome.kind}.body`),
      );
      await client.invalidateQueries({ queryKey: queryKeys.billingChoice() });
    },
  });
}

/**
 * Hide the announcement now; the gateway keeps it hidden on every device. A
 * failed dismissal (reported by the engine call) brings the bar back so the
 * person can try again.
 */
export function useDismissBillingChoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: tauriOrg.dismissBillingChoiceNotice,
    onMutate: () => {
      const before = client.getQueryData<Cached>(queryKeys.billingChoice());
      client.setQueryData(queryKeys.billingChoice(), (choice: Cached) =>
        choice ? { ...choice, noticeDismissed: true } : choice,
      );
      return { before };
    },
    onError: (_error, _vars, context) =>
      client.setQueryData(queryKeys.billingChoice(), context?.before),
  });
}

/**
 * The time a choice surface renders against, re-read when the change window
 * or the cutover passes so an open session never outlives either.
 */
export function useChoiceNow(choice: Cached): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const wait = nextChoiceDeadline(choice, now);
    if (wait === null) return;
    // setTimeout caps at 2^31-1 ms; a later deadline re-arms on wake.
    const id = setTimeout(
      () => setNow(Date.now()),
      Math.min(wait, 2 ** 31 - 1),
    );
    return () => clearTimeout(id);
  }, [choice, now]);
  return now;
}
