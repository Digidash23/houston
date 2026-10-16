"use client";

import { QuestionAnswerRow } from "./interaction-answer-row";
import { hasSelectableOptions } from "./interaction-card-logic";
import { BrandLogo, QuestionStepBody } from "./interaction-card-parts";
import type {
  ChatInteractionCardLabels,
  QuestionStep,
  StepChrome,
} from "./interaction-card-props";
import { InteractionDetail } from "./interaction-detail";
import { HireApprovalDetails } from "./interaction-hire-details";
import { InteractionModal, InteractionModalTitle } from "./interaction-modal";
import { InteractionUploadArea } from "./interaction-upload-area";
import type { CardAttach } from "./use-card-attachments";

/** The already-translated copy a question step renders, resolved by the card. */
export interface QuestionStepCopy {
  placeholder: string;
  escapePlaceholder: string;
  skip: string;
  send: string;
  esc: string;
  recommended: string;
  /** The upload area's label on a question answered with a file. */
  upload: string;
  /** The answer field's placeholder under that upload area. */
  filePlaceholder: string;
}

/** The card's labels resolved to a question step's copy, English defaults. */
export function questionStepCopy(
  labels: ChatInteractionCardLabels | undefined,
): QuestionStepCopy {
  return {
    placeholder: labels?.placeholder ?? "Type your answer...",
    escapePlaceholder: labels?.escapePlaceholder ?? "Type another option...",
    skip: labels?.skip ?? "Skip",
    send: labels?.send ?? "Send",
    esc: labels?.esc ?? "Esc",
    recommended: labels?.recommended ?? "Recommended",
    upload: labels?.uploadFiles ?? "Upload your files",
    filePlaceholder: labels?.filePlaceholder ?? "Or type your answer...",
  };
}

/**
 * A question step in the shared {@link InteractionModal} shell: the question
 * text in the modal TITLE, the option rows (LEFT number badge = keyboard
 * shortcut, regular-weight label, optional Recommended chip) as the scrollable
 * body, and the answer row (free-text escape field + the card-wide decline)
 * FIXED in the trailing slot so a long option list never scrolls it away.
 * Clicking an option answers and advances, so there is no primary CTA.
 *
 * A question carrying a `brand` (it concerns an integration) instead puts the
 * app's logo + NAME in the title, like the connect card, and moves the question
 * text into the body above the options — one asking system, branded when the app
 * resolved an identity.
 *
 * A question answered with a file (`wantsFiles`) puts a large upload area
 * above its options, and its answer field becomes the "or type it" path.
 */
export function InteractionQuestionStep({
  step,
  chrome,
  copy,
  draft,
  selectedId,
  attach,
  fileAnswer,
  stepFiles,
  onOption,
  onDraftChange,
  onSend,
  onSkip,
}: {
  step: QuestionStep;
  chrome: StepChrome;
  copy: QuestionStepCopy;
  draft: string;
  selectedId: string | null;
  attach: CardAttach | null;
  /** The attached files alone can answer this step (see the card). */
  fileAnswer: boolean;
  /** The attached files that answer this step, shown under its upload area. */
  stepFiles: readonly File[];
  onOption: (optionId: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onSkip: () => void;
}) {
  const { disabled } = chrome;
  const optionsPresent = hasSelectableOptions(step.options);
  const brand = step.brand;
  // No panel list behind the card means nowhere to send a file, so no area.
  const upload = step.wantsFiles === true ? attach : null;
  // The detail block sits ABOVE the options: it is what the question is about,
  // so it must be read before the answer is picked.
  const body = (
    <div className="flex flex-col gap-2.5">
      {step.hire ? <HireApprovalDetails hire={step.hire} /> : null}
      {step.detail ? <InteractionDetail detail={step.detail} /> : null}
      {upload ? (
        <InteractionUploadArea
          attach={upload}
          disabled={disabled}
          files={stepFiles}
          label={copy.upload}
        />
      ) : null}
      <QuestionStepBody
        disabled={disabled}
        onOption={onOption}
        options={step.options}
        recommendedLabel={copy.recommended}
        selectedId={selectedId}
      />
    </div>
  );

  return (
    <InteractionModal
      contentKey={step.id}
      collapseLabel={chrome.collapseLabel}
      disabled={disabled}
      dismissLabel={chrome.dismissLabel}
      expandLabel={chrome.expandLabel}
      onDismiss={chrome.onDismiss}
      onOpenChange={chrome.onOpenChange}
      open={chrome.open}
      pager={chrome.pager}
      // A plain question's title IS the question, so only a branded question
      // (app name in the title, question in the body) needs the collapsed hint.
      collapsedHint={brand ? step.question : undefined}
      title={
        brand ? (
          <InteractionModalTitle
            className="flex-1 truncate"
            icon={
              brand.logoUrl ? (
                <BrandLogo name={brand.name} url={brand.logoUrl} />
              ) : undefined
            }
          >
            {brand.name}
          </InteractionModalTitle>
        ) : (
          <InteractionModalTitle className="text-balance">
            {step.question}
          </InteractionModalTitle>
        )
      }
      body={
        brand ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-balance text-ink text-sm leading-snug">
              {step.question}
            </p>
            {body}
          </div>
        ) : (
          body
        )
      }
      trailing={
        <QuestionAnswerRow
          attach={attach}
          disabled={disabled}
          draft={draft}
          fileAnswer={fileAnswer}
          // Files alone can only be sent from the field's send button.
          hideFreeText={
            optionsPresent &&
            step.hideFreeText === true &&
            step.wantsFiles !== true
          }
          onDraftChange={onDraftChange}
          onSubmit={onSend}
          placeholder={
            upload
              ? copy.filePlaceholder
              : optionsPresent
                ? copy.escapePlaceholder
                : copy.placeholder
          }
          uploadArea={upload !== null}
          sendLabel={copy.send}
          skip={{ label: copy.skip, escLabel: copy.esc, onSkip, disabled }}
        />
      }
    />
  );
}
