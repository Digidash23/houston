import type {
  AuthPrompt,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import type { LoginInfo } from "@houston/runtime-client";
import type { ProviderId } from "../ai/providers";
import { autoPromptAnswer, codexLoginMethod } from "./login-policy";
import type { LoginState } from "./login-state";

export function loginInteraction(
  provider: ProviderId,
  state: LoginState,
  abort: AbortController,
  pastePromise: Promise<string>,
  resolveInfo: (info: LoginInfo) => void,
  deviceAuth: boolean,
  enterpriseDomain?: string,
): ProviderAuthInteraction {
  return {
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
}
