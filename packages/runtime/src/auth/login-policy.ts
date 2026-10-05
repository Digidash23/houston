/**
 * pi-ai's Codex login-method select-option ids. pi ≥0.80.8 stopped exporting
 * the named constants (the login select is now a generic `AuthPrompt` whose
 * options carry these ids — see pi-ai auth/oauth/openai-codex.ts), so the
 * values are pinned by literal here; a drift would surface as pi's own
 * "Unknown OpenAI Codex login method" error at login time.
 */
export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";
export const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";

/**
 * Which Codex OAuth flow to run — decided SOLELY by `deviceAuth`. The
 * browser/loopback login (the user approves in their own browser, no code to
 * type) works even against a headless/remote runtime: pi's loginOpenAICodex
 * races its own local callback server against a manually-relayed code
 * (the `manual_code` prompt, wired below). The desktop client catches the fixed
 * `http://localhost:1455/auth/callback` redirect and relays code+state via
 * `completeLogin`, and the runtime performs the token exchange — so the loopback
 * never needs to be reachable from the runtime itself. `deviceAuth: false` is
 * only sent by clients that can catch/relay that loopback callback; everyone
 * else (a remote webapp, cloud OR self-host) sends `deviceAuth: true` and gets
 * the device-code grant, where the user types a one-time code while the runtime
 * polls.
 */
export function codexLoginMethod(opts: { deviceAuth: boolean }): string {
  return opts.deviceAuth
    ? OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD
    : OPENAI_CODEX_BROWSER_LOGIN_METHOD;
}

/**
 * Auto-answer for a provider's interactive text prompt (`onPrompt`), or null to
 * defer to the user. GitHub Copilot's pi-ai login OPENS with an optional
 * "GitHub Enterprise URL/domain" question before it emits the device code;
 * leaving it unanswered deadlocks the flow (the device code never appears). We
 * answer it programmatically: the company domain for an Enterprise connect, or
 * "" (=> github.com) for individual Copilot. Every other provider's `onPrompt`
 * is a manual code-paste that MUST wait for the user — those return null so the
 * caller hands back the paste promise.
 */
export function autoPromptAnswer(
  provider: string,
  enterpriseDomain?: string,
): string | null {
  return provider === "github-copilot" ? (enterpriseDomain ?? "") : null;
}
