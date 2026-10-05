import { join } from "node:path";
import { ACTING_VIA_ASSISTANT } from "@houston/host/src/auth/acting";
import { dispatchAgentOp } from "@houston/host/src/op/dispatch";
import { PrefixedVfs } from "@houston/host/src/vfs";
import type { HoustonEvent } from "@houston/protocol";
import type { OpResult } from "./op-apply";
import { isCustomIntegrationOpRoute } from "./op-route-allowlist";
import {
  CUSTOM_DEFS_FILE,
  type CustomContext,
  customIntegrationContext,
} from "./op-route-custom";
import { agentRouteScope, engineAgentId, importScope } from "./op-scope";
import type { OpRequest } from "./parse-op-request";
import { captureCustomDefinitions } from "./turn-custom-definitions-doc";
import type { TurnFilesystem } from "./turn-filesystem";

type RouteOp = OpRequest & { op: Extract<OpRequest["op"], { kind: "route" }> };

const decline = (include: OpResult["include"]): OpResult => ({
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({ error: "the pod serves this one" }),
  events: [],
  include,
  decline: true,
});

/** What a route op may write: the agent's tree, and for a migration import
 *  also the runtime transcripts and sessions it unpacks. */
function routeScope(filesystem: TurnFilesystem, decoded: string) {
  return decoded === "migration/import"
    ? importScope(filesystem.workspaceRel, filesystem.dataRel)
    : agentRouteScope(filesystem.workspaceRel);
}

/** The old gateway cannot own a worker's pending OAuth attempt. */
function oauthAddBody(body: string | undefined): boolean {
  try {
    return JSON.parse(body ?? "{}").auth === "oauth";
  } catch {
    return false; // the handler owns the 400 for a malformed body
  }
}

/**
 * A `route` op: the pod's own handler chain over the hydrated tree. Custom
 * integrations additionally get a per-op manager (definitions at the store
 * root, secrets in the gateway's custom-secret store, a fresh in-memory
 * executor), with OAuth options when the gateway owns pending attempts.
 */
export async function applyRouteOp(
  op: RouteOp,
  filesystem: TurnFilesystem,
  fetchImpl?: typeof fetch,
): Promise<OpResult> {
  const { method, rest } = op.op;
  // parseOpRequest already proved the rest decodes (and validated the
  // decoded form against the allowlist).
  const decoded = decodeURIComponent(rest);
  const include = routeScope(filesystem, decoded);
  // Older gateways cannot receive a worker-owned sign-in.
  if (
    decoded === "integrations/custom/definitions" &&
    method === "POST" &&
    oauthAddBody(op.op.body) &&
    !op.customOAuthCallbackUrl
  ) {
    return decline(include);
  }

  const custom = isCustomIntegrationOpRoute(decoded)
    ? await customIntegrationContext(op, filesystem, fetchImpl)
    : null;
  try {
    return await runRouteOp(op, filesystem, decoded, custom);
  } finally {
    // The per-op executor holds live MCP connections — a long-lived worker
    // must not accumulate them. A close failure is diagnostics only: it must
    // never turn an already-successful op into a 500 (the answer and its
    // sync-back would be lost while the secret store already committed).
    await custom?.dispose().catch((error: unknown) => {
      console.error("[op] custom-integration executor close failed:", error);
    });
  }
}

async function runRouteOp(
  op: RouteOp,
  filesystem: TurnFilesystem,
  decoded: string,
  custom: CustomContext | null,
): Promise<OpResult> {
  const agentId = engineAgentId(filesystem);
  const include = routeScope(filesystem, decoded);
  // The handlers address the agent under `workspaces/`; the turn's vfs
  // is rooted one level up (lazy or real, the same seam).
  const vfs = new PrefixedVfs(filesystem.vfs, "workspaces");
  const dispatch = (
    request: Parameters<typeof dispatchAgentOp>[0]["request"],
  ) =>
    dispatchAgentOp({
      workspacesRoot: join(filesystem.storeRoot, "workspaces"),
      agentId,
      vfs,
      request,
      ...(op.agentName ? { agentName: op.agentName } : {}),
      // A migration import synthesizes each transcript's pi session against
      // the on-disk agent dir, the same artifacts the pod writes.
      ...(decoded === "migration/import"
        ? { agentDir: filesystem.workspaceDir }
        : {}),
      ...(custom ? { customIntegrations: custom.manager } : {}),
    });
  const result = await dispatch({
    method: op.op.method,
    rest: op.op.rest,
    ...(op.op.query ? { query: op.op.query } : {}),
    ...(op.op.body !== undefined ? { body: op.op.body } : {}),
    ...(op.op.bodyBase64 !== undefined ? { bodyBase64: op.op.bodyBase64 } : {}),
    ...(op.op.contentType ? { contentType: op.op.contentType } : {}),
    ...(op.actingAs
      ? {
          actingSub: op.actingAs.userId,
          // Gateway-fronted: the acting human is a full contributor on
          // missions, exactly as the pod stamps it from the acting header.
          actingAuthor: {
            user_id: op.actingAs.userId,
            ...(op.actingAs.name ? { name: op.actingAs.name } : {}),
          },
          // The AI Manager's asleep-agent write: the same stamp an awake pod
          // derives from the acting token's `via` claim.
          ...(op.actingAs.via === ACTING_VIA_ASSISTANT
            ? { startedBy: "houston" as const }
            : {}),
        }
      : {}),
    triggersEnabled: op.triggersEnabled,
  });

  if (
    custom &&
    !op.customOAuthCallbackUrl &&
    decoded === "integrations/custom/detect"
  ) {
    try {
      if (JSON.parse(result.body).requiresOAuth === true)
        return decline(include);
    } catch {
      /* non-JSON answers relay as-is */
    }
  }

  const events: HoustonEvent[] = [...result.events];
  const out: OpResult = {
    ...result,
    events,
    include: custom
      ? (rel) => include(rel) || rel === CUSTOM_DEFS_FILE
      : include,
  };
  if (custom && custom.touched.size > 0) {
    events.push({ type: "CustomIntegrationsChanged" });
    // Re-capture the definitions view the way the pod's route serves it, so
    // the gateway's asleep reads show the mutation immediately.
    out.customDefinitions = await captureCustomDefinitions(
      custom.manager,
      filesystem.storeRoot,
      custom.touched,
    );
  }
  if (result.events.some((e) => e.type === "SkillsChanged")) {
    // Re-capture the skills view the way the pod would serve it, so the
    // gateway's asleep reads show the install/remove immediately.
    const view = await dispatch({
      method: "GET",
      rest: "skills",
      triggersEnabled: op.triggersEnabled,
    });
    if (view.status === 200) {
      try {
        out.skillsView = JSON.parse(view.body);
      } catch {
        /* not JSON: leave the previous view */
      }
    }
  }
  return out;
}
