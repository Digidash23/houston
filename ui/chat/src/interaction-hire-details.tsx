import { resolveAgentColor } from "@houston-ai/core";
import { MessageResponse } from "./ai-elements/message";
import type { ChatInteractionStep } from "./interaction-card-model";

type Hire = NonNullable<
  Extract<ChatInteractionStep, { kind: "question" }>["hire"]
>;

export function HireApprovalDetails({ hire }: { hire: Hire }) {
  return (
    <div className="flex flex-col gap-2.5">
      {hire.color || hire.role ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          {hire.color ? (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: resolveAgentColor(hire.color) }}
            />
          ) : null}
          {hire.role ? <span>{hire.role}</span> : null}
        </div>
      ) : null}
      {hire.instructions ? (
        <details className="group rounded-lg border border-line/50 bg-chip-subtle/50 px-3 py-2 text-sm text-ink">
          <summary className="cursor-pointer select-none text-ink focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {hire.instructionsLabel ?? "See their instructions"}
          </summary>
          <div className="mt-3 max-h-48 overflow-auto break-words border-t border-line/50 pt-3 text-ink">
            <MessageResponse isAnimating={false}>
              {hire.instructions}
            </MessageResponse>
          </div>
        </details>
      ) : null}
    </div>
  );
}
