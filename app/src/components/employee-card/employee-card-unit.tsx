import { cn } from "@houston-ai/core";
import type { ReactNode } from "react";
import type { EmployeeCardLayout } from "./employee-card-model";

export function EmployeeCardUnit({
  layout,
  label,
  card,
}: {
  layout: EmployeeCardLayout;
  label: string;
  card: ReactNode;
}) {
  return (
    <fieldset
      className={cn("flex w-full min-w-0", layout === "solo" && "max-w-2xl")}
    >
      <legend className="sr-only">{label}</legend>
      {card}
    </fieldset>
  );
}
