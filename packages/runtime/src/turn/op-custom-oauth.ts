import { customErrorAnswer } from "@houston/host/src/routes/custom-integrations-error";
import type { OpResult } from "./op-apply";
import { CUSTOM_DEFS_FILE, customIntegrationContext } from "./op-route-custom";
import type { OpRequest } from "./parse-op-request";
import { captureCustomDefinitions } from "./turn-custom-definitions-doc";
import type { TurnFilesystem } from "./turn-filesystem";

type OAuthRequest = OpRequest & {
  op: Extract<OpRequest["op"], { kind: "custom-oauth" }>;
};

export async function applyCustomOAuthOp(
  op: OAuthRequest,
  filesystem: TurnFilesystem,
  fetchImpl?: typeof fetch,
): Promise<OpResult> {
  const custom = await customIntegrationContext(
    {
      ...op,
      customOAuthCallbackUrl:
        op.op.action === "start"
          ? op.op.callbackUrl
          : op.customOAuthCallbackUrl,
    },
    filesystem,
    fetchImpl,
  );
  const result: OpResult = {
    status: 200,
    contentType: "application/json",
    body: "",
    events: [],
    include: (rel) => op.op.action === "complete" && rel === CUSTOM_DEFS_FILE,
  };
  try {
    result.body = JSON.stringify(
      op.op.action === "start"
        ? await custom.manager.prepareOAuth(op.op.slug)
        : await custom.manager.completeOAuthWith(op.op.attempt, op.op.code),
    );
    if (custom.touched.size > 0) {
      result.events.push({ type: "CustomIntegrationsChanged" });
      result.customDefinitions = await captureCustomDefinitions(
        custom.manager,
        filesystem.storeRoot,
        custom.touched,
      );
    }
  } catch (error) {
    if (custom.secretWritten) {
      result.ambiguous = true;
    } else {
      const answer = customErrorAnswer(error);
      if (!answer) throw error;
      result.status = answer.status;
      result.body = JSON.stringify(answer.body);
    }
  } finally {
    result.durableElsewhere = custom.secretWritten;
    await custom.dispose().catch(() => {
      console.error("[op] custom OAuth executor close failed");
    });
  }
  return result;
}
