import { createServer, type Server } from "node:http";
import { MAX_UPLOAD_BODY_BYTES } from "@houston/host/src/turn/files-import";
import { AdmissionLimiter, turnConcurrency } from "./admission";
import { executeOp } from "./execute-op";
import { executeTurn } from "./execute-turn";
import { makeLoginRunnerRoutes } from "./login-runner-routes";
import { parseTurnRequest } from "./parse-turn-request";
import { authorized, incarnationOK, json, readJson } from "./server-http";
import type { TurnServerDeps } from "./server-types";
import type { TurnRequest } from "./types";

export type { TurnServerDeps } from "./server-types";

const OP_BODY_MAX_BYTES = MAX_UPLOAD_BODY_BYTES + 1024 * 1024;

export function createTurnServer(deps: TurnServerDeps): Server {
  const admission =
    deps.admission ??
    new AdmissionLimiter(deps.concurrency ?? turnConcurrency());
  let use: "login" | "work" | undefined;
  let loginBegin: Promise<void> | undefined;
  const login = makeLoginRunnerRoutes(deps.loginRunner);
  return createServer((req, res) => {
    const arrival: Record<string, number> = { t_arrived: performance.now() };
    (async () => {
      const path = (req.url || "/").split("?")[0];
      if (req.method === "GET" && path === "/health") {
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
        const releaseOp = admission.tryAcquire();
        if (!releaseOp) {
          return json(
            res,
            503,
            { error: "worker_full" },
            { "Retry-After": "1" },
          );
        }
        try {
          const body = await readJson(req, OP_BODY_MAX_BYTES);
          await executeOp(deps, req, res, body);
        } finally {
          releaseOp();
        }
        return;
      }
      let turn: TurnRequest;
      try {
        turn = parseTurnRequest(await readJson(req, 40 * 1024 * 1024, arrival));
        arrival.t_body_parsed = performance.now();
      } catch (error) {
        return json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (deps.singleUse && !turn.shadow && !turn.claim) {
        return json(res, 400, { error: "single_use_requires_claim" });
      }
      const release = admission.tryAcquire();
      if (!release) {
        return json(res, 503, { error: "worker_full" }, { "Retry-After": "1" });
      }
      const spend = Boolean(turn.claim && !turn.shadow && deps.singleUse);
      try {
        if (deps.isDraining?.()) {
          return json(
            res,
            503,
            { error: "worker_draining" },
            { "Retry-After": "1" },
          );
        }
        if (spend) await deps.singleUse?.begin();
        await executeTurn(deps, turn, req, res, {
          ...arrival,
          t0_request: performance.now(),
        });
      } finally {
        release();
        if (spend) deps.singleUse?.settled();
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[turn] unhandled:", message);
      if (!res.headersSent) json(res, 500, { error: message });
      else if (!res.writableEnded) res.end();
    });
  });
}
