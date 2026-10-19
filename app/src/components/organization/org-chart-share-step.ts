import type { LinkedInConnection } from "@houston/wire-types";
import type { ShareRoute } from "./org-chart-share-run.ts";

/**
 * The dialog's one primary button, from where it stands. Pure and DOM-free.
 *
 * - `share`: Share on LinkedIn, `via` the share sheet or copy and paste.
 *   Copy and paste also stands in on the `post` route when the connection
 *   could not be read: the person still gets to LinkedIn.
 * - `checking`: the connection is being read.
 * - `connect`: Connect LinkedIn. `phase` is `idle` (clickable), `minting`
 *   (LinkedIn's page is being asked for) or `waiting` (it is open in another
 *   window and the connection is polled until it lands); the button is busy
 *   in both, and waiting offers to start over.
 * - `post`: Post to LinkedIn, as `name`; `posting` while it goes up.
 * - `posted`: View post, LinkedIn's page for the post just made. `opened`
 *   once that page opened on its own, so the button no longer leads.
 */
export type ShareStep =
  | { kind: "share"; via: "sheet" | "paste" }
  | { kind: "checking" }
  | { kind: "connect"; phase: ConnectPhase }
  | { kind: "post"; name: string; posting: boolean }
  | ({ kind: "posted" } & PostedPost);

/** The post made in this opening, and whether its page opened on its own. */
export interface PostedPost {
  postUrl: string;
  opened: boolean;
}

export type ConnectPhase = "idle" | "minting" | "waiting";

/** The connection read, as a query holds it. */
export type ConnectionRead =
  | { status: "pending" }
  | { status: "error" }
  | { status: "ready"; connection: LinkedInConnection };

/**
 * A query's connection read. Data wins over an error: one failed background
 * refetch keeps the connection the person already has on screen, rather than
 * flipping the button to copy and paste.
 */
export function connectionRead(query: {
  data: LinkedInConnection | undefined;
  isError: boolean;
}): ConnectionRead {
  if (query.data) return { status: "ready", connection: query.data };
  return query.isError ? { status: "error" } : { status: "pending" };
}

export function shareStep(input: {
  route: ShareRoute["kind"];
  connection: ConnectionRead;
  /** Where this opening's connect stands. */
  connecting: ConnectPhase;
  posting: boolean;
  posted: PostedPost | null;
}): ShareStep {
  const { route, connection } = input;
  if (route === "sheet") return { kind: "share", via: "sheet" };
  if (route === "paste") return { kind: "share", via: "paste" };
  if (input.posted) return { kind: "posted", ...input.posted };
  if (connection.status === "error") return { kind: "share", via: "paste" };
  if (connection.status === "pending") return { kind: "checking" };
  const { connection: read } = connection;
  if (read.connected)
    return { kind: "post", name: read.name, posting: input.posting };
  return { kind: "connect", phase: input.connecting };
}

export type PrimaryVariant = "default" | "outline";

/**
 * How loudly the primary button asks. A step that needs another press after
 * this one (Connect, then Post) stays quiet, so Post reads as new when it
 * arrives; View post leads only when the post did not open on its own.
 */
const PRIMARY_VARIANT = {
  share: "default",
  checking: "default",
  connect: "outline",
  post: "default",
  posted: { opened: "outline", closed: "default" },
} as const;

export function primaryVariant(step: ShareStep): PrimaryVariant {
  if (step.kind !== "posted") return PRIMARY_VARIANT[step.kind];
  return PRIMARY_VARIANT.posted[step.opened ? "opened" : "closed"];
}

/**
 * The steps that post through LinkedIn's API. Its terms allow pre-filled words
 * there only beside our privacy notice; the share sheet and copy and paste
 * leave the words to LinkedIn.
 */
const POSTS_THROUGH_API = {
  share: false,
  checking: true,
  connect: true,
  post: true,
  posted: true,
} as const satisfies Record<ShareStep["kind"], boolean>;

export const postsThroughApi = (step: ShareStep): boolean =>
  POSTS_THROUGH_API[step.kind];
