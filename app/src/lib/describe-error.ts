// One readable line for any rejection, for logs and Sentry titles.
// Dependency-free so it is node-testable directly
// (app/tests/error-report-describe.test.ts).

const MAX_SERIALIZED = 500;

/**
 * The diagnostic a rejection carries, whatever its shape. The shell's typed
 * rejections (`{kind, message}`: file ops, URL opens) are plain objects, and
 * `String(obj)` is "[object Object]": every report of one read exactly that
 * and lost the OS text (HOUSTON-APP-53A). An object with a string `message`
 * reads as `kind: message` when it also has a string `kind`; any other object
 * is serialized, capped, and a circular one falls back to its keys.
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
  try {
    const json = JSON.stringify(err);
    return json.length > MAX_SERIALIZED
      ? `${json.slice(0, MAX_SERIALIZED)}…`
      : json;
  } catch {
    return `unserializable object with keys: ${Object.keys(raw).join(", ")}`;
  }
}
