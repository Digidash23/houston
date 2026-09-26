import { useReducedMotion } from "framer-motion";
import { type FormEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EditableEmployeeCard } from "../../employee-card/editable-employee-card";
import {
  EmployeeCardDeck,
  focusEmployeeName,
} from "../../employee-card/employee-card-deck";
import type { BasicTeamSubmit } from "./basic-team-model";
import { RosterEmployeeCard } from "./roster-employee-card";
import { TeamBasicAttention } from "./team-basic-attention";
import type { RosterPatch } from "./team-roster-edit";
import type { BasicTeam } from "./use-basic-team";

/**
 * The starter team, welcomed as new hires: each one an employee card named
 * for its job, with the name, the job, the industry and the color all open to
 * change, then hired together by the footer's primary. Before hiring, the
 * footer's "Hire one more" adds a card on top, scrolled into view, and a
 * draft's Remove lets it go. Once hired, a card shows its
 * status and stays editable through the roster. A hire made one by one that
 * failed is named above them (`TeamBasicAttention`), since it holds the team
 * back from finishing.
 *
 * The cards are one form so Enter in any name hires the team, the same as the
 * primary in the footer, which submits it by `formId`. A name that holds the
 * team back takes the person to that card's field.
 */
export function TeamBasicView({
  team,
  takenNames,
  formId,
  onSubmit,
  onEdit,
  onRetry,
  onRemove,
}: {
  team: BasicTeam;
  /** Every name taken in the workspace and on the roster. */
  takenNames: readonly string[];
  formId: string;
  onSubmit: () => BasicTeamSubmit;
  /** Edits a hire on the roster, by its roster key. */
  onEdit: (key: string, patch: RosterPatch) => void;
  /** Tries a failed create again, by its roster key. */
  onRetry: (key: string) => void;
  /** Lets a failed hire made one by one go, by its roster key. */
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation("setup");
  const reduce = useReducedMotion() ?? false;
  const form = useRef<HTMLFormElement>(null);
  // A card added on top is brought into view, wherever the person scrolled.
  const firstKey = team.rows[0]?.key;
  const shownFirst = useRef(firstKey);
  useEffect(() => {
    if (firstKey === shownFirst.current) return;
    shownFirst.current = firstKey;
    form.current?.querySelector("li")?.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [firstKey, reduce]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const outcome = onSubmit();
    if (outcome.kind === "invalid") {
      focusEmployeeName(form.current, outcome.index, reduce);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-balance text-2xl font-normal">
          {t("team.basic.title")}
        </h2>
        <p className="text-sm text-ink-muted">{t("team.basic.subtitle")}</p>
      </div>
      <TeamBasicAttention
        members={team.offscreenFailures}
        takenNames={takenNames}
        onEdit={onEdit}
        onRetry={onRetry}
        onRemove={onRemove}
      />
      <form ref={form} id={formId} onSubmit={submit}>
        <EmployeeCardDeck
          items={team.rows.map((row, index) => {
            const { joined } = row;
            return {
              key: row.key,
              card: joined ? (
                <RosterEmployeeCard
                  member={joined}
                  takenNames={takenNames}
                  onEdit={(patch) => onEdit(joined.key, patch)}
                  onRetry={() => onRetry(joined.key)}
                />
              ) : (
                <EditableEmployeeCard
                  layout="grid"
                  role={row.roleLabel}
                  industry={row.industry}
                  status="draft"
                  color={row.color}
                  onColorChange={(color) => team.recolor(index, color)}
                  onBriefChange={(field, answer) =>
                    team.answer(index, field, answer)
                  }
                  onRemove={
                    row.removable ? () => team.remove(index) : undefined
                  }
                  message={row.error}
                  invalid={row.error !== null}
                  name={{
                    value: row.name,
                    onChange: (name) => team.rename(index, name),
                  }}
                />
              ),
            };
          })}
        />
      </form>
    </div>
  );
}
