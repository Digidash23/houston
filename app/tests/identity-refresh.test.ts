import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Session } from "../src/lib/identity/session.ts";

// refresh.ts persists through session-store, which resolves to BROWSER mode
// under node:test — so a fake `localStorage` makes the whole flow hermetic. The
// securetoken refresh call is `fetch`, stubbed per test. No Tauri, no network.

class FakeLocalStorage {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const realFetch = globalThis.fetch;
let fake: FakeLocalStorage;

beforeEach(() => {
  fake = new FakeLocalStorage();
  globalThis.localStorage = fake as unknown as Storage;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  // @ts-expect-error — tear down the fake between tests.
  globalThis.localStorage = undefined;
});

const SESSION: Session = {
  idToken: "old-id",
  refreshToken: "refresh-1",
  uid: "uid-1",
  email: "grace@example.com",
  emailVerified: true,
  displayName: "Grace",
  photoUrl: "https://example.com/grace.png",
  provider: "google.com",
  expiresAt: 1_000,
};

async function seedSession(): Promise<void> {
  const { saveSession } = await import("../src/lib/identity/session-store.ts");
  await saveSession(SESSION);
}

test("refreshNow collapses concurrent calls into ONE refresh request", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    // Resolve on a later tick so both callers observe the same in-flight run.
    await new Promise((r) => setTimeout(r, 5));
    return new Response(
      JSON.stringify({
        id_token: "new-id",
        refresh_token: "refresh-2",
        expires_in: "3600",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const [a, b] = await Promise.all([refreshNow(), refreshNow()]);
  assert.equal(calls, 1);
  assert.equal(a, "new-id");
  assert.equal(b, "new-id");
});

test("refreshNow merges the new token but preserves profile fields", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id_token: "new-id",
        refresh_token: "refresh-2",
        expires_in: "3600",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  await refreshNow();
  const stored = await loadSession();
  assert.ok(stored);
  assert.equal(stored.idToken, "new-id");
  assert.equal(stored.refreshToken, "refresh-2");
  assert.equal(stored.uid, "uid-1");
  assert.equal(stored.photoUrl, "https://example.com/grace.png");
  assert.equal(stored.displayName, "Grace");
});

test("refreshNow clears the session and returns null on an invalid refresh token", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error: { message: "INVALID_REFRESH_TOKEN" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  assert.equal(await refreshNow(), null);
  assert.equal(await loadSession(), null);
});

test("refreshNow signs out on a disabled account (USER_DISABLED is terminal)", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "USER_DISABLED" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  assert.equal(await refreshNow(), null);
  assert.equal(await loadSession(), null);
});

test("refreshNow signs out on a deleted account (USER_NOT_FOUND is terminal)", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "USER_NOT_FOUND" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  assert.equal(await refreshNow(), null);
  assert.equal(await loadSession(), null);
});

test("refreshNow returns null when there is no stored session", async () => {
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal(await refreshNow(), null);
  assert.equal(calls, 0);
});

test("refreshNow RETHROWS a transient network failure and keeps the session", async () => {
  // The three-valued contract (HOU-1106) the hosted-session seam depends on:
  // null is reserved for a TERMINAL sign-out, so a transient failure (identity
  // service unreachable while a sleep-wake reconnect settles) must throw
  // IdentityError("network") — and the installer (engine-gate) must pass that
  // throw through to the adapter's connectivity classifier. Flattening it to
  // null made the stale-token 401 stand and every live query reported a bogus
  // "invalid or expired token" storm (PRODUCT-1531).
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");
  const { isIdentityError } = await import("../src/lib/identity/errors.ts");

  globalThis.fetch = (async () => {
    throw new TypeError("Load failed"); // transport rejection, no HTTP response
  }) as typeof fetch;

  await assert.rejects(refreshNow(), (e: unknown) => {
    assert.ok(isIdentityError(e), "expected a typed IdentityError");
    assert.equal(e.code, "network");
    return true;
  });
  // Transient ≠ sign-out: the stored session must survive for the retry.
  assert.deepEqual(await loadSession(), SESSION);
});

test("proactive refresh backs off on a transient failure near expiry (no hot loop)", async () => {
  // A session already inside the skew window: the expiry-based delay is 0, so
  // without backoff a failing refresh would reschedule at 0 and hammer the
  // network. With backoff it must fire at most once in a short window.
  const { saveSession } = await import("../src/lib/identity/session-store.ts");
  await saveSession({ ...SESSION, expiresAt: Date.now() }); // past the skew

  const { startProactiveRefresh, stopProactiveRefresh } = await import(
    "../src/lib/identity/refresh-timer.ts"
  );

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("network down"); // transient → IdentityError("network")
  }) as typeof fetch;

  startProactiveRefresh();
  // Let the immediate (delay-0) first fire run and its backoff arm the next.
  await new Promise((r) => setTimeout(r, 80));
  stopProactiveRefresh();

  // Exactly one attempt in the window — the 30s backoff prevents a hot loop.
  assert.ok(calls <= 1, `expected <=1 refresh attempt, got ${calls}`);
});

test("the post-save compensation never deletes a NEWER account's session", async () => {
  // The dangerous half of the compensation: a stale refresh whose write landed
  // after a sign-out must NOT clear the store blindly. By the time it looks, a
  // DIFFERENT account may already have signed in — clearing then signs the new
  // user straight back out (and they cannot log in again without a relaunch).
  await seedSession();
  const { refreshNow, setSessionSink } = await import(
    "../src/lib/identity/refresh.ts"
  );
  const { clearSession, loadSession, saveSession } = await import(
    "../src/lib/identity/session-store.ts"
  );

  const NEW_ACCOUNT: Session = {
    ...SESSION,
    idToken: "new-account-id",
    refreshToken: "new-account-refresh",
    uid: "uid-2",
    email: "ada@example.com",
  };

  setSessionSink(() => {});
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id_token: "stale-id",
        refresh_token: "stale-refresh",
        expires_in: "3600",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  // The interleaving: the stale refresh's write lands, and while it settles the
  // user signs out and a different account signs in. Both storage ops below run
  // synchronously inside the browser adapter, so the sequence is deterministic.
  let armed = true;
  const realSetItem = fake.setItem.bind(fake);
  fake.setItem = (key: string, value: string) => {
    realSetItem(key, value);
    if (armed && String(value).includes("stale-id")) {
      armed = false;
      void clearSession(); // sign-out: bumps the epoch, drops the blob
      void saveSession(NEW_ACCOUNT); // a different account signs in
    }
  };

  assert.equal(await refreshNow(), null, "the stale refresh must abandon");
  assert.deepEqual(
    await loadSession(),
    NEW_ACCOUNT,
    "the compensating clear wiped the newly signed-in account",
  );

  setSessionSink(() => {});
});

test("refreshNow abandons the save when clearSession lands DURING the stored-session read", async () => {
  // The narrower half of the sign-out race: `loadSession()` is itself async (a
  // keychain round-trip), so a sign-out can land while the READ is in flight.
  // Sampling the epoch after the read would miss that clear entirely and the
  // refresh would re-save the session sign-out just deleted — the "logged back
  // into the last account" bug. The epoch must be sampled BEFORE the read.
  await seedSession();
  const { refreshNow, setSessionSink } = await import(
    "../src/lib/identity/refresh.ts"
  );
  const { clearSession, loadSession } = await import(
    "../src/lib/identity/session-store.ts"
  );

  const sinkUpdates: (Session | null)[] = [];
  setSessionSink((s) => sinkUpdates.push(s));

  // A read that returns the pre-clear blob while the clear runs underneath it.
  let armed = true;
  const realGetItem = fake.getItem.bind(fake);
  fake.getItem = (key: string) => {
    const value = realGetItem(key);
    if (armed) {
      armed = false;
      void clearSession(); // bumps the epoch mid-read
    }
    return value;
  };

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id_token: "new-id",
        refresh_token: "refresh-2",
        expires_in: "3600",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  assert.equal(await refreshNow(), null);
  assert.equal(
    await loadSession(),
    null,
    "the cleared session was resurrected",
  );
  assert.deepEqual(
    sinkUpdates.filter((s) => s !== null),
    [],
    "the refresh pushed the signed-out account back into the cache",
  );

  setSessionSink(() => {});
});

test("refreshNow abandons the save when clearSession fired mid-flight (sign-out race)", async () => {
  await seedSession();
  const { refreshNow, setSessionSink } = await import(
    "../src/lib/identity/refresh.ts"
  );
  const { clearSession, loadSession } = await import(
    "../src/lib/identity/session-store.ts"
  );

  // Track the refresh sink: it must NOT receive a session on the abandon path.
  const sinkUpdates: (Session | null)[] = [];
  setSessionSink((s) => sinkUpdates.push(s));

  // Gate the securetoken response so sign-out can win the race deterministically.
  let releaseFetch: () => void = () => {};
  globalThis.fetch = (async () => {
    await new Promise<void>((r) => {
      releaseFetch = r;
    });
    return new Response(
      JSON.stringify({
        id_token: "new-id",
        refresh_token: "refresh-2",
        expires_in: "3600",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const pending = refreshNow();
  // Let doRefresh read the session and reach the awaiting fetch.
  await new Promise((r) => setTimeout(r, 5));
  // Sign-out clears the session while the refresh is in flight.
  await clearSession();
  sinkUpdates.length = 0; // ignore the clear's own notify; watch what refresh does
  // Now let the (stale) refresh response arrive.
  releaseFetch();

  assert.equal(await pending, null);
  // Storage must stay empty — the refresh must not resurrect the cleared session.
  assert.equal(await loadSession(), null);
  // The refresh sink must not have pushed a session back into the cache.
  assert.deepEqual(sinkUpdates, []);

  setSessionSink(() => {});
});

// A securetoken answer shaped like the real one: a three-part JWT whose `exp`
// claim is what the gateway judges. `expOffsetS` is relative to now.
function jwtExpiringIn(expOffsetS: number, tag: string): string {
  const nowS = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", kid: tag })}.${enc({
    sub: "uid-1",
    iat: nowS + expOffsetS - 3600,
    exp: nowS + expOffsetS,
    tag,
  })}.sig`;
}

function tokenResponse(idToken: string): Response {
  return new Response(
    JSON.stringify({
      id_token: idToken,
      refresh_token: "refresh-2",
      expires_in: "3600",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("refreshNow never hands out a token already expired by its own claims: it mints again", async () => {
  // Field shape (HOUSTON-APP-5HZ): the proactive timer's securetoken request
  // went out, the laptop slept, and the webview delivered the buffered answer
  // on wake. `expires_in` is counted from the moment the answer is READ, so
  // the session looked an hour fresh while the token's `exp` was 27 minutes
  // in the past. Every joiner of that in-flight run replayed it and the
  // gateway refused each one. The run must notice and mint once more.
  await seedSession();
  const { refreshNow, setSessionSink } = await import(
    "../src/lib/identity/refresh.ts"
  );
  const { loadSession } = await import("../src/lib/identity/session-store.ts");
  const sinkUpdates: (Session | null)[] = [];
  setSessionSink((s) => sinkUpdates.push(s));

  const sleptOut = jwtExpiringIn(-1_621, "slept");
  const fresh = jwtExpiringIn(3_600, "fresh");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return tokenResponse(calls === 1 ? sleptOut : fresh);
  }) as typeof fetch;

  assert.equal(await refreshNow(), fresh);
  assert.equal(calls, 2, "expected exactly one extra mint");
  const stored = await loadSession();
  assert.equal(stored?.idToken, fresh);
  assert.deepEqual(
    sinkUpdates.map((s) => s?.idToken),
    [fresh],
    "the expired token must never be broadcast",
  );
  setSessionSink(() => {});
});

test("joiners of a pre-sleep in-flight refresh receive the re-minted token (one extra request)", async () => {
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");

  const sleptOut = jwtExpiringIn(-5_221, "slept");
  const fresh = jwtExpiringIn(3_600, "fresh");
  let releaseFirst: () => void = () => {};
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((r) => {
        releaseFirst = r;
      });
      return tokenResponse(sleptOut);
    }
    return tokenResponse(fresh);
  }) as typeof fetch;

  const timerRun = refreshNow(); // the proactive timer, before the sleep
  await new Promise((r) => setTimeout(r, 5));
  const wakeReplay = refreshNow(); // the 401 recovery on wake, joining it
  releaseFirst();

  assert.equal(await timerRun, fresh);
  assert.equal(await wakeReplay, fresh);
  assert.equal(calls, 2);
});

test("the stored expiresAt never outlives the token's own exp claim", async () => {
  // `expires_in` is relative to when the answer was read; `exp` is absolute.
  // After a sleep the two disagree by the length of the sleep, and the timer
  // must schedule off the honest one or it waits an hour on a dead token.
  await seedSession();
  const { refreshNow } = await import("../src/lib/identity/refresh.ts");
  const { loadSession } = await import("../src/lib/identity/session-store.ts");

  const shortLived = jwtExpiringIn(900, "short"); // 15 min left, not slept out
  globalThis.fetch = (async () => tokenResponse(shortLived)) as typeof fetch;

  await refreshNow();
  const stored = await loadSession();
  assert.ok(stored);
  const remainingMs = stored.expiresAt - Date.now();
  assert.ok(
    remainingMs <= 900_000 && remainingMs > 800_000,
    `expiresAt must follow exp (~900 s), got ${remainingMs} ms`,
  );
});

test("isSleptOut judges a token by its exp claim with a safety margin", async () => {
  const { isSleptOut } = await import("../src/lib/identity/refresh-mint.ts");
  const now = Date.now();
  assert.equal(isSleptOut("not-a-jwt", now), false, "undecodable = trusted");
  assert.equal(isSleptOut(jwtExpiringIn(3_600, "a"), now), false);
  assert.equal(isSleptOut(jwtExpiringIn(30, "b"), now), true, "inside margin");
  assert.equal(isSleptOut(jwtExpiringIn(-1, "c"), now), true, "expired");
});
