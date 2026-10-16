// The share dialog's primary button through each state the person can meet:
// no LinkedIn on the deployment, connect then post, a post made, LinkedIn
// dropping the connection, and the phone's share sheet.

import { deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  linkedInConnectPollMs,
  linkedInRefusalAction,
  startLinkedInConnectWatch,
} from "@houston/sdk/linkedin/policy";
import { shareRoute } from "../src/components/organization/org-chart-share-run.ts";
import {
  INITIAL_SHARE_DIALOG,
  type ShareDialogState,
  shareDialogReducer,
} from "../src/components/organization/org-chart-share-state.ts";
import {
  type ConnectionRead,
  shareStep,
} from "../src/components/organization/org-chart-share-step.ts";

const PNG = new File(["png"], "acme-org-chart.png", { type: "image/png" });
const POST_URL = "https://www.linkedin.com/feed/update/urn:li:share:7/";
const desktop = { tauri: false, coarse: false, sheet: undefined, image: PNG };
const ready = (connected: boolean): ConnectionRead => ({
  status: "ready",
  connection: connected
    ? { connected: true, name: "Ada", expiresAt: "2026-12-01T00:00:00Z" }
    : { connected: false },
});

const step = (
  linkedin: boolean,
  state: ShareDialogState,
  connection: ConnectionRead,
  env = desktop,
) =>
  shareStep({
    route: shareRoute({ ...env, linkedin }).kind,
    connection,
    watching: state.watch !== null,
    posting: state.posting,
    postUrl: state.postUrl,
  });

const opened = shareDialogReducer(INITIAL_SHARE_DIALOG, { type: "open" });

describe("the share dialog's primary button", () => {
  it("shares by copy and paste where the deployment has no LinkedIn", () => {
    deepStrictEqual(step(false, opened, { status: "pending" }), {
      kind: "share",
      via: "paste",
    });
  });

  it("falls back to copy and paste when the connection cannot be read", () => {
    deepStrictEqual(step(true, opened, { status: "error" }), {
      kind: "share",
      via: "paste",
    });
    deepStrictEqual(step(true, opened, { status: "pending" }), {
      kind: "checking",
    });
  });

  it("connects, polls while LinkedIn's window is open, then posts", () => {
    deepStrictEqual(step(true, opened, ready(false)), {
      kind: "connect",
      waiting: false,
    });
    const watch = startLinkedInConnectWatch(0);
    const connecting = shareDialogReducer(opened, {
      type: "connecting",
      watch,
    });
    deepStrictEqual(step(true, connecting, ready(false)), {
      kind: "connect",
      waiting: true,
    });
    deepStrictEqual(
      linkedInConnectPollMs(watch, { connected: false }, 1),
      2_000,
    );
    // The poll reads connected: it stops, and the button becomes Post.
    const landed = ready(true);
    deepStrictEqual(
      linkedInConnectPollMs(
        watch,
        landed.status === "ready" ? landed.connection : undefined,
        2_000,
      ),
      false,
    );
    const ended = shareDialogReducer(connecting, { type: "watchEnded" });
    deepStrictEqual(step(true, ended, landed), {
      kind: "post",
      name: "Ada",
      posting: false,
    });
    const posting = shareDialogReducer(ended, { type: "posting" });
    deepStrictEqual(step(true, posting, landed), {
      kind: "post",
      name: "Ada",
      posting: true,
    });
  });

  it("offers View post once the post is up", () => {
    const posting = shareDialogReducer(opened, { type: "posting" });
    const posted = shareDialogReducer(posting, {
      type: "posted",
      session: posting.session,
      postUrl: POST_URL,
    });
    deepStrictEqual(step(true, posted, ready(true)), {
      kind: "posted",
      postUrl: POST_URL,
    });
  });

  it("goes back to Connect, saying so, when LinkedIn dropped the connection", () => {
    const posting = shareDialogReducer(opened, { type: "posting" });
    deepStrictEqual(
      linkedInRefusalAction("linkedin_not_connected"),
      "reconnect",
    );
    const refused = shareDialogReducer(posting, {
      type: "postRefused",
      session: posting.session,
      line: { kind: "reconnect" },
    });
    // The surface marks the cached connection disconnected.
    deepStrictEqual(step(true, refused, ready(false)), {
      kind: "connect",
      waiting: false,
    });
    deepStrictEqual(refused.line, { kind: "reconnect" });
  });

  it("keeps the share sheet on phones and iPads, LinkedIn or not", () => {
    const phone = {
      tauri: false,
      coarse: true,
      sheet: { canShare: () => true, share: async () => {} },
      image: PNG,
    };
    for (const linkedin of [true, false])
      deepStrictEqual(step(linkedin, opened, ready(true), phone), {
        kind: "share",
        via: "sheet",
      });
  });
});
