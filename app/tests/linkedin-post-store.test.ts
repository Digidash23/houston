import { deepStrictEqual, match, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  IDLE_LINKEDIN_POST,
  type LinkedInPostClaim,
  linkedInPostKey,
  useLinkedInPosts,
} from "../src/components/organization/linkedin-post-store.ts";

const url = "https://www.linkedin.com/feed/update/urn:li:share:7/";
const ada = linkedInPostKey("uid-ada", "space-a");
const slot = (key: string) =>
  useLinkedInPosts.getState().slots[key] ?? IDLE_LINKEDIN_POST;
const claim = (key: string): LinkedInPostClaim => {
  const held = useLinkedInPosts.getState().start(key);
  if (!held) throw new Error("the slot was taken");
  return held;
};

afterEach(() => useLinkedInPosts.getState().reset());

// The org chart page unmounts and remounts around the store, which is all a
// navigation away and back does to it: the slot is the only post state.
describe("a person's LinkedIn post slot in a space", () => {
  it("refuses a second post while one from the slot is out", () => {
    const posts = useLinkedInPosts.getState();
    claim(ada);
    // The page came back while the gateway still works: still Posting.
    strictEqual(slot(ada).posting, true);
    strictEqual(posts.start(ada), null);
    // Another space posts its own chart.
    strictEqual(
      posts.start(linkedInPostKey("uid-ada", "space-b")) !== null,
      true,
    );
  });

  it("holds a post that went up with no dialog open until one shows it", () => {
    const posts = useLinkedInPosts.getState();
    const held = claim(ada);
    posts.posted(held, url);
    posts.ended(held);
    deepStrictEqual(slot(ada), { ...IDLE_LINKEDIN_POST, landed: url });
    posts.shown(ada);
    deepStrictEqual(slot(ada), IDLE_LINKEDIN_POST);
  });

  it("holds a post with no answer in time until a dialog says so", () => {
    const posts = useLinkedInPosts.getState();
    const held = claim(ada);
    posts.unconfirmed(held);
    posts.ended(held);
    deepStrictEqual(slot(ada), { ...IDLE_LINKEDIN_POST, unconfirmed: true });
    posts.shown(ada);
    deepStrictEqual(slot(ada), IDLE_LINKEDIN_POST);
  });

  it("frees the slot when a post did not go up", () => {
    const posts = useLinkedInPosts.getState();
    posts.ended(claim(ada));
    deepStrictEqual(slot(ada), IDLE_LINKEDIN_POST);
    strictEqual(posts.start(ada) !== null, true);
  });

  // Every account's personal space is "default".
  it("keeps two people apart in a space with the same id", () => {
    const grace = linkedInPostKey("uid-grace", "default");
    claim(linkedInPostKey("uid-ada", "default"));
    deepStrictEqual(slot(grace), IDLE_LINKEDIN_POST);
    strictEqual(useLinkedInPosts.getState().start(grace) !== null, true);
  });
});

describe("an identity change", () => {
  it("clears every slot", () => {
    const posts = useLinkedInPosts.getState();
    claim(ada);
    posts.posted(claim(linkedInPostKey("uid-ada", "space-b")), url);
    posts.reset();
    deepStrictEqual(useLinkedInPosts.getState().slots, {});
  });

  it("drops a post's late answer, so the next person never sees it", () => {
    const posts = useLinkedInPosts.getState();
    const held = claim(ada);
    posts.reset();
    strictEqual(posts.holds(held), false);
    posts.posted(held, url);
    posts.unconfirmed(held);
    posts.ended(held);
    deepStrictEqual(useLinkedInPosts.getState().slots, {});
  });

  it("is wired into resetForIdentityChange", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/lib/identity-reset.ts"),
      "utf8",
    );
    match(source, /\n {2}useLinkedInPosts\.getState\(\)\.reset\(\);\n/);
  });
});
