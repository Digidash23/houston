/**
 * The pooled runtime admits bounded work, hydrates a throwaway agent root,
 * publishes durable changes, then wipes the root. A login reserves the process
 * for one sign-in and cannot share it with turns or ops.
 *
 * Authorization is two-layered: deployment IAM protects the endpoint, while
 * X-Internal-Token is the application secret for dispatched work and logins.
 */
import { createServer, type Server } from "node:http";
import { AdmissionLimiter, turnConcurrency } from "./admission";
import { makeLoginRunnerRoutes } from "./login-runner-routes";
import { authorized, incarnationOK, json } from "./server-http";
import type { TurnServerDeps } from "./server-types";
import { serveOp, serveTurn } from "./server-work";

export type { TurnServerDeps } from "./server-types";

export function createTurnServer(deps: TurnServerDeps): Server {
  const admission =
    deps.admission ??
    new AdmissionLimiter(deps.concurrency ?? turnConcurrency());
  let use: "login" | "work" | undefined;
  let loginBegin: Promise<void> | undefined;
  const login = makeLoginRunnerRoutes(deps.loginRunner);
  return createServer((req, res) => {
    // Start before the body streams in so upload time is measured separately.
    const arrival: Record<string, number> = { t_arrived: performance.now() };
    (async () => {
      const path = (req.url || "/").split("?")[0];
      if (req.method === "GET" && path === "/health") {
        // Report a spent worker as NOT-ready so probes mark it 0/1 READY while
        // awaiting recycle, and the dispatcher cannot send it more work.
        if (use === "login" || deps.isDraining?.()) {
          return json(res, 503, { status: "draining", mode: "turn" });
        }
        return json(res, 200, { status: "ok", mode: "turn" });
      }
      if (req.method === "GET" && path === "/v1/capabilities") {
        return json(
          res,
          200,
          (deps.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL)
            ? { localModelBridge: { versions: [1] } }
            : {},
        );
      }
      const isLogin = path.startsWith("/login/");
      if (
        !isLogin &&
        (req.method !== "POST" || (path !== "/turn" && path !== "/op"))
      ) {
        return json(res, 404, { error: "not found" });
      }
      if (!authorized(req, deps.token)) {
        return json(res, 401, { error: "unauthorized" });
      }
      if (!incarnationOK(req, deps.podUid, Boolean(deps.singleUse))) {
        return json(res, 409, { error: "pod_uid_mismatch" });
      }
      if (
        isLogin
          ? use === "work" || (use !== "login" && deps.isDraining?.())
          : use === "login" || deps.isDraining?.()
      ) {
        return json(
          res,
          503,
          { error: "worker_draining" },
          { "Retry-After": "1" },
        );
      }
      if (isLogin) {
        if (!use) {
          use = "login";
          loginBegin = Promise.resolve().then(() => deps.singleUse?.begin());
        }
        await loginBegin;
        await login(req, res);
        return;
      }
      use = "work";
      if (path === "/op") {
        await serveOp(deps, admission, req, res);
      } else {
        await serveTurn(deps, admission, req, res, arrival);
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[turn] unhandled:", message);
      if (!res.headersSent) json(res, 500, { error: message });
      else if (!res.writableEnded) res.end();
    });
  });
}
