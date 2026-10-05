import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { LocalDirStore } from "@houston/runtime-client/object-sync";
import { expect, test, vi } from "vitest";
import { AdmissionLimiter } from "./admission";
import { serveOp, serveTurn } from "./server-work";

function response() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}
const deps = () => ({
  store: new LocalDirStore("/tmp/work-admission-fixture"),
  token: "",
});

test("the extracted op handler refuses capacity before touching an upload", async () => {
  const admission = new AdmissionLimiter(1);
  const release = admission.tryAcquire();
  const read = vi.fn(() => {
    throw new Error("refused upload must not be read");
  });
  const req = { [Symbol.asyncIterator]: read } as unknown as IncomingMessage;
  const res = response();
  await serveOp(deps(), admission, req, res as unknown as ServerResponse);
  expect(read).not.toHaveBeenCalled();
  expect(res.writeHead).toHaveBeenCalledWith(
    503,
    expect.objectContaining({ "Retry-After": "1" }),
  );
  expect(res.end).toHaveBeenCalledWith(
    JSON.stringify({ error: "worker_full" }),
  );
  expect(admission.active).toBe(1);
  release?.();
});

test("a turn whose body outlives the draining gate is refused after taking its slot", async () => {
  const admission = new AdmissionLimiter(1);
  const res = response();
  const begin = vi.fn(async () => {});
  const settled = vi.fn();
  const req = Readable.from([
    Buffer.from(
      JSON.stringify({
        workspaceId: "workspace-fixture",
        agentId: "agent-fixture",
        conversationId: "conversation-fixture",
        text: "fixture",
        gcsPrefix: "ws/workspace-fixture/agent-fixture",
        hostToken: "host-fixture",
        claim: {
          id: "claim-fixture",
          bootId: "boot-fixture",
          token: "claim-token",
          heartbeatUrl: "https://heartbeat.example",
        },
      }),
    ),
  ]) as unknown as IncomingMessage;
  req.headers = {};
  await serveTurn(
    { ...deps(), isDraining: () => true, singleUse: { begin, settled } },
    admission,
    req,
    res as unknown as ServerResponse,
    {},
  );
  expect(begin).not.toHaveBeenCalled();
  expect(res.end).toHaveBeenCalledWith(
    JSON.stringify({ error: "worker_draining" }),
  );
  expect(admission.active).toBe(0);
  expect(settled).toHaveBeenCalledOnce();
});
