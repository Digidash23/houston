import type { PlanSummary } from "@houston/wire-types";
import { planComposerMode, usagePercent } from "./model";

export type PlanUpgradeView =
  | { status: "free"; percent: null }
  | { status: "nearLimit" | "limit" | "preview"; percent: number };

/** A persistent Free upgrade entry; launch previews never claim a live limit. */
export function planUpgradeView(
  plan: PlanSummary | undefined,
  now = Date.now(),
): PlanUpgradeView | null {
  if (plan?.plan !== "free") return null;
  const mode = planComposerMode(plan, now);
  const percent = usagePercent(plan);
  if (mode === "none" || percent === null)
    return { status: "free", percent: null };
  return {
    status:
      mode === "limit"
        ? "limit"
        : mode === "previewHint"
          ? "preview"
          : "nearLimit",
    percent,
  };
}
