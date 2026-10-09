import type {
  EditableProfile,
  EditableProfileUpdate,
} from "@houston/engine-adapter";

/**
 * The profile as it will read once `update` saves, painted before the host
 * answers. A string sets the field as the user's own; `null` clears the
 * override back to the identity provider's value, which only the host knows,
 * so the field empties until its answer lands (the screen falls back to the
 * session's name, and to initials for a picture). An omitted key is untouched.
 * Idempotent, and a profile never read stays unread.
 */
export function patchEditableProfile(
  profile: EditableProfile | null | undefined,
  update: EditableProfileUpdate,
): EditableProfile | null | undefined {
  if (!profile) return profile;
  let next = profile;
  for (const field of ["displayName", "photoUrl"] as const) {
    const value = update[field];
    if (value === undefined) continue;
    const custom = value !== null;
    const target = value ?? undefined;
    if (next[field] === target && next.custom[field] === custom) continue;
    const { [field]: _dropped, ...rest } = next;
    next = {
      ...rest,
      ...(target === undefined ? {} : { [field]: target }),
      custom: { ...next.custom, [field]: custom },
    };
  }
  return next;
}
