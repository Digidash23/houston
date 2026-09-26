import type { FormEvent } from "react";
import { useEffect, useRef } from "react";
import { isMobileViewport } from "../../lib/viewport";
import { EditableEmployeeCard } from "../employee-card/editable-employee-card";
import type { CreateAgentFlow } from "./use-create-agent-flow";

/** The button that submits `form` from outside it: the frame's primary. */
const primaryOf = (form: HTMLFormElement | null) =>
  Array.from(form?.elements ?? []).find(
    (element): element is HTMLButtonElement =>
      element instanceof HTMLButtonElement && element.type === "submit",
  );

/**
 * The last step of a hire: the new AI Employee's own card, centred, already
 * named for its job, so the hire is one press away. The card carries the job
 * and the industry the two questions before it answered, and the name and the
 * color, each open to a change in plain sight: the name's pencil and each
 * line's chevron say so on the card itself.
 *
 * The action is the frame's bottom bar, which submits this form by `formId`,
 * so Enter in the name and a press on the bar are the same submit. On a
 * desktop the bar's primary takes the focus, so Enter hires at once; a phone
 * focuses nothing, since a focused name would raise the keyboard over the
 * card. A submit the name holds back puts the person back in the field, with
 * the card saying why.
 */
export function CustomizeStep({
  flow,
  formId,
}: {
  flow: CreateAgentFlow;
  formId: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMobileViewport()) return;
    primaryOf(form.current)?.focus({ preventScroll: true });
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (flow.submit() === "invalid") nameField.current?.focus();
  };

  return (
    <form
      ref={form}
      id={formId}
      onSubmit={submit}
      className="flex flex-col items-center"
    >
      <EditableEmployeeCard
        layout="solo"
        role={flow.roleState.roleLabel.trim()}
        industry={flow.roleState.contextLabel.trim()}
        status="draft"
        color={flow.color}
        onColorChange={flow.onColorChange}
        onBriefChange={flow.roleState.answerBrief}
        message={flow.message}
        invalid={flow.nameInvalid}
        name={{
          value: flow.name,
          onChange: flow.onNameChange,
          inputRef: nameField,
        }}
      />
    </form>
  );
}
