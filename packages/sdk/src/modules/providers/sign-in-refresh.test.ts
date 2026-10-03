import { expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import { providersScope } from "./index";
import type { ProvidersViewModel } from "./types";

const AGENT = "ag_1";
const OLD_DEADLINE = 1_790_000_000_000;
const NEW_DEADLINE = OLD_DEADLINE + 27 * 24 * 60 * 60 * 1000;

/**
 * A finished sign-in starts a new login with a new `reconnectBy`, which rides
 * the provider list. The login poll reads only `/auth/status`, so the SDK
 * re-reads the list the moment the poll sees the sign-in finish; otherwise the
 * snapshot keeps warning about the login that was just replaced.
 */
it("the login poll re-reads the provider list once a sign-in finishes, until a read succeeds", async () => {
  let signedIn = false;
  let listFails = 0;
  const paths: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("/auth/status"))
      return json({
        activeProvider: "anthropic",
        providers: [
          {
            provider: "anthropic",
            name: "Claude",
            configured: true,
            login: signedIn ? { status: "complete" } : null,
          },
        ],
      });
    if (listFails > 0) {
      listFails--;
      return new Response("upstream down", { status: 502 });
    }
    return json([
      {
        id: "anthropic",
        name: "Claude",
        configured: true,
        isActive: true,
        activeModel: "",
        models: [],
        reconnectBy: signedIn ? NEW_DEADLINE : OLD_DEADLINE,
      },
    ]);
  });
  const ports: SdkPorts = {
    fetch: fetchImpl as unknown as typeof fetch,
    storage: memoryKv(new Map()),
    devicePreferences: memoryKv(),
    clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const config: SdkConfig = {
    baseUrl: "http://127.0.0.1:4317",
    ports,
    reactivity: false,
  };
  const sdk = new HoustonSdk(config);
  const deadline = () =>
    (sdk.getSnapshot(providersScope(AGENT)) as ProvidersViewModel).providers[0]
      .reconnectBy;

  await sdk.providers.refresh(AGENT);
  expect(deadline()).toBe(OLD_DEADLINE);

  // An ordinary poll keeps the deadline and reads no list.
  paths.length = 0;
  await sdk.providers.refreshStatus(AGENT);
  expect(paths.every((p) => p.endsWith("/auth/status"))).toBe(true);
  expect(deadline()).toBe(OLD_DEADLINE);

  // The sign-in finishes while the list read fails: the poll still resolves
  // with the sign-in status, and the list stays owed.
  signedIn = true;
  listFails = 1;
  await sdk.providers.refreshStatus(AGENT);
  expect(paths.some((p) => p.endsWith("/providers"))).toBe(true);
  expect(deadline()).toBe(OLD_DEADLINE);
  expect(ports.logger.warn).toHaveBeenCalled();

  // The next poll pays the debt, and the one after it reads no list.
  await sdk.providers.refreshStatus(AGENT);
  expect(deadline()).toBe(NEW_DEADLINE);
  paths.length = 0;
  await sdk.providers.refreshStatus(AGENT);
  expect(paths.every((p) => p.endsWith("/auth/status"))).toBe(true);
  sdk.dispose();
});
