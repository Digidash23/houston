/**
 * A mission's card is born with this truncated title; its first send carries it
 * as `missionTitle.fallback`, and the runtime replaces it with an AI title after
 * that turn's reply (only while the card still shows it).
 */
export { fallbackMissionTitle } from "./mission-title-text";
