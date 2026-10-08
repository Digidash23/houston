import type { StepChrome } from "@houston-ai/chat";
import { Button } from "@houston-ai/core";
import { Check, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../stores/ui";
import {
  ChatConnectStepShell,
  type StepDraftApi,
} from "./chat-connect-step-shell";
import {
  ApiKeyNameField,
  ApiKeyReveal,
  useApiKeyCreateFlow,
} from "./settings/sections/api-key-create-flow";

interface Props extends StepChrome, StepDraftApi {
  stepId: string;
  reason?: string;
  /** The screen's display name; what the reply tells the agent was finished. */
  name: string;
  /** Suggested key name (the employee this key is for), `""` for none. */
  keyName: string;
  /** False while capabilities load: nothing is minted against a deployment
   *  that may not serve the API. */
  ready: boolean;
  onFinished: (name: string) => void;
  onSkip: (name: string, message?: string) => void;
}

/**
 * The AI Manager's API-key errand, done right in the chat: name a key, create
 * it, copy the secret from the one-time reveal. Same flow as Settings > API
 * keys (`api-key-create-flow.tsx`). Rendered in the Manager's chat ONLY: in a
 * mission chat a model-authored reason above a mint form, beside a box that
 * talks to that same agent, would be a phishing kit in Houston's chrome.
 *
 * The secret never leaves this card. The flow keeps it in local state, and
 * Done and Skip report only the screen's NAME. Once it is shown the card is
 * LOCKED: Done is the only way out (no Skip, no "do this instead" row the key
 * could be pasted into, Esc swallowed), and Done waits out an in-flight mint
 * so no key is created after the card is gone. The safety line is fixed copy,
 * never the model's reason. The person may say Done without creating one (they
 * already hold a key), so Done stands beside Create from the start.
 */
export function ChatHandsOnApiKeyCard({
  stepId,
  reason,
  name,
  keyName,
  ready,
  onFinished,
  onSkip,
  ...chrome
}: Props) {
  const { t } = useTranslation(["chat", "settings"]);
  const flow = useApiKeyCreateFlow(keyName);
  const formId = `api-key-form-${stepId}`;
  const revealed = flow.revealed;
  const finish = () => {
    flow.clear();
    onFinished(name);
  };

  return (
    <ChatConnectStepShell
      {...chrome}
      busy={flow.pending}
      cta={
        <>
          <Button
            className="gap-1.5"
            disabled={flow.pending}
            onClick={finish}
            size="sm"
            type="button"
            variant={revealed ? "default" : "outline"}
          >
            <Check className="size-3.5" />
            {t("chat:interaction.handsOnDone")}
          </Button>
          {!revealed && (
            <Button
              disabled={!ready || !flow.canSubmit}
              form={formId}
              size="sm"
              type="submit"
            >
              {t("settings:apiKeys.create.submit")}
            </Button>
          )}
        </>
      }
      done={false}
      icon={<KeyRound className="size-5 shrink-0 text-ink" />}
      locked={revealed !== null}
      onDecline={(message) => {
        flow.clear();
        onSkip(name, message);
      }}
      reason={reason ?? t("chat:interaction.apiKeyReason")}
      stepId={stepId}
      title={t("chat:interaction.apiKeyTitle")}
    >
      <p className="text-ink-muted text-sm">
        {t("chat:interaction.apiKeySafety")}
      </p>
      {revealed ? (
        <ApiKeyReveal created={revealed} />
      ) : !ready ? (
        <p className="text-ink-muted text-sm">
          {t("settings:apiKeys.idRow.loading")}
        </p>
      ) : (
        <>
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              void flow.submit();
            }}
          >
            <ApiKeyNameField flow={flow} />
          </form>
          {/* A side door, never the way through: the key is made right here. */}
          <Button
            className="self-start px-0"
            onClick={() => useUIStore.getState().openSettings("apiKeys")}
            size="sm"
            type="button"
            variant="link"
          >
            {t("chat:interaction.apiKeyManage")}
          </Button>
        </>
      )}
    </ChatConnectStepShell>
  );
}
