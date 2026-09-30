/**
 * How old an interrupted turn may be and still be run again without anyone
 * asking. A desktop force-quit is a restart too: relaunching the app days
 * later must not quietly spend tokens on last week's task. Two hours covers
 * the long pod turns this exists for (the PRODUCT-1778 render ran 31 minutes
 * before its eviction, plus up to 8 minutes of drain); past it the chat keeps
 * the "say continue" line and the user decides.
 */
export const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;
