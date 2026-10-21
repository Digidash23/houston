/**
 * The briefing's one bright element: its primary action, a full-width pill.
 * Kept apart from the frame so a step renders without the frame's stylesheet,
 * which styles `plan-briefing-cta`.
 */
export function PlanBriefingCta({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="plan-briefing-cta h-12 w-full rounded-full bg-ink text-base font-medium text-dialog outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
    >
      {label}
    </button>
  );
}
