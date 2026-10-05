import type {
  AuthPrompt,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import type { LoginInfo } from "@houston/runtime-client";
import {
  isProvider,
  type ProviderId,
  providerAuthMethod,
} from "../ai/providers";
import { preflightCodexCallbackPort } from "./codex-port-preflight";
import { clearProviderMarks } from "./credential-health";
import { runClaudeLogin, runProviderOAuthLogin } from "./login-drivers";
import {
  autoPromptAnswer,
  codexLoginMethod,
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
} from "./login-policy";

import {
  active,
  activeKey,
  armLoginExpiry,
  COPILOT_NO_ACCESS_ERROR,
  clearLoginExpiry,
  type LoginState,
  loginFailureMessage,
} from "./login-state";

const known = (id: string): id is ProviderId => isProvider(id);
export async function startLogin(
  providerId: string,
  deviceAuth = true,
  enterpriseDomain?: string,
): Promise<LoginInfo> {
  if (!known(providerId)) throw new Error(`unknown provider: ${providerId}`);
  if (providerAuthMethod(providerId) !== "oauth")
    throw new Error(`${providerId} does not use OAuth sign-in`);
  const provider = providerId;

  // Reuse before probing: an existing Codex login holds its own callback port.
  const key = activeKey(provider);
  const existing = active.get(key);
  if (
    existing &&
    (existing.status === "starting" || existing.status === "awaiting_user") &&
    existing.info
  ) {
    armLoginExpiry(provider, existing);
    return existing.info;
  }

  if (
    provider === "openai-codex" &&
    codexLoginMethod({ deviceAuth }) === OPENAI_CODEX_BROWSER_LOGIN_METHOD
  ) {
    await preflightCodexCallbackPort();
  }

  const abort = new AbortController();
  const state: LoginState = {
    status: "starting",
    abort,
  };
  active.set(key, state);
  armLoginExpiry(provider, state);

  let resolveInfo!: (i: LoginInfo) => void;
  const infoReady = new Promise<LoginInfo>((r) => (resolveInfo = r));
  const pastePromise = new Promise<string>((resolve, reject) => {
    state.resolvePaste = resolve;
    state.rejectPaste = reject;
  });
  // Device flows never consume this promise, but cancellation still rejects it.
  pastePromise.catch(() => {});

  const interaction: ProviderAuthInteraction = {
    signal: abort.signal,
    notify: (event) => {
      switch (event.type) {
        case "auth_url":
          state.info = { kind: "url", url: event.url };
          state.status = "awaiting_user";
          resolveInfo(state.info);
          return;
        case "device_code":
          state.info = {
            kind: "device_code",
            verificationUri: event.verificationUri,
            userCode: event.userCode,
          };
          state.status = "awaiting_user";
          resolveInfo(state.info);
          return;
        default:
          console.log(`[oauth:${provider}]`, event.message);
          return;
      }
    },
    prompt: (p: AuthPrompt) => {
      if (p.type === "select") {
        if (provider === "openai-codex")
          return Promise.resolve(codexLoginMethod({ deviceAuth }));
        const first = p.options[0]?.id;
        console.warn(
          `[oauth:${provider}] auto-selecting "${first}" for: ${p.message}`,
        );
        return first
          ? Promise.resolve(first)
          : Promise.reject(new Error(`no options for prompt: ${p.message}`));
      }
      if (p.type === "manual_code") return pastePromise;
      const auto = autoPromptAnswer(provider, enterpriseDomain);
      return auto === null ? pastePromise : Promise.resolve(auto);
    },
  };

  const login: Promise<unknown> =
    provider === "anthropic"
      ? runClaudeLogin(state, pastePromise, resolveInfo)
      : runProviderOAuthLogin(provider, interaction);

  void login
    .then(() => {
      clearLoginExpiry(state);
      clearProviderMarks(provider);
      state.status = "complete";
      console.log(`[oauth:${provider}] login complete`);
    })
    .catch((e: unknown) => {
      clearLoginExpiry(state);
      if (state.abort?.signal.aborted) {
        console.log(`[oauth:${provider}] login flow closed`);
        return;
      }
      state.status = "error";
      const raw = e instanceof Error ? e.message : String(e);
      state.error = loginFailureMessage(provider, raw);
      if (state.error === COPILOT_NO_ACCESS_ERROR) {
        console.warn(
          `[oauth:${provider}] login refused: 403 no_copilot_access — account has no Copilot subscription`,
        );
        return;
      }
      console.error(`[oauth:${provider}] failed:`, raw);
    });

  return Promise.race([
    infoReady,
    new Promise<LoginInfo>((_, rej) =>
      setTimeout(
        () => rej(new Error(`timed out starting ${provider} login`)),
        15_000,
      ),
    ),
  ]);
}
