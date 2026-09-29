import { useTranslation } from "react-i18next";
import { ContextEditorBox } from "../context/context-editor";
import { ContextSlotWaiting } from "../context/context-slot-waiting";
import { useContextSlot } from "../context/context-slots";
import { AccountPage } from "./account-page";

/**
 * About me: what every agent knows about the PERSON before it starts a turn.
 *
 * One of the account menu's screens, beside their Profile: a standing fact
 * the person sets about themselves. It shares that screen's page shape
 * (`AccountPage`), a reading column that scrolls, so it draws the editor as a
 * COMPACT card ({@link ContextEditorBox}'s `rows` mode): a card that claimed
 * the viewport height inside a scrolling column would have none to claim.
 *
 * The stored file is the workspace context blob's `user` slot
 * (`context-slots.ts` → `use-workspace-context.ts`), which the open agent's
 * runtime reads into its prompt. The box waits for that read behind
 * {@link ContextSlotWaiting}: a loading frame, or the honest word that the
 * workspace has no AI Employee yet.
 */
export function AboutMeView() {
  const { t } = useTranslation("context");
  const editor = useContextSlot("user");

  return (
    <AccountPage title={t("aboutMe.title")} subtitle={t("aboutMe.subtitle")}>
      {editor.state === "ready" ? (
        <ContextEditorBox
          layout={{ rows: 14 }}
          ariaLabel={t("aboutMe.title")}
          content={editor.content}
          onSave={editor.onSave}
          placeholder={t("editor.user.placeholder")}
        />
      ) : (
        <ContextSlotWaiting state={editor.state} />
      )}
    </AccountPage>
  );
}
