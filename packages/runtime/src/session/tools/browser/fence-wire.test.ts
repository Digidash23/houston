import { expect, test } from "vitest";
import { headEnd, parseProxyRequest, proxyAnswer } from "./fence-wire";

const head = (...lines: string[]) =>
  Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1");

test("an absolute-form request is re-written to origin form, proxy headers off", () => {
  const request = parseProxyRequest(
    head(
      "POST http://Example.com:8080/a/b?q=1&r=2 HTTP/1.1",
      "Host: example.com:8080",
      "Proxy-Connection: keep-alive",
      "Proxy-Authorization: Basic eA==",
      "Connection: keep-alive",
      "Keep-Alive: timeout=5",
      "Content-Length: 3",
    ),
  );
  expect(request.kind).toBe("forward");
  if (request.kind !== "forward") return;
  expect(request).toMatchObject({ host: "example.com", port: 8080 });
  expect(request.head.toString("latin1")).toBe(
    "POST /a/b?q=1&r=2 HTTP/1.1\r\nHost: example.com:8080\r\nContent-Length: 3\r\nConnection: close\r\n\r\n",
  );
});

test("plain http defaults to port 80, an IPv6 literal keeps its brackets", () => {
  expect(
    parseProxyRequest(
      head("GET http://example.com/ HTTP/1.1", "Host: example.com"),
    ),
  ).toMatchObject({
    host: "example.com",
    port: 80,
  });
  expect(
    parseProxyRequest(head("GET http://[::1]:81/ HTTP/1.1")),
  ).toMatchObject({
    host: "[::1]",
    port: 81,
  });
});

test("CONNECT names a tunnel", () => {
  expect(
    parseProxyRequest(
      head("CONNECT example.com:443 HTTP/1.1", "Host: example.com:443"),
    ),
  ).toEqual({
    kind: "connect",
    host: "example.com",
    port: 443,
  });
});

test("any token method is forwarded with its case kept", () => {
  for (const method of ["patch", "VERSION-CONTROL", "M-SEARCH", "PROPFIND"]) {
    const request = parseProxyRequest(
      head(`${method} http://example.com/x HTTP/1.1`),
    );
    expect(request.kind, method).toBe("forward");
    if (request.kind !== "forward") continue;
    expect(request.head.toString("latin1")).toMatch(
      new RegExp(`^${method} /x HTTP/1.1\r\n`),
    );
  }
  for (const line of [
    "GE(T http://example.com/ HTTP/1.1",
    "GET\thttp://example.com/ HTTP/1.1",
    " GET http://example.com/ HTTP/1.1",
  ])
    expect(parseProxyRequest(head(line)).kind, line).toBe("malformed");
});

test("anything else is malformed: origin-form, other schemes, junk", () => {
  for (const line of [
    "GET / HTTP/1.1",
    "GET https://example.com/ HTTP/1.1",
    "GET ftp://example.com/ HTTP/1.1",
    "CONNECT example.com HTTP/1.1",
    "hello",
    "GET http://example.com/ HTTP/2",
  ])
    expect(parseProxyRequest(head(line)).kind, line).toBe("malformed");
});

test("a head ends after its blank line", () => {
  expect(headEnd(Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n"))).toBe(-1);
  expect(headEnd(Buffer.from("GET / HTTP/1.1\r\n\r\nbody"))).toBe(18);
});

test("the proxy's own answers carry the fence header and close", () => {
  const refused = proxyAnswer("refused");
  expect(refused).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
  expect(refused).toContain("x-houston-fence: refused\r\n");
  expect(refused).toContain("Connection: close\r\n");
  expect(proxyAnswer("unreachable")).toMatch(/^HTTP\/1\.1 502 /);
});

test("the origin's Host comes from the request target, never the browser's field", () => {
  const request = parseProxyRequest(
    head(
      "GET http://Site.test:8080/p HTTP/1.1",
      "Host: other.test",
      "host: third.test",
      "Accept: */*",
    ),
  );
  expect(request.kind).toBe("forward");
  if (request.kind !== "forward") return;
  expect(request.head.toString("latin1")).toBe(
    "GET /p HTTP/1.1\r\nHost: site.test:8080\r\nAccept: */*\r\nConnection: close\r\n\r\n",
  );
  const bare = parseProxyRequest(head("GET http://site.test/ HTTP/1.1"));
  expect(bare.kind === "forward" && bare.head.toString("latin1")).toContain(
    "\r\nHost: site.test\r\n",
  );
});

test("a folded, smuggled or nameless field line is malformed", () => {
  for (const field of [
    " continued: obs-fold",
    "\tTab: folded",
    "X-A: one\nTransfer-Encoding: chunked",
    "X-B: bare\rcarriage",
    "Content-Length : 5",
    "no colon here",
    ": empty name",
  ])
    expect(
      parseProxyRequest(head("GET http://site.test/ HTTP/1.1", field)).kind,
      JSON.stringify(field),
    ).toBe("malformed");
});
