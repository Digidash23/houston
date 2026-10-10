import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { runWithConversationId } from "../../conversation-context";
import type { BrowserParams } from "./actions";
import { launchBrowser } from "./launch";
import type { HandoffRegistry } from "./live/registry";
import { BrowserPool, type BrowserPoolOptions } from "./pool";
import { makeBrowserTool } from "./tool";

export const PASSWORD = "Password123";

/**
 * The fixture site's name. The fence refuses loopback by address, so the
 * fixture is reached by a name the browser alone maps to 127.0.0.1, the same
 * way a public site is reached by its DNS name.
 */
export const SITE_HOST = "site.test";
const HOST_RULES = [`MAP ${SITE_HOST} 127.0.0.1`];

const LOGIN = `<!doctype html><title>Sign in</title><form method="post" action="/login">
<label>Username <input name="username"></label>
<label>Password <input name="password" type="password"></label>
<button>Sign in</button></form>`;

/** A service on this machine the browser must never reach; it counts hits. */
export function localService(): { server: Server; hits: string[] } {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.end("houston");
  });
  return { server, hits };
}

/** A sign-in site whose pages also try to reach `local` behind the page's back. */
export function site(local: () => string): Server {
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
    if (req.url?.startsWith("/bounce")) {
      res.writeHead(302, { location: `${local()}${req.url}` });
      res.end();
      return;
    }
    // A parser-blocking script that answers long after any test is over.
    if (req.url === "/never") {
      setTimeout(() => res.end(), 60_000).unref();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/stall")
      res.end(
        `<title>Stalled</title><script src="/never"></script><h1>Body</h1>`,
      );
    else if (req.url === "/secure")
      res.end(
        signedIn
          ? "<title>Account</title><h1>Welcome back, student</h1>"
          : "<title>Account</title><h1>Please sign in</h1>",
      );
    else if (req.url === "/popup-later")
      // Opens a window on its own, the way a sign-in page opens its popup.
      res.end(`<title>Opener</title><h1>Opener</h1><button>Stay</button>
<script>setTimeout(() => window.open("/login"), 300)</script>`);
    else if (req.url === "/sneaky")
      res.end(`<title>Sneaky</title><h1>Hello</h1>
<img src="${local()}/img-direct"><img src="/bounce-img">
<script>fetch("${local()}/fetch", { mode: "no-cors", method: "POST", body: "x" })</script>`);
    else res.end(LOGIN);
  });
}

export async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

export const fixtureLaunch = () => launchBrowser(process.env, HOST_RULES);

export async function browserAvailable(): Promise<boolean> {
  try {
    await (await fixtureLaunch()).close();
    return true;
  } catch {
    // No Chromium-family browser here: the suites that need one skip.
    return false;
  }
}

export function fixturePool(options: BrowserPoolOptions = {}): BrowserPool {
  return new BrowserPool({ launch: fixtureLaunch, ...options });
}

/** The tool's execute, flattened to its text and details. */
export function tool(workspaceDir: string, pool: BrowserPool) {
  return liveTool(workspaceDir, pool);
}

/**
 * The tool with the live view on, running in conversation `chat`; `signal`
 * stands in for a stopped turn.
 */
export function handoffTool(
  workspaceDir: string,
  pool: BrowserPool,
  handoffs: HandoffRegistry,
  options: { chat?: string; limitMs?: number } = {},
) {
  const run = liveTool(workspaceDir, pool, {
    handoffs,
    ...(options.limitMs ? { handoffLimitMs: options.limitMs } : {}),
  });
  return (params: BrowserParams, signal?: AbortSignal) =>
    runWithConversationId(options.chat ?? "chat", () => run(params, signal));
}

function liveTool(
  workspaceDir: string,
  pool: BrowserPool,
  live?: { handoffs: HandoffRegistry; handoffLimitMs?: number },
) {
  const browser = makeBrowserTool({
    workspaceDir,
    pool,
    liveView: live !== undefined,
    ...live,
  });
  return async (params: BrowserParams, signal?: AbortSignal) => {
    // SAFETY: the browser tool never reads its ExtensionContext.
    const result = await browser.execute(
      "t",
      params,
      signal,
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

export function ref(snapshot: string, role: string, name: string): string {
  const match = new RegExp(`${role} "${name}"[^\\n]*\\[ref=(\\w+)\\]`).exec(
    snapshot,
  );
  if (!match?.[1]) throw new Error(`no ${role} "${name}" in:\n${snapshot}`);
  return match[1];
}
