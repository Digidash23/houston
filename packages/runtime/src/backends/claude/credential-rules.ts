import { DENIED_SEGMENTS } from "../../session/tools/fs-guard-containment";

/**
 * Claude Code permission rules for the credential segments the workspace guard
 * denies, passed as `disallowedTools`. The guard judges every path a file tool
 * names, but a Grep or Glob with no path, or a path above the runtime's data
 * dir, searches a whole tree with the credential files in it. Claude Code turns
 * `Read` deny rules into exclusions for those searches and checks them against
 * plain read-only Bash commands (`cat`); `Edit` rules cover Write and Edit.
 * Built from the guard's own list so the two cannot drift.
 */
export const CREDENTIAL_PERMISSION_RULES: readonly string[] = [
  ...DENIED_SEGMENTS,
].flatMap((segment) =>
  ["Read", "Edit"].flatMap((tool) => [
    `${tool}(**/${segment})`,
    `${tool}(**/${segment}/**)`,
  ]),
);
