import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LocalDirStore,
  type ObjectStore,
  StoreConflictError,
  type WriteOptions,
} from "@houston/runtime-client/object-sync";
import type { SeedOp } from "./op-grammar-seed";
import type { OpRequest } from "./parse-op-request";

/** Seed-op test doubles: a generation-aware store and the pod-store docs. */

export const PREFIX = "ws/acme/ledger";

export interface Upload {
  key: string;
  ifGenerationMatch?: string;
}

/**
 * LocalDirStore with the CAS a pool store enforces: a create-only upload
 * (`ifGenerationMatch: "0"`) over an existing object is a 412. `beforeUpload`
 * lets a test land a racing writer's object first.
 */
export function generationStore() {
  const root = mkdtempSync(join(tmpdir(), "op-seed-store-"));
  const inner = new LocalDirStore(root);
  const uploads: Upload[] = [];
  const deletes: string[] = [];
  const hooks: { beforeUpload?: (key: string) => void } = {};
  const store: ObjectStore = {
    list: (p) => inner.list(p),
    manifest: async (p) =>
      (await inner.manifest(p)).map((o) => ({ ...o, generation: "1" })),
    download: (key, dest) => inner.download(key, dest),
    upload: async (src, key, opts?: WriteOptions) => {
      hooks.beforeUpload?.(key);
      if (opts?.ifGenerationMatch === "0" && existsSync(join(root, key)))
        throw new StoreConflictError(key, `412 on ${key}`);
      uploads.push({ key, ifGenerationMatch: opts?.ifGenerationMatch });
      await inner.upload(src, key);
      return { generation: "2" };
    },
    delete: async (key, opts) => {
      deletes.push(key);
      await inner.delete(key, opts);
    },
  };
  /** Put an object in the store as some earlier writer left it. */
  const put = (rel: string, content: string) => {
    const file = join(root, PREFIX, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const keys = async () =>
    (await inner.list(PREFIX)).map((k) => k.slice(PREFIX.length + 1));
  const read = (rel: string) =>
    readFileSync(join(root, PREFIX, ...rel.split("/")), "utf8");
  return { store, uploads, deletes, hooks, put, keys, read };
}

export interface DocPut {
  family: string;
  doc: unknown;
  headers: Headers;
}

/** The pod-store doc route: every GET is a 404, every PUT answers `status`. */
export function docRoute(status = 200) {
  const puts: DocPut[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === "GET")
      return Response.json({ error: "document not found" }, { status: 404 });
    puts.push({
      family: String(url).split("/").pop() ?? "",
      doc: (JSON.parse(String(init.body)) as { doc: unknown }).doc,
      headers: new Headers(init.headers),
    });
    return Response.json({ revision: 1 }, { status });
  }) as typeof fetch;
  return {
    puts,
    deps: {
      poolStoreUrl: "https://store.example",
      fetchImpl,
      activityDocRetryDelaysMs: [],
    },
  };
}

export function seedRequest(
  op: Omit<SeedOp, "kind">,
  actingAs?: OpRequest["actingAs"],
): OpRequest & { op: SeedOp } {
  return {
    workspaceId: "acme",
    agentId: "ledger",
    gcsPrefix: PREFIX,
    hostToken: "host-token",
    claim: {
      id: "claim-1",
      bootId: "boot-1",
      token: "claim-token",
      heartbeatUrl: "https://x/hb",
    },
    ...(actingAs ? { actingAs } : {}),
    credential: null,
    triggersEnabled: false,
    op: { kind: "seed", ...op },
  };
}
