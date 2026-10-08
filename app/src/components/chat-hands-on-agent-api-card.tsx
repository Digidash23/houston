import type { StepChrome } from "@houston-ai/chat";
import { Button } from "@houston-ai/core";
import { Bot, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../lib/types";
import { AgentApiDetails } from "./agent-settings/agent-api-details";
import {
  ChatConnectStepShell,
  type StepDraftApi,
} from "./chat-connect-step-shell";

interface Props extends StepChrome, StepDraftApi {
  stepId: string;
  reason?: string;
  /** "API access for {name}": the title, and what the reply reports. */
  name: string;
  /** The employee, once the roster holds it; `null` while it loads. */
  agent: Pick<Agent, "id" | "name"> | null;
  onFinished: (name: string) => void;
  onSkip: (name: string, message?: string) => void;
}

/**
 * The AI Manager's API access errand, done right in the chat: the employee's
 * Agent ID, the Organization ID and the ready setup prompt, the same block its
 * API access screen shows ({@link AgentApiDetails}). Nothing to navigate to;
 * Done and Skip are the answers, as on every errand.
 */
export function ChatHandsOnAgentApiCard({
  stepId,
  reason,
  name,
  agent,
  onFinished,
  onSkip,
  ...chrome
}: Props) {
  const { t } = useTranslation(["chat", "settings"]);

  return (
    <ChatConnectStepShell
      {...chrome}
      busy={false}
      cta={
        <Button
          className="gap-1.5"
          disabled={!agent}
          onClick={() => onFinished(name)}
          size="sm"
          type="button"
        >
          <Check className="size-3.5" />
          {t("chat:interaction.handsOnDone")}
        </Button>
      }
      done={false}
      icon={<Bot className="size-5 shrink-0 text-ink" />}
      onDecline={(message) => onSkip(name, message)}
      reason={
        reason ??
        (agent
          ? t("chat:interaction.agentApiReason", { name: agent.name })
          : null)
      }
      stepId={stepId}
      title={name}
    >
      {agent ? (
        <AgentApiDetails agent={agent} compact />
      ) : (
        <p className="text-ink-muted text-sm">
          {t("settings:apiKeys.idRow.loading")}
        </p>
      )}
    </ChatConnectStepShell>
  );
}
