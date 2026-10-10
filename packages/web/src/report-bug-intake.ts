import { gatewayAuthFetch } from "@houston/engine-adapter/cp/fetch";

/**
 * The web build's `report_bug`: the gateway's `POST /feedback` fronts the same
 * Linear intake the desktop reaches through Tauri, so the browser never holds
 * the Linear key.
 *
 * Same transport as every other control-plane call: the bearer is read LIVE
 * per attempt and a 401 triggers one single-flight session refresh plus a
 * replay, so a report filed after the tab idled past token expiry still lands
 * (HOU-818). A blank or absent token is the empty-bearer case that refresh
 * path handles.
 *
 * NO org getter, so no `x-houston-org`: the gateway's ResolveOrg 403s
 * `not_member` on a stale selector, and `/feedback` never reads the org.
 * Pinning the active space would mean a person removed from their team could
 * no longer tell us anything, the exact moment they most need to.
 * `X-Houston-App-Version` still rides along (build identity).
 */
export async function reportBugViaGateway(
  cp: { baseUrl: string; token: string },
  payload: unknown,
): Promise<string | null> {
  const gatewayFetch = gatewayAuthFetch(cp.token);
  const res = await gatewayFetch(`${cp.baseUrl.replace(/\/+$/, "")}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) {
    const body = await readRefusal(res);
    const message =
      body.error ||
      `feedback failed (${res.status})${body.unreadable ? `: ${body.unreadable}` : ""}`;
    // The same typed rejection the desktop shell's `report_bug` answers
    // (H-009): Linear refusing every report on our side, its plan's issue cap
    // above all. The app delivers the report through its fallback instead.
    const kind =
      body.code === "intake_unavailable" ? "intake_unavailable" : "other";
    throw new FeedbackIntakeError(message, kind, res.status);
  }
  const out = (await res.json()) as { id: string | null };
  return out.id;
}

/** Carries `kind` the way the shell's `{kind, message}` rejection does, so
 *  the app's `toBugReportFailure` reads both surfaces the same, and the HTTP
 *  `status`, which the report layer's status-based classification reads. */
export class FeedbackIntakeError extends Error {
  constructor(
    message: string,
    readonly kind: "intake_unavailable" | "other",
    readonly status: number,
  ) {
    super(message);
    this.name = "FeedbackIntakeError";
  }
}

/** The refusal's JSON body. A non-JSON body (a proxy's HTML page) answers
 *  `unreadable` instead, which rides the thrown error's message: that error
 *  is reported by `submitBugReport`, so the parse failure reaches us there.
 *  Not reported from here: the report layer reaches this shim through
 *  os-bridge, so importing it would close a module cycle. */
async function readRefusal(
  res: Response,
): Promise<{ error?: string; code?: string; unreadable?: string }> {
  try {
    return (await res.json()) as { error?: string; code?: string };
  } catch (err) {
    return {
      unreadable: `unreadable refusal body: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
