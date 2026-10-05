import { expect, test, vi } from "vitest";
import { startClaimHeartbeat } from "./claim-heartbeat";

const claim = {
  id: "claim-1",
  bootId: "boot-1",
  token: "claim-token",
  heartbeatUrl: "https://gateway.test/heartbeat",
};

test("heartbeat posts the claim grant with the host token and stops", async () => {
  const calls: Array<{ body: unknown; headers: Headers }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    calls.push({
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    });
    return new Response(null, { status: 204 });
  });
  const heartbeat = startClaimHeartbeat({
    claim,
    hostToken: "host-token",
    fetchImpl,
    intervalMs: 5,
  });
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
  await heartbeat.stop();
  const stoppedAt = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 15));

  expect(calls).toContainEqual({
    body: { id: "claim-1", token: "claim-token", bootId: "boot-1" },
    headers: expect.any(Headers),
  });
  expect(calls[0]?.headers.get("authorization")).toBe("Bearer host-token");
  expect(calls.length).toBe(stoppedAt);
  expect(heartbeat.fenced).toBe(false);
});

test("a 409 fences the claim and fires onFenced once", async () => {
  let status = 204;
  const onFenced = vi.fn();
  const heartbeat = startClaimHeartbeat({
    claim,
    hostToken: "host-token",
    fetchImpl: async () =>
      new Response(status === 204 ? null : "heartbeat", { status }),
    intervalMs: 60_000,
    onFenced,
  });
  await heartbeat.ready;
  expect(heartbeat.fenced).toBe(false);
  expect(onFenced).not.toHaveBeenCalled();
  status = 409;
  await heartbeat.checkpoint();
  expect(heartbeat.fenced).toBe(true);
  expect(onFenced).toHaveBeenCalledOnce();
  // Fenced is terminal: later checkpoints do not beat again.
  await heartbeat.checkpoint();
  expect(onFenced).toHaveBeenCalledOnce();
  await heartbeat.stop();
});

test("claim mode changes update the same live ref and ignore unknown or fenced responses", async () => {
  const { runWithTurnMode, currentTurnMode } = await import(
    "../session/turn-mode-context"
  );
  const mode = { current: "execute" as "execute" | "plan" | "auto" };
  let response = Response.json({ ok: true, mode: "plan" });
  const heartbeat = startClaimHeartbeat({
    claim,
    hostToken: "host-token",
    intervalMs: 60_000,
    fetchImpl: async () => response.clone(),
    onMode: (next) => {
      mode.current = next;
    },
  });
  await runWithTurnMode(mode, async () => {
    await heartbeat.ready;
    expect(currentTurnMode()).toBe("plan");
    response = Response.json({ ok: true, mode: "auto" });
    await heartbeat.checkpoint();
    expect(currentTurnMode()).toBe("auto");
    response = Response.json({ ok: true, mode: "unknown" });
    await heartbeat.checkpoint();
    expect(currentTurnMode()).toBe("auto");
    response = new Response(null, { status: 204 });
    await heartbeat.checkpoint();
    expect(currentTurnMode()).toBe("auto");
    response = Response.json({ mode: "execute" }, { status: 409 });
    await heartbeat.checkpoint();
    expect(currentTurnMode()).toBe("auto");
  });
  await heartbeat.stop();
});
