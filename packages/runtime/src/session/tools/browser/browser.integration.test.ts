import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, test } from "vitest";
import type { BrowserParams } from "./actions";
import { launchBrowser } from "./launch";
import { BrowserPool } from "./pool";
import { makeBrowserTool } from "./tool";

const PASSWORD = "Password123";

const LOGIN = `<!doctype html><title>Sign in</title><form method="post" action="/login">
<label>Username <input name="username"></label>
<label>Password <input name="password" type="password"></label>
<button>Sign in</button></form>`;

function site(blockedOrigin = ""): Server {
  return createServer((req, res) => {
    const signedIn = /(?:^|; )sid=ok/.test(req.headers.cookie ?? "");
    if (req.url === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const ok =
          form.get("username") === "student" &&
          form.get("password") === PASSWORD;
        res.writeHead(302, {
          location: ok ? "/secure" : "/login",
          ...(ok
            ? { "set-cookie": "sid=ok; HttpOnly; Path=/; Max-Age=3600" }
            : {}),
        });
        res.end();
      });
      return;
    }
    if (req.url === "/bounce") {
      res.writeHead(302, { location: `${blockedOrigin}/` });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/secure")
      res.end(
        signedIn
          ? "<title>Account</title><h1>Welcome back, student</h1>"
          : "<title>Account</title><h1>Please sign in</h1>",
      );
    else res.end(LOGIN);
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function browserAvailable(): Promise<boolean> {
  try {
    await (await launchBrowser()).close();
    return true;
  } catch {
    return false;
  }
}

const available = await browserAvailable();
const blocked = createServer((_req, res) => res.end("houston"));
const blockedOrigin = available ? await listen(blocked) : "";
const server = site(blockedOrigin);
const origin = available ? await listen(server) : "";

const pools: BrowserPool[] = [];
const newPool = () => {
  const pool = new BrowserPool();
  pools.push(pool);
  return pool;
};

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.shutdown()));
  server.close();
  blocked.close();
});

function tool(workspaceDir: string, pool: BrowserPool) {
  const browser = makeBrowserTool({
    workspaceDir,
    blockedOrigins: [blockedOrigin],
    pool,
  });
  return async (params: BrowserParams) => {
    // SAFETY: the browser tool never reads its ExtensionContext.
    const result = await browser.execute(
      "t",
      params,
      undefined,
      undefined,
      {} as ExtensionToolContext,
    );
    return {
      text: result.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n"),
      details: result.details,
    };
  };
}

function ref(snapshot: string, role: string, name: string): string {
  const match = new RegExp(`${role} "${name}"[^\\n]*\\[ref=(\\w+)\\]`).exec(
    snapshot,
  );
  if (!match?.[1]) throw new Error(`no ${role} "${name}" in:\n${snapshot}`);
  return match[1];
}

describe.skipIf(!available)(
  "browser tool against a real Chromium (skips when no Chromium-family browser is installed)",
  () => {
    test("a sign-in survives closing the browser and a fresh process", async () => {
      const workspace = mkdtempSync(join(tmpdir(), "browser-it-"));
      const first = newPool();
      const run = tool(workspace, first);
      const login = await run({ action: "open", url: `${origin}/login` });
      expect(login.details.ok).toBe(true);
      await run({
        action: "fill",
        ref: ref(login.text, "textbox", "Username"),
        text: "student",
      });
      const filled = await run({
        action: "fill",
        ref: ref(login.text, "textbox", "Password"),
        text: PASSWORD,
      });
      // The password never comes back to the model, neither echoed nor in the tree.
      expect(filled.text).toContain("Filled the password field");
      expect(filled.text).not.toContain(PASSWORD);
      const after = await run({
        action: "click",
        ref: ref(filled.text, "button", "Sign in"),
      });
      expect(after.text).toContain("Welcome back, student");
      expect((await run({ action: "close" })).details.ok).toBe(true);
      await first.shutdown();

      const second = tool(workspace, newPool());
      const secure = await second({ action: "open", url: `${origin}/secure` });
      expect(secure.text).toContain("Welcome back, student");

      // Another agent's workspace has its own sign-ins, not this one's.
      const stranger = tool(
        mkdtempSync(join(tmpdir(), "browser-it-")),
        newPool(),
      );
      expect(
        (await stranger({ action: "open", url: `${origin}/secure` })).text,
      ).toContain("Please sign in");
    });

    test("a redirect onto a refused origin is stopped", async () => {
      const run = tool(mkdtempSync(join(tmpdir(), "browser-it-")), newPool());
      const bounced = await run({ action: "open", url: `${origin}/bounce` });
      expect(bounced.details).toMatchObject({
        ok: false,
        error: { code: "url_refused" },
      });
      const direct = await run({ action: "open", url: `${blockedOrigin}/` });
      expect(direct.details).toMatchObject({
        ok: false,
        error: { code: "url_refused" },
      });
    });

    test("a stale ref is a page error the model can recover from", async () => {
      const run = tool(mkdtempSync(join(tmpdir(), "browser-it-")), newPool());
      await run({ action: "open", url: `${origin}/login` });
      const stale = await run({ action: "click", ref: "e999" });
      expect(stale.details).toMatchObject({
        ok: false,
        error: { code: "page_error" },
      });
    });
  },
);
