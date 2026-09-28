/**
 * A mission's tag pill ("Routine", "Set up", "Started by Houston"): the one
 * chip the board card and the archived list row both wear, so a tag reads the
 * same wherever the mission is listed. A long tag truncates inside its pill
 * rather than widening the card or the row.
 */
export function KanbanTag({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[18px] min-w-0 max-w-full items-center rounded-full bg-chip px-2 text-[10px] font-medium text-ink-muted">
      <span className="truncate">{label}</span>
    </span>
  );
}
