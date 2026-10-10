/**
 * Feedback intake for the web build: `POST /feedback` → a Linear issue.
 *
 * The desktop app files feedback/bug reports straight to Linear through a Tauri
 * command (app/src-tauri/src/bug_report). A browser tab has no Tauri and must
 * not hold a Linear key, so the control plane fronts the same flow: the web
 * shim posts the identical payload here and this module formats + files it.
 * Title/description formatting mirrors bug_report/format.rs so web and desktop
 * reports read the same in the Linear queue; the sender is `feedback-linear.ts`.
 */

const MAX_ERROR_CHARS = 6_000;
const MAX_LOG_CHARS = 8_000;

/** Mirrors the desktop BugReportPayload (camelCase wire shape). */
export interface FeedbackPayload {
  command: string;
  error: string;
  spaceName?: string;
  workspaceName?: string;
  userEmail?: string | null;
  timestamp: string;
  appVersion: string;
  logs?: { backend?: string; frontend?: string };
  /** Free-text the user typed (voluntary "Send feedback" only). */
  userMessage?: string;
}

export interface FeedbackSender {
  /** Files the report; resolves to the issue identifier (e.g. "BUG-123") or null. */
  send(payload: FeedbackPayload, userId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Formatting (port of bug_report/format.rs)
// ---------------------------------------------------------------------------

const collapseWhitespace = (s: string): string =>
  s.split(/\s+/).filter(Boolean).join(" ");

export const truncateChars = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`;

const truncateStart = (s: string, max: number): string =>
  s.length <= max ? s : `...\n${s.slice(s.length - Math.max(0, max - 4))}`;

function codeBlock(language: string, content: string): string {
  const longestRun = Math.max(
    0,
    ...content.split(/[^`]+/).map((r) => r.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}\n`;
}

export function formatIssueTitle(p: FeedbackPayload): string {
  const message = collapseWhitespace(p.userMessage ?? "");
  if (message) return truncateChars(`Houston feedback: ${message}`, 140);
  const command = collapseWhitespace(p.command);
  const summary = collapseWhitespace(p.error.split("\n")[0] ?? "");
  return truncateChars(
    summary
      ? `Houston bug: ${command} - ${summary}`
      : `Houston bug: ${command}`,
    140,
  );
}

export function formatIssueDescription(
  p: FeedbackPayload,
  userId: string,
): string {
  let d = "";
  const message = (p.userMessage ?? "").trim();
  if (message) d += `## What the user said\n\n${message}\n\n`;
  d += `## Error\n\n${codeBlock("text", truncateStart(p.error, MAX_ERROR_CHARS))}`;
  d += "\n## Context\n\n";
  const line = (label: string, value: string | null | undefined) => {
    if (value) d += `- ${label}: ${value}\n`;
  };
  line("Command", p.command);
  line("Surface", "Houston Web (cloud)");
  line("Timestamp", p.timestamp);
  line("App Version", p.appVersion);
  line("User", p.userEmail ?? undefined);
  line("User Id", userId);
  line("Space", p.spaceName);
  line("Workspace", p.workspaceName);
  const backend = p.logs?.backend ?? "";
  const frontend = p.logs?.frontend ?? "";
  if (backend)
    d += `\n## Backend Logs (last 50 lines)\n\n${codeBlock("text", truncateStart(backend, MAX_LOG_CHARS))}`;
  if (frontend)
    d += `\n## Frontend Logs (last 50 lines)\n\n${codeBlock("text", truncateStart(frontend, MAX_LOG_CHARS))}`;
  return d;
}

/**
 * The intake refusing a report, typed (H-009, HOUSTON-APP-5FT).
 * `intake_unavailable` is Linear refusing EVERY report on our side (the
 * workspace's plan issue cap, a rate limit, an outage): the route answers it
 * `503 {code: "intake_unavailable"}` and the app delivers the report through
 * its fallback. Anything else is `other`, a real failure.
 */
export class FeedbackIntakeError extends Error {
  constructor(
    message: string,
    readonly kind: "intake_unavailable" | "other",
  ) {
    super(message);
    this.name = "FeedbackIntakeError";
  }
}

/** Linear's plan cap ("usage limit exceeded", "exceeded the free issue
 *  limit") and its rate limiter (code `RATELIMITED`), matched lowercase over
 *  an error's message and every string in its `extensions`. */
const INTAKE_LIMIT = /usage[ _]limit|issue limit|ratelimited|rate limit/i;

export function isIntakeLimitRefusal(error: {
  message?: unknown;
  extensions?: unknown;
}): boolean {
  const texts = [error.message];
  if (error.extensions && typeof error.extensions === "object")
    texts.push(...Object.values(error.extensions));
  return texts.some((t) => typeof t === "string" && INTAKE_LIMIT.test(t));
}

/** A non-2xx Linear answer: 429 and 5xx refuse everyone; a 400 body can
 *  still name the quota. */
export function httpRefusalKind(
  status: number,
  body: string,
): FeedbackIntakeError["kind"] {
  return status === 429 || status >= 500 || INTAKE_LIMIT.test(body)
    ? "intake_unavailable"
    : "other";
}

/** Parse + bound the untrusted request body into a FeedbackPayload, or throw. */
export function parseFeedbackPayload(
  body: Record<string, unknown>,
): FeedbackPayload {
  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.slice(0, max) : "";
  const opt = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v ? v.slice(0, max) : undefined;
  const command = str(body.command, 200);
  if (!command) throw new Error("missing 'command'");
  const logs = (body.logs ?? {}) as Record<string, unknown>;
  return {
    command,
    error: str(body.error, 20_000),
    spaceName: opt(body.spaceName, 200),
    workspaceName: opt(body.workspaceName, 200),
    userEmail: opt(body.userEmail, 320),
    timestamp: str(body.timestamp, 64),
    appVersion: str(body.appVersion, 64),
    logs: {
      backend: str(logs.backend, 50_000),
      frontend: str(logs.frontend, 50_000),
    },
    userMessage: opt(body.userMessage, 10_000),
  };
}
