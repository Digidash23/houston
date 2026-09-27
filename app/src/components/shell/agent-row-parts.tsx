import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentRowLine } from "./agent-row-line";

/**
 * An agent row's second line, drawn in words alone and always in the row's
 * muted line style: the status lives in the avatar's running ring and the
 * needs-you count, so the line only says what the task is, and the name above
 * it stays the one strong thing on the row.
 */
export function AgentRowLineText({ line }: { line: AgentRowLine }): ReactNode {
  const { t } = useTranslation("shell");
  switch (line.kind) {
    case "empty":
      return null;
    case "role":
      return line.role;
    case "firstDay":
      return t("sidebar.firstDay");
    case "mission":
      return line.title || t("sidebar.working");
  }
}
