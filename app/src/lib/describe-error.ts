// One readable line for any rejection, for logs and Sentry titles.
// Dependency-free so it is node-testable directly
// (app/tests/error-report-describe.test.ts).

// Short scalar fields safe to name in a report title. Anything else is only
// listed by key: arbitrary payloads can carry personal data into Sentry.
const SCALAR_FIELDS = ["kind", "code", "status", "name"] as const;
const MAX_FIELD = 80;
const MAX_KEYS = 12;

/**
 * The diagnostic a rejection carries, whatever its shape. The shell's typed
 * rejections (`{kind, message}`: file ops, URL opens) are plain objects, and
 * `String(obj)` is "[object Object]": every report of one read exactly that
 * and lost the OS text (HOUSTON-APP-53A). An object with a string `message`
 * reads as `kind: message` when it also has a string `kind`; any other object
 * is summarized as a few whitelisted scalar fields plus its key names, never
 * serialized whole.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null || typeof err !== "object") return String(err);
  const raw = err as Record<string, unknown>;
  if (typeof raw.message === "string") {
    return typeof raw.kind === "string"
      ? `${raw.kind}: ${raw.message}`
      : raw.message;
  }
  return summarize(raw);
}

function summarize(raw: Record<string, unknown>): string {
  const fields = SCALAR_FIELDS.flatMap((field) => {
    const value = raw[field];
    if (typeof value === "string") return [`${field}: ${clip(value)}`];
    if (typeof value === "number" || typeof value === "boolean") {
      return [`${field}: ${value}`];
    }
    return [];
  });
  const keys = Object.keys(raw);
  const listed = keys.slice(0, MAX_KEYS).join(", ");
  const more = keys.length > MAX_KEYS ? ", …" : "";
  const head = fields.length > 0 ? `object {${fields.join(", ")}}` : "object";
  return keys.length > 0 ? `${head} keys: ${listed}${more}` : head;
}

function clip(value: string): string {
  return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
}
