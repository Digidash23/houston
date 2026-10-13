/**
 * The preferences contract: the key/value preferences that follow the person
 * across surfaces, the workspace locale, and the timezone seed.
 *
 * Re-exported wholesale by the package barrel; import from `@houston/sdk`.
 */
// ===== Preferences module contract =====================================
export {
  PreferencesCommand,
  type PreferencesCommandType,
  type PreferencesModule,
  TIMEZONE_PREFERENCE,
  type TimezoneSeedInput,
  type TimezoneSeedResult,
} from "./modules/preferences";
