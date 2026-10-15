/**
 * One CDP input step's budget. A renderer that hangs (an endless script, a
 * modal the page holds open) never answers `Input.dispatch*`; without a bound
 * that one step would hold every later batch of the hand-off behind it.
 */
export const CDP_STEP_MS = 5_000;

/** A live-view step that ran out of time; the batch stops there. */
export class StepTimeoutError extends Error {
  override name = "TimeoutError";
}

/** `work`, or a {@link StepTimeoutError} once `ms` pass first. */
export function within<T>(
  work: Promise<T>,
  what: string,
  ms = CDP_STEP_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new StepTimeoutError(`live view ${what} took over ${ms} ms`)),
      ms,
    );
    timer.unref();
  });
  // The race keeps a handler on `work`, so its later failure is not unhandled.
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
