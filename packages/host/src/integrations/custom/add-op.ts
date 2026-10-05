import { type AddCustomIntegrationInput, defFromAddInput } from "./add-input";
import type { CustomOAuthDeps } from "./oauth-ops";
import { sameServiceOrigins } from "./service-origins";
import { slugify } from "./slug";
import {
  CUSTOM_SLUG,
  CustomIntegrationError,
  type CustomIntegrationView,
} from "./types";
import { viewOf } from "./views";

export async function addCustomIntegration(
  deps: CustomOAuthDeps,
  input: AddCustomIntegrationInput,
): Promise<CustomIntegrationView> {
  const slug = input.slug ?? slugify(input.name);
  if (!CUSTOM_SLUG.test(slug)) {
    throw new CustomIntegrationError("invalid_slug", `invalid slug '${slug}'`);
  }
  // The capability gate is authoritative HERE, not just advisory in the
  // UI/agent: a deployment that cannot receive the browser redirect must
  // never accumulate pending-oauth definitions whose one affordance can
  // only fail.
  if (input.auth === "oauth" && deps.callbackUrl === undefined) {
    throw new CustomIntegrationError(
      "oauth_unsupported",
      "signing in with this service is not available on this Houston deployment yet",
    );
  }
  // The executor's own internal toolbox lives under the reserved
  // integration id "executor" — a user definition with that slug would
  // collide inside the engine and leak engine-internal tools into
  // counts/lists (the store's duplicate check cannot see it).
  if (slug === "executor") {
    throw new CustomIntegrationError(
      "invalid_slug",
      "'executor' is a reserved name; pick another",
    );
  }
  const defs = await deps.store.list();
  const existing = defs.find((d) => d.slug === slug);
  if (existing && !input.replace) {
    throw new CustomIntegrationError(
      "duplicate_slug",
      `a custom integration named '${slug}' already exists`,
    );
  }
  if (existing && existing.kind !== input.kind) {
    throw new CustomIntegrationError(
      "duplicate_slug",
      `'${slug}' already exists as a different kind; remove it first`,
    );
  }
  let def = defFromAddInput(input, slug);
  if (existing) {
    // An in-place spec swap, not a new integration: the added date
    // survives, and the saved credential survives ONLY when the
    // replacement provably talks to the same service — a spec that moves
    // (or hides) its servers must never inherit the key, or a bad actor
    // could point it at their own host and collect it. A dropped carry
    // lands the def `pending`; the key is re-collected via the secure card.
    // Within the same service the carry ignores the input's `auth`: replace
    // is spec-repair, and the caller is a model re-deriving `auth` on every
    // call — a sloppy `"none"` replay must not silently discard a working
    // key (the promised semantics are "the key survives").
    const keepCredential =
      existing.credential !== undefined && sameServiceOrigins(existing, def);
    def = {
      ...def,
      addedAtMs: existing.addedAtMs,
      ...(keepCredential
        ? // The carried auth mode is the EXISTING one (a signed-in oauth
          // def stays oauth; a keyed one stays credential) — replace is
          // spec-repair, never an auth downgrade.
          { auth: existing.auth, credential: existing.credential }
        : {}),
    };
  }
  const { executor, states } = await deps.host.ensure();
  // The proven refresh sequence: tear down the compiled view, recompile —
  // connection included (see CustomExecutorHost.refreshSpecs).
  if (existing) await deps.host.uncompileDef(executor, existing);
  const state = await deps.host.compileDef(executor, def);
  if (state.status === "error") {
    // A failed replacement must not cost a working integration: clear
    // whatever the failed compile managed to register (an addSpec that
    // succeeded before the connection step failed would otherwise occupy
    // the slug), then put the previous compiled view back.
    await deps.host.uncompileDef(executor, def);
    if (existing) {
      states.set(slug, await deps.host.compileDef(executor, existing));
    }
    // Never persist a definition that cannot compile — the add FAILED and
    // the agent gets the real reason to relay/fix (wrong URL, server down).
    throw new CustomIntegrationError("compile_failed", state.message);
  }
  // The replacement no longer references the old secrets (the carry was
  // refused because the service moved): delete them now, while the old def
  // still names them — after the put nothing else ever would.
  for (const id of Object.values(existing?.credential?.secretIds ?? {})) {
    if (!Object.values(def.credential?.secretIds ?? {}).includes(id)) {
      await deps.secrets.delete(id);
    }
  }
  await deps.store.put(def);
  states.set(slug, state);
  deps.onChanged(slug);
  return viewOf(
    def,
    state,
    await deps.host.authMethods(executor, slug).catch(() => []),
  );
}
