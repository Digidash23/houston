import { deepStrictEqual, strictEqual } from "node:assert";
import { afterEach, describe, it } from "node:test";
import {
  IDLE_LINKEDIN_POST,
  useLinkedInPosts,
} from "../src/components/organization/linkedin-post-store.ts";

const url = "https://www.linkedin.com/feed/update/urn:li:share:7/";
const slot = (key: string) =>
  useLinkedInPosts.getState().slots[key] ?? IDLE_LINKEDIN_POST;

afterEach(() => useLinkedInPosts.setState({ slots: {} }));

// The org chart page unmounts and remounts around the store, which is all a
// navigation away and back does to it: the slot is the only post state.
describe("the space's LinkedIn post slot", () => {
  it("refuses a second post while one from the space is out", () => {
    const posts = useLinkedInPosts.getState();
    strictEqual(posts.start("space-a"), true);
    // The page came back while the gateway still works: still Posting.
    strictEqual(slot("space-a").posting, true);
    strictEqual(posts.start("space-a"), false);
    // Another space posts its own chart.
    strictEqual(posts.start("space-b"), true);
  });

  it("holds a post that went up with no dialog open until one shows it", () => {
    const posts = useLinkedInPosts.getState();
    posts.start("space-a");
    posts.posted("space-a", url);
    posts.ended("space-a");
    deepStrictEqual(slot("space-a"), { posting: false, landed: url });
    posts.shown("space-a");
    deepStrictEqual(slot("space-a"), IDLE_LINKEDIN_POST);
  });

  it("frees the slot when a post did not go up", () => {
    const posts = useLinkedInPosts.getState();
    posts.start("space-a");
    posts.ended("space-a");
    deepStrictEqual(slot("space-a"), IDLE_LINKEDIN_POST);
    strictEqual(posts.start("space-a"), true);
  });
});
