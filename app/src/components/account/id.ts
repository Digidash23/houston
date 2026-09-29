/**
 * The person's own screens: Profile (their name and picture) and About me
 * (what every AI Employee knows about them). Both are top-level views opened
 * from the account menu (`shell/sidebar-account-menu.tsx`), on both
 * breakpoints, and from nowhere else.
 */
export const PROFILE_VIEW_ID = "profile";
export const ABOUT_ME_VIEW_ID = "about-me";

export type AccountViewId = typeof PROFILE_VIEW_ID | typeof ABOUT_ME_VIEW_ID;
