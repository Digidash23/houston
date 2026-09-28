const TITLE_MAX = 40;

export function fallbackMissionTitle(text: string): string {
  const normalized = normalizeSpaces(text);
  if (normalized.length === 0) return "New mission";
  if ([...normalized].length <= TITLE_MAX) return normalized;

  const slice = takeChars(normalized, TITLE_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}...`;
}

function normalizeSpaces(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ");
}

function takeChars(value: string, count: number): string {
  return [...value].slice(0, count).join("");
}
