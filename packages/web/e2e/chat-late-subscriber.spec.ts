import { FAKE_HOST_URL } from "@houston/fake-host";
import { NEW_TASK_PLACEHOLDER } from "./support/composer";
import { expect, test } from "./support/fixtures";
import { openNewMission } from "./support/mission";

/**
 * A chat stream that attaches after the host already took the message, the
 * order a loaded CI runner produced: the subscribe reaches the host only once
 * the turn has started, and its `sync` (running, our echo folded in) reaches
 * the page BEFORE the send's 202. The client used to drop that sync as another
 * writer's turn, then every delta after it, so the reply never streamed. The
 * 202 names the turn, and the client now claims what it held back.
 *
 * The routes force that order: the events request waits until the message
 * POST has reached the host, and the 202 reaches the page 1.5 s late.
 */
test("a stream that attaches mid-turn, ahead of the send's answer, still streams the reply", async ({
  page,
  request,
}) => {
  // Hold the turn after its first delta: only the sync can carry it.
  await request.post(`${FAKE_HOST_URL}/__test__/chat-config`, {
    data: { replyDelayMs: 2_500, holdAfterFirstDelta: true },
  });
  let admitted: () => void = () => {};
  const turnAdmitted = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  await page.route(/\/conversations\/[^/?]+\/messages$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    admitted();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ response });
  });
  await page.route(/\/conversations\/[^/?]+\/events(\?|$)/, async (route) => {
    await turnAdmitted;
    await route.continue();
  });

  await page.goto("/");
  await openNewMission(page);
  const composer = page.getByPlaceholder(NEW_TASK_PLACEHOLDER);
  await composer.fill("late subscriber");
  await composer.press("Enter");

  // The first delta, which only the attach-time sync carried.
  await expect(page.getByText(/Roger that/).first()).toBeVisible({
    timeout: 15_000,
  });

  // Release the turn: the reconnect replays the rest as OUR turn's frames.
  await request.post(`${FAKE_HOST_URL}/__test__/drop-chat-streams`);
  await expect(page.getByText(/You said: .late subscriber./)).toBeVisible({
    timeout: 15_000,
  });
});
