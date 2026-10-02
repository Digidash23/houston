import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalDirStore } from "@houston/runtime-client/object-sync";

/**
 * The gateway's pod-store as a `fetchImpl`: the object routes a claimed
 * worker reads and writes (`/v1/pod/store/<org>/<agent>/...`, create-only
 * CAS included), the doc route, the transcript routes and the claim
 * heartbeat. Every store write and transcript call is recorded with the
 * claim it carried.
 */

export const POOL_STORE_URL = "https://store.example";
export const HEARTBEAT_URL = `${POOL_STORE_URL}/hb`;

export interface StoreWrite {
  method: string;
  key: string;
  claim: string | null;
  ifGenerationMatch: string | null;
}

export interface TranscriptCall {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

export function fakePoolStore(prefix: string, transcriptStatus = 200) {
  const root = mkdtempSync(join(tmpdir(), "pool-store-"));
  const fileOf = (key: string) => join(root, prefix, ...key.split("/"));
  const writes: StoreWrite[] = [];
  const transcripts: TranscriptCall[] = [];
  const meta = (key: string) => {
    const bytes = readFileSync(fileOf(key));
    return {
      key,
      size: bytes.length,
      md5: createHash("md5").update(bytes).digest("base64"),
      updated: statSync(fileOf(key)).mtime.toISOString(),
      gen: "1",
    };
  };
  const storeRoute = async (
    method: string,
    rest: string,
    init?: RequestInit,
  ) => {
    const headers = new Headers(init?.headers);
    if (rest === "manifest") {
      const keys = (await new LocalDirStore(root).list(prefix)).map((k) =>
        k.slice(prefix.length + 1),
      );
      return Response.json({ objects: keys.map(meta) });
    }
    if (!rest.startsWith("objects/")) return new Response("", { status: 404 });
    const key = rest
      .slice("objects/".length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    if (method === "GET") {
      if (!existsSync(fileOf(key))) return new Response("", { status: 404 });
      return new Response(readFileSync(fileOf(key)), {
        headers: { "X-Houston-Generation": "1" },
      });
    }
    const write = {
      method,
      key,
      claim: headers.get("X-Houston-Claim-Conversation"),
      ifGenerationMatch: headers.get("X-Houston-If-Generation-Match"),
    };
    if (method === "DELETE") {
      writes.push(write);
      rmSync(fileOf(key), { force: true });
      return new Response(null, { status: 204 });
    }
    if (write.ifGenerationMatch === "0" && existsSync(fileOf(key)))
      return new Response("exists", { status: 412 });
    writes.push(write);
    mkdirSync(dirname(fileOf(key)), { recursive: true });
    writeFileSync(
      fileOf(key),
      Buffer.from(await new Response(init?.body).arrayBuffer()),
    );
    return Response.json({ ...meta(key), gen: "2" });
  };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/hb") return Response.json({});
    const store = /^\/v1\/pod\/store\/[^/]+\/[^/]+\/(.+)$/.exec(url.pathname);
    if (store?.[1]) return storeRoute(method, store[1], init);
    if (url.pathname.startsWith("/v1/pod/docs/"))
      return method === "GET"
        ? Response.json({ error: "document not found" }, { status: 404 })
        : Response.json({ revision: 1 });
    if (url.pathname.startsWith("/v1/pod/transcripts/")) {
      transcripts.push({
        method,
        path: url.pathname,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return Response.json({ revision: 1 }, { status: transcriptStatus });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const put = (rel: string, content: string) => {
    mkdirSync(dirname(fileOf(rel)), { recursive: true });
    writeFileSync(fileOf(rel), content);
  };
  const keys = async () =>
    (await new LocalDirStore(root).list(prefix)).map((k) =>
      k.slice(prefix.length + 1),
    );
  const read = (rel: string) => readFileSync(fileOf(rel), "utf8");
  return { root, fetchImpl, writes, transcripts, put, keys, read };
}
