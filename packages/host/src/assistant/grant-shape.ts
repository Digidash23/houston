import { AGENT_COLOR_IDS } from "@houston/domain/agent-color-ids";
import type { GrantableOperation } from "@houston/protocol";

const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function grantCovers(
  operation: string,
  params: Record<string, unknown>,
): operation is GrantableOperation {
  if (operation !== "createAgent") return false;
  if (!hasOnly(params, ["name", "color", "seed"])) return false;
  if (typeof params.name !== "string") return false;
  if (
    params.color !== undefined &&
    !AGENT_COLOR_IDS.some((color) => color === params.color)
  )
    return false;
  if (params.seed === undefined) return true;
  return (
    record(params.seed) &&
    hasOnly(params.seed, ["claudeMd"]) &&
    typeof params.seed.claudeMd === "string"
  );
}
