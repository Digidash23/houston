import type { ServerResponse } from "node:http";
import { PROVIDER_ACCOUNT_BLOCKED_CODE } from "../credentials/account-blocked";
import { json } from "./http";

/**
 * The sandbox serve's answer when the provider blocks the ACCOUNT behind an
 * intact credential (GitHub Copilot with billing locked): the same typed 502
 * the gateway's credential serve answers, so the runtime reads one shape on
 * desktop, self-host and cloud. Not a 404: the runtime must not drop its
 * served copy, and nothing may read this as a sign-out. `Retry-After` paces
 * the serve sync the way the gateway's failed-refresh memo does.
 */
export function answerAccountBlocked(
  res: ServerResponse,
  detail: string,
): true {
  json(
    res,
    502,
    {
      error: "provider account blocked",
      code: PROVIDER_ACCOUNT_BLOCKED_CODE,
      detail,
    },
    { "retry-after": "60" },
  );
  return true;
}
