import type { ReactNode } from "react";
import { PageContainer, PageHero } from "../shell/page-shell";

/**
 * The frame both account screens share: the Settings index's own page shape
 * (the reading column, the 24px title and its muted subtitle), owning the
 * whole window with no back bar, because the account menu opens them as
 * top-level screens with no level above.
 */
export function AccountPage(props: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <PageContainer className="py-10">
        <PageHero
          title={props.title}
          subtitle={props.subtitle}
          className="mb-8 px-1"
        />
        {props.children}
      </PageContainer>
    </div>
  );
}
