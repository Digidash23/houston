import { PROVIDER_ACCOUNT_BLOCKED_CODE } from "./account-blocked";

/**
 * The gateway's typed `provider_account_blocked` 502 as the managed-pod store
 * sees it: the credential is intact but its provider blocks the account
 * (GitHub Copilot, billing locked). Not a dead credential and not a logout;
 * the sandbox serve relays the same typed answer to the runtime.
 */
export class RemoteCredentialBlockedError extends Error {
  constructor(
    readonly provider: string,
    readonly detail: string,
  ) {
    super(`credential gateway GET ${provider} reported a blocked account`);
    this.name = "RemoteCredentialBlockedError";
  }
}

/** The gateway's `detail` when a 502 body carries the account-blocked code. */
export function gatewayBlockedDetail(text: string): string | null {
  try {
    const body = JSON.parse(text) as { code?: unknown; detail?: unknown };
    if (body.code !== PROVIDER_ACCOUNT_BLOCKED_CODE) return null;
    return typeof body.detail === "string" ? body.detail : "";
  } catch {
    return null;
  }
}
