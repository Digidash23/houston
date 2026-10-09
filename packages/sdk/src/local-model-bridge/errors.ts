// Package self-reference, not a relative path: the app's node:test runner
// loads this module through the `@houston/sdk/local-model-bridge/errors`
// subpath, and node resolves no extensionless relative import.
export { isBridgeUnsupported } from "@houston/sdk/local-model-bridge/unsupported";

export type BridgeState =
  | "model_unavailable"
  | "revoked"
  | "authorization_required"
  | "reconnect_required"
  | "reconnecting";

// Erasable syntax only (no parameter property): `quiet.ts` imports this class
// and the app's node:test runner loads it through a package subpath.
export class BridgeStateError extends Error {
  readonly status: BridgeState;
  constructor(status: BridgeState) {
    super(status);
    this.name = "BridgeStateError";
    this.status = status;
  }
}
export function isAuthorizationFailure(error: unknown) {
  if (error instanceof BridgeStateError)
    return (
      error.status === "authorization_required" || error.status === "revoked"
    );
  if (typeof error !== "object" || error === null) return false;
  return (
    ("status" in error && (error.status === 401 || error.status === 403)) ||
    ("code" in error &&
      [
        "unauthorized",
        "forbidden",
        "revoked",
        "not_owner",
        "not_member",
      ].includes(String(error.code)))
  );
}

export function isPermanentBridgeFailure(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error))
    return false;
  return [400, 404, 409, 410, 422].includes(Number(error.status));
}

/**
 * An explicit operation (connect, resume, disconnect, ...) asked of a
 * controller the binding already superseded: the person switched space, agent
 * or account, and the next controller owns the bridge. Erasable syntax only
 * (see {@link BridgeStateError}).
 */
export class BridgeDisposedError extends Error {
  constructor() {
    super("bridge controller disposed");
    this.name = "BridgeDisposedError";
  }
}

export function cancelledBridgeOperation(explicit: boolean): void {
  if (explicit)
    throw new DOMException("Bridge connection cancelled", "AbortError");
}
export function isBridgeAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * A bridge operation that was CANCELLED rather than failed: its lifetime was
 * invalidated mid-flight (a space, agent or session switch aborted the request
 * it was waiting on, HOUSTON-APP-5HX), or it reached a controller already
 * disposed. Nothing broke and a newer scope owns the bridge, so no surface
 * reports it: not a toast, not Sentry, not even a quiet class.
 */
export function isBridgeCancellation(error: unknown): boolean {
  return isBridgeAbort(error) || error instanceof BridgeDisposedError;
}

export function isBridgeAbsent(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error) ||
    error.status !== 404
  )
    return false;
  if ("code" in error && error.code !== undefined)
    return error.code === "bridge_not_found";
  // HoustonEngineError keeps gateway's top-level code in body; its getter
  // exposes only the nested host error shape.
  const body = "body" in error ? error.body : undefined;
  return (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === "bridge_not_found"
  );
}
