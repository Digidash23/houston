type Env = Record<string, string | undefined>;

/**
 * What Chromium needs from the environment to start and render: where things
 * are (PATH, HOME, temp dirs, XDG and Windows profile folders), the locale,
 * the time zone and fonts. Windows names are matched without case, the way
 * Windows reads them.
 */
const KEPT = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "PATHEXT",
  "COMSPEC",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
]);
const KEPT_PREFIXES = ["LC_", "FONTCONFIG_", "XDG_"];

/**
 * The browser's environment: only {@link KEPT}. Playwright otherwise hands
 * Chromium this whole process's environment, and with it the turn's host
 * token, provider keys and every other secret, readable by anything that
 * compromises a renderer (or the GPU or network process).
 */
export function browserEnv(env: Env): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (KEPT.has(upper) || KEPT_PREFIXES.some((p) => upper.startsWith(p)))
      kept[name] = value;
  }
  return kept;
}
