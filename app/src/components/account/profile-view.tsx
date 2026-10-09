import { Button, Input } from "@houston-ai/core";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useMyEditableProfile,
  useSetMyProfile,
} from "../../hooks/queries/use-my-editable-profile";
import { useMyProfile } from "../../hooks/use-my-profile";
import { SettingsCard } from "../settings/settings-row";
import { AccountPage } from "./account-page";
import { ProfilePhotoRow } from "./profile-photo";

/** The gateway's own ceiling: `PUT /v1/me/profile` answers 400 above it. */
const NAME_MAX_CHARS = 60;

/** The inline validation key for a trimmed name, or `null` when it is fine. */
function nameErrorKey(trimmed: string): "nameEmpty" | "nameTooLong" | null {
  if (!trimmed) return "nameEmpty";
  if (trimmed.length > NAME_MAX_CHARS) return "nameTooLong";
  return null;
}

/**
 * The display-name field. Mounted with the saved name as its seed and REMOUNTED
 * by its `key` whenever that saved name changes, so the field re-syncs to server
 * truth without an effect that could overwrite what the user is mid-way through
 * typing. Validation is inline under the field (a toast would scroll away from
 * the thing it is talking about). The save is optimistic: the new name becomes
 * the saved name at once (remounting this form on it), and a refusal puts the
 * old one back with its own toast (`useSetMyProfile`).
 */
function ProfileNameForm({ savedName }: { savedName: string }) {
  const { t } = useTranslation("settings");
  const setProfile = useSetMyProfile();
  const fieldId = useId();
  const errorId = useId();
  const [value, setValue] = useState(savedName);
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const errorKey = nameErrorKey(trimmed);
  const showError = touched && errorKey !== null;
  const canSave = errorKey === null && trimmed !== savedName.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!canSave) return;
    void setProfile(
      { displayName: trimmed },
      {
        saved: t("profile.toasts.saved"),
        failure: {
          title: t("writeFailed.profileName.title"),
          description: t("writeFailed.profileName.description"),
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 px-4 py-4">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {t("profile.name.label")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          value={value}
          maxLength={NAME_MAX_CHARS}
          placeholder={t("profile.name.placeholder")}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          data-testid="profile-name-input"
          onChange={(event) => {
            setValue(event.target.value);
            setTouched(true);
          }}
        />
        <Button
          type="submit"
          disabled={!canSave}
          data-testid="profile-name-save"
        >
          {t("profile.save")}
        </Button>
      </div>
      {showError ? (
        <p id={errorId} className="text-xs text-danger">
          {t(`profile.errors.${errorKey}`)}
        </p>
      ) : (
        <p className="text-xs text-ink-muted">{t("profile.name.hint")}</p>
      )}
    </form>
  );
}

/**
 * Profile: the name and picture every multiplayer surface renders for this
 * user: chat sender rows, face stacks, mentions, the team roster. One card, two
 * hairline-divided rows. The account menu offers it only once the profile read
 * succeeded (`useProfileAvailable`), so the card is there by the time anyone
 * lands here.
 */
export function ProfileView() {
  const { t } = useTranslation("settings");
  const { data: profile } = useMyEditableProfile();
  const me = useMyProfile();
  // The gateway's effective name, falling back to the resolved self-identity
  // for a user whose provider gave no name and who has not set one yet.
  const savedName = profile?.displayName ?? me?.name ?? "";

  return (
    <AccountPage title={t("profile.title")} subtitle={t("profile.subtitle")}>
      {profile && (
        <SettingsCard>
          <ProfilePhotoRow displayName={savedName} />
          <ProfileNameForm key={savedName} savedName={savedName} />
        </SettingsCard>
      )}
    </AccountPage>
  );
}
