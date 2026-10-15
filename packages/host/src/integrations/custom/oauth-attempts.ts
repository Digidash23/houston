import type { CustomOAuthAttempt } from "./oauth-flow";

/** In-memory pending attempts. A host restart drops them — the user simply
 *  presses Sign in again; nothing durable is at stake before the exchange. */
export class CustomOAuthAttempts {
  private readonly byState = new Map<string, CustomOAuthAttempt>();

  put(state: string, attempt: CustomOAuthAttempt): void {
    // Starting over invalidates the integration's previous attempt: exactly
    // one outstanding authorize URL can land per integration.
    for (const [key, value] of this.byState) {
      if (value.slug === attempt.slug) this.byState.delete(key);
    }
    this.byState.set(state, attempt);
  }

  /** Unexpired attempts still waiting for their browser to come back. */
  pendingCount(now = Date.now()): number {
    let count = 0;
    for (const attempt of this.byState.values())
      if (now <= attempt.expiresAtMs) count++;
    return count;
  }

  /** Single use: a state is consumed by its first take, valid or not. */
  take(state: string): CustomOAuthAttempt | null {
    const attempt = this.byState.get(state);
    this.byState.delete(state);
    if (!attempt || Date.now() > attempt.expiresAtMs) return null;
    return attempt;
  }
}
