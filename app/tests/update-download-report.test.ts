import { ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { quietErrorDetails } from "../src/lib/quiet-error-class.ts";
import { UpdateDownloadError } from "../src/lib/update-download-failure.ts";

// PRODUCT-1811 (HOUSTON-APP-5EQ): a 504 from the release host was final on
// first sight and filed as a per-user bug. The shell now retries it and
// rejects with `upstream`; the report path routes that class to its own
// quiet capture, tagged with the status. Asserted against the source: the
// report module pulls error-report (i18n / analytics / the tauri barrel),
// which does not load under this suite's runner.
const source = readFileSync(
  join(import.meta.dirname, "../src/lib/update-download-report.ts"),
  "utf8",
);
const quietSource = readFileSync(
  join(import.meta.dirname, "../src/lib/quiet-error-report.ts"),
  "utf8",
);
const body = source.slice(
  source.indexOf("export function reportUpdateDownloadFailure("),
);

/** Where `reportQuietError("<kind>", command, message, error, undefined,
 *  progress)` is called, whatever the formatter did to its line breaks. */
function quietCall(kind: string): number {
  const pattern = new RegExp(
    `reportQuietError\\(\\s*"${kind}",\\s*command,\\s*message,\\s*error,\\s*undefined,\\s*progress,?\\s*\\)`,
  );
  return body.search(pattern);
}

describe("reportUpdateDownloadFailure", () => {
  it("routes an upstream failure to the release_host_unavailable class", () => {
    const upstream = body.indexOf('error.kind === "upstream"');
    const quiet = quietCall("release_host_unavailable");
    const loud = body.indexOf("reportError(command, message, error)");
    ok(upstream !== -1, "the upstream class must be branched on");
    ok(quiet !== -1, "upstream must capture quietly under its own class");
    ok(
      upstream < quiet && quiet < loud,
      "the quiet route must precede the bug route",
    );
  });

  it("keeps the network class on the offline issue", () => {
    ok(quietCall("offline") !== -1);
  });

  // A full disk is the device's state: its own quiet class, never a bug.
  it("routes a full disk to the storage_full class", () => {
    const quiet = quietCall("storage_full");
    ok(quiet !== -1);
    ok(quiet < body.indexOf("reportError(command, message, error)"));
  });

  // A remounted hook asking while the shell still downloads is nothing.
  it("reports nothing for a download already in progress", () => {
    const skip = body.indexOf('if (error.kind === "in_progress") return;');
    ok(skip !== -1);
    ok(skip < body.indexOf("reportQuietError("), "before any report");
    ok(skip < body.indexOf("reportError("));
  });

  // One person whose link drops every poll used to read as a stack of
  // unrelated failures in the offline bucket; the byte position on each
  // event shows one download inching forward.
  it("stamps the bytes on disk against the total on every quiet class", () => {
    const progress = body.indexOf("const progress = {");
    ok(progress !== -1, "the progress extras must be built");
    const fields = body.slice(progress, body.indexOf("};", progress));
    for (const field of [
      "received: error.received",
      "total: error.total",
      "attempts: error.attempts",
    ]) {
      ok(fields.includes(field), `progress must carry ${field}`);
    }
    for (const kind of [
      "offline",
      "release_host_unavailable",
      "storage_full",
    ]) {
      ok(progress < quietCall(kind), `${kind} is called after progress`);
    }
  });

  // The extras travel through reportQuietError's dedicated `extra` parameter,
  // never through `context` (which carries call-site agent keys and must not
  // reach Sentry), and the event's own fields win over them.
  it("reaches the event through the extra parameter, under the event's fields", () => {
    const signature = quietSource.slice(
      quietSource.indexOf("export function reportQuietError("),
      quietSource.indexOf("): void {"),
    );
    ok(signature.includes("extra?: Record<string, unknown>"));
    const extra = quietSource.indexOf("extra: {");
    ok(extra !== -1);
    const fields = quietSource.slice(extra, quietSource.indexOf("}", extra));
    ok(fields.includes("...extra,"), "extra must spread into the event");
    ok(!fields.includes("...context"), "context must never reach the event");
    ok(
      fields.indexOf("...extra") < fields.indexOf("command"),
      "the event's own fields are written after extra, so they win",
    );
  });
});

describe("quietErrorDetails on an UpdateDownloadError", () => {
  it("tags the quiet event with the status the release host answered", () => {
    const details = quietErrorDetails(
      new UpdateDownloadError({
        kind: "upstream",
        message: "Download request failed with status: 504 Gateway Timeout",
        received: 0,
        total: null,
        attempts: 4,
        status: 504,
      }),
    );
    strictEqual(details.status, 504);
    strictEqual(
      details.body,
      "stopped at 0/? bytes after 4 attempts: Download request failed with status: 504 Gateway Timeout",
    );
  });
});
