import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";
import { createWriteLeaseProbe } from "./write-lease-probe";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function podStore(status: () => number) {
  const seen: Array<{
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
  }> = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(status());
    res.end(status() === 409 ? '{"error":"fencing token stale"}' : undefined);
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1/pod/store/acme/agent/`,
    seen,
  };
}

test("asks with exactly the headers a write would carry", async () => {
  const store = await podStore(() => 204);
  const fence: { token?: string } = { token: "7" };
  const probe = createWriteLeaseProbe({
    baseUrl: store.baseUrl,
    token: "pod-token",
    bootId: "boot-a",
    fence,
  });

  expect(await probe()).toBe("held");
  expect(store.seen[0]).toMatchObject({
    method: "GET",
    url: "/v1/pod/store/acme/agent/lease",
    headers: {
      authorization: "Bearer pod-token",
      "x-houston-fencing-token": "7",
      "x-houston-boot-id": "boot-a",
    },
  });
  // The token is read per ask: a capture after boot is what the next write
  // would present, so it is what the check presents.
  fence.token = "8";
  await probe();
  expect(store.seen[1]?.headers["x-houston-fencing-token"]).toBe("8");
});

test("a boot that never claimed a lease asks without fencing headers", async () => {
  const store = await podStore(() => 204);
  await createWriteLeaseProbe({
    baseUrl: store.baseUrl,
    token: "pod-token",
    bootId: "boot-a",
    fence: {},
  })();
  expect(store.seen[0]?.headers["x-houston-fencing-token"]).toBeUndefined();
  expect(store.seen[0]?.headers["x-houston-boot-id"]).toBeUndefined();
});

test("maps the pod-store's answers to verdicts", async () => {
  let status = 409;
  const store = await podStore(() => status);
  const probe = createWriteLeaseProbe({
    baseUrl: store.baseUrl,
    token: "pod-token",
    bootId: "boot-a",
    fence: { token: "1" },
  });

  expect(await probe()).toBe("fenced");
  // A pod-store from before the check route: the POST-only mint path (405)
  // or no route at all (404).
  status = 405;
  expect(await probe()).toBe("unsupported");
  status = 404;
  expect(await probe()).toBe("unsupported");
  status = 503;
  await expect(probe()).rejects.toThrow("write lease check failed (503)");
});
