import { FAKE_HOST_URL } from "@houston/fake-host";
import type { APIRequestContext } from "@playwright/test";

/**
 * Hire `name` with its first day pending and sign every agent's Claude out,
 * so the provider probe confirms nothing is connected wherever it routes.
 */
export async function hireWithNoAiConnected(
  request: APIRequestContext,
  name: string,
): Promise<void> {
  await request.post(`${FAKE_HOST_URL}/agents`, {
    data: {
      name,
      seeds: {
        ".houston/config/config.json": JSON.stringify({ firstDay: "pending" }),
      },
    },
  });
  const agents = (await (
    await request.get(`${FAKE_HOST_URL}/agents`)
  ).json()) as { id: string }[];
  for (const { id } of agents)
    await request.post(
      `${FAKE_HOST_URL}/agents/${encodeURIComponent(id)}/auth/anthropic/logout`,
      { headers: { authorization: "Bearer e2e-token" } },
    );
}
