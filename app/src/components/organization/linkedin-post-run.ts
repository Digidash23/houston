import type { LinkedInPostResult } from "@houston/engine-adapter";
import { linkedInPostLink } from "@houston/sdk/linkedin/policy";
import {
  type LinkedInPostClaim,
  useLinkedInPosts,
} from "./linkedin-post-store";

/** How a post settled, for the person who made it. */
export type LinkedInPostOutcome =
  | { kind: "posted"; postUrl: string }
  | { kind: "unconfirmed" }
  | Extract<LinkedInPostResult, { kind: "refused" }>
  /** The picture or the post failed; each step reported its own failure. */
  | { kind: "failed" };

export interface LinkedInPostSteps {
  /** Who is signed in now (`null`: nobody, a local desktop). */
  signedIn: () => string | null;
  /** The picture to post. Reports its own failure before rejecting. */
  prepare: () => Promise<Blob>;
  /** Sends it. Reports its own failure before rejecting. */
  send: (image: Blob) => Promise<LinkedInPostResult>;
}

/**
 * One claimed post, from the picture to its result in the slot. Every step
 * is checked against the person who claimed it: a post prepared under one
 * identity is never sent under another, and a result that lands after the
 * identity changed is dropped (`null`), so nothing of it reaches the next
 * person. The slot stops Posting either way.
 */
export async function runLinkedInPost(
  claim: LinkedInPostClaim,
  steps: LinkedInPostSteps,
): Promise<LinkedInPostOutcome | null> {
  const posts = useLinkedInPosts.getState();
  const mine = () => posts.holds(claim, steps.signedIn());
  try {
    const image = await steps.prepare();
    if (!mine()) return null;
    const result = await steps.send(image);
    if (!mine()) return null;
    if (result.kind === "unknown") {
      posts.unconfirmed(claim);
      return { kind: "unconfirmed" };
    }
    if (result.kind === "refused") return result;
    const postUrl = linkedInPostLink(result.postUrl);
    posts.posted(claim, postUrl);
    return { kind: "posted", postUrl };
  } catch {
    // Already reported by the step that failed (see LinkedInPostSteps).
    return mine() ? { kind: "failed" } : null;
  } finally {
    posts.ended(claim);
  }
}
