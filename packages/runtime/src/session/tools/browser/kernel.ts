import { DESKTOP_VIEWPORT } from "./live/layout";

type Env = Record<string, string | undefined>;

/** A Kernel (kernel.sh) project's API key: the backup browser's account. */
export interface Kernel {
  apiKey: string;
  /** The tests' seam; the global fetch otherwise. */
  fetch?: typeof fetch;
}

/** One Kernel browser: a whole remote Chromium with one default context. */
export interface KernelSession {
  id: string;
  /** The CDP websocket; it carries a session token, so it is never logged. */
  connectUrl: string;
}

const API = "https://api.onkernel.com";

/**
 * Seconds WITHOUT a CDP connection before Kernel ends the session (not a
 * lifetime cap). A live connection keeps it up; this only reaps a session
 * whose deletion never reached the API.
 */
export const KERNEL_TIMEOUT_S = 600;

/**
 * Why the backup browser did nothing, as a code the operator's log names:
 * Kernel's own error code when its answer had one, else what failed here.
 * The message never carries the key, the CDP url or Kernel's raw text.
 */
export class KernelError extends Error {
  constructor(readonly code: string) {
    super(`Kernel: ${code}`);
    this.name = "KernelError";
  }
}

/**
 * The backup browser's settings, or null. The key IS the switch: absent, the
 * fallback is off and that is logged with its remedy.
 */
export function kernelFrom(env: Env): Kernel | null {
  const apiKey = env.KERNEL_API_KEY?.trim();
  if (apiKey) return { apiKey };
  console.error(
    "[browser] Kernel fallback off: KERNEL_API_KEY is not set. Set it to open sites that block this browser through a Kernel browser.",
  );
  return null;
}

/**
 * Start a headless stealth browser, desktop-sized like every other tab.
 * Stealth routes through Kernel's ISP proxy AND turns on its automatic
 * CAPTCHA solver; Kernel has no switch for the solver alone.
 */
export async function createKernelSession(
  kernel: Kernel,
): Promise<KernelSession> {
  const response = await call(kernel, "POST", "/browsers", {
    stealth: true,
    headless: true,
    timeout_seconds: KERNEL_TIMEOUT_S,
    viewport: DESKTOP_VIEWPORT,
  });
  const body = (await response.json().catch(() => ({}))) as {
    session_id?: unknown;
    cdp_ws_url?: unknown;
  };
  if (
    typeof body.session_id !== "string" ||
    typeof body.cdp_ws_url !== "string"
  )
    throw new KernelError("no_session_in_answer");
  return { id: body.session_id, connectUrl: body.cdp_ws_url };
}

/** End a session now: it is billed until it ends. */
export async function deleteKernelSession(
  kernel: Kernel,
  id: string,
): Promise<void> {
  await call(kernel, "DELETE", `/browsers/${encodeURIComponent(id)}`);
}

/** The code to log for any failure on the backup's path. */
export function kernelCode(error: unknown): string {
  if (error instanceof KernelError) return error.code;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return error instanceof Error ? `error:${error.name}` : "error";
}

async function call(
  kernel: Kernel,
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  let response: Response;
  try {
    response = await (kernel.fetch ?? fetch)(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${kernel.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new KernelError(
      kernelCode(error) === "timeout" ? "timeout" : "unreachable",
    );
  }
  if (response.ok) return response;
  throw new KernelError(`${response.status}:${await errorCode(response)}`);
}

/** Kernel's `{"code": ...}`, reduced to a plain token. */
async function errorCode(response: Response): Promise<string> {
  const parsed: unknown = await response.json().catch(() => null);
  const code =
    parsed && typeof parsed === "object" && "code" in parsed
      ? parsed.code
      : null;
  return typeof code === "string" && /^[\w.-]{1,64}$/.test(code)
    ? code
    : "unknown";
}
