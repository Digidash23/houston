import { afterEach, expect, test } from "vitest";
import { buildClaudeEnv } from "./claude-env";

const savedHome = process.env.HOME;

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

test("an explicit home overrides the ambient HOME", () => {
  process.env.HOME = "/ambient";

  const env = buildClaudeEnv(undefined, {
    configDir: "/config",
    homeDir: "/turn/home",
  });

  expect(env.HOME).toBe("/turn/home");
  expect(env.CLAUDE_CONFIG_DIR).toBe("/config");
});

test("the credential store remains optional and must be absolute", () => {
  expect(
    buildClaudeEnv(undefined, {
      configDir: "/config",
      credentialStorageDir: "/turn/credentials",
    }).CLAUDE_SECURESTORAGE_CONFIG_DIR,
  ).toBe("/turn/credentials");
  expect(() =>
    buildClaudeEnv(undefined, {
      configDir: "/config",
      credentialStorageDir: "relative",
    }),
  ).toThrow(/absolute path/);
});

test("the shell fence rides CLAUDE_CODE_SHELL_PREFIX, and only the fence does", () => {
  const savedPrefix = process.env.CLAUDE_CODE_SHELL_PREFIX;
  process.env.CLAUDE_CODE_SHELL_PREFIX = "/ambient/wrapper";
  try {
    const fenced = buildClaudeEnv(undefined, {
      configDir: "/config",
      shellFencePath: "/data/bin/claude-shell-fence",
    });
    expect(fenced.CLAUDE_CODE_SHELL_PREFIX).toBe(
      "/data/bin/claude-shell-fence",
    );

    // No container limit → no wrapper; the ambient one never passes through.
    const open = buildClaudeEnv(undefined, {
      configDir: "/config",
      shellFencePath: null,
    });
    expect(open.CLAUDE_CODE_SHELL_PREFIX).toBeUndefined();
  } finally {
    if (savedPrefix === undefined) delete process.env.CLAUDE_CODE_SHELL_PREFIX;
    else process.env.CLAUDE_CODE_SHELL_PREFIX = savedPrefix;
  }
});

test("a personal plan rides beside the OAuth token", () => {
  for (const plan of ["pro", "max"] as const) {
    const env = buildClaudeEnv(
      { kind: "oauth-token", value: "sk-ant-oat01-x", subscriptionType: plan },
      { configDir: "/config" },
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-x");
    expect(env.CLAUDE_CODE_SUBSCRIPTION_TYPE).toBe(plan);
  }
});

test("an organization plan or an unknown one leaves the CLI to fetch its policy", () => {
  for (const plan of ["team", "enterprise", undefined] as const) {
    const env = buildClaudeEnv(
      { kind: "oauth-token", value: "sk-ant-oat01-x", subscriptionType: plan },
      { configDir: "/config" },
    );
    expect(env.CLAUDE_CODE_SUBSCRIPTION_TYPE).toBeUndefined();
  }
  expect(
    buildClaudeEnv(
      { kind: "api-key", value: "sk-ant-api03-x" },
      { configDir: "/config" },
    ).CLAUDE_CODE_SUBSCRIPTION_TYPE,
  ).toBeUndefined();
});

test("an ambient plan never reaches the subprocess", () => {
  const saved = process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE;
  process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = "max";
  try {
    expect(
      buildClaudeEnv(
        { kind: "oauth-token", value: "sk-ant-oat01-x" },
        { configDir: "/config" },
      ).CLAUDE_CODE_SUBSCRIPTION_TYPE,
    ).toBeUndefined();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE;
    else process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = saved;
  }
});
