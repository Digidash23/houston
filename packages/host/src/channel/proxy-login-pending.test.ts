import { afterEach, expect, test, vi } from "vitest";
import { MemoryCredentialStore } from "../credentials/store";
import type { Agent, Workspace } from "../domain/types";
import { ProxyChannel } from "./proxy";

const ws: Workspace = {
  id: "w1",
  ownerUserId: "alice",
  kind: "personal",
  name: "Personal",
  slug: "alice",
  runtime: "gke",
  createdAt: 1,
};
const agent: Agent = {
  id: "agent-1",
  workspaceId: "w1",
  name: "Sales",
  createdAt: 1,
};
const ctx = { workspace: ws, agent };

afterEach(() => {
  vi.restoreAllMocks();
});

function channelWith(status: "running" | "asleep"): ProxyChannel {
  return new ProxyChannel({
    launcher: {
      async ensureAwake() {
        if (status !== "running")
          throw new Error(
            "must not wake an asleep runtime for a sign-in check",
          );
        return { baseUrl: "http://runtime.local", token: "sbx-token" };
      },
      async sleep() {},
      async destroy() {},
      async status() {
        return status;
      },
    },
    proxy: { async forward() {} },
    credentials: new MemoryCredentialStore(),
    forwardActingHeader: false,
  });
}

test("loginPending answers false for an asleep runtime without waking it", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  await expect(channelWith("asleep").loginPending(ctx)).resolves.toBe(false);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("loginPending reads a running runtime's /busy answer", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ busy: false, loginPending: true }));
  await expect(channelWith("running").loginPending(ctx)).resolves.toBe(true);
  expect(fetchSpy).toHaveBeenCalledWith("http://runtime.local/busy", {
    headers: { Authorization: "Bearer sbx-token" },
  });
});

test("a runtime that predates the field reports no sign-in", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ busy: false }),
  );
  await expect(channelWith("running").loginPending(ctx)).resolves.toBe(false);
});

test("an unreachable running runtime counts as a pending sign-in", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unreachable"));
  await expect(channelWith("running").loginPending(ctx)).resolves.toBe(true);
});
