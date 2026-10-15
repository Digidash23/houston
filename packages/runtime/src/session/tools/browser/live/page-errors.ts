/** Playwright's refusal for a page, frame or CDP session that has gone away. */
export function isClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Target (page, context or browser )?(has been )?closed|Session closed|has been closed|Target closed/i.test(
      error.message,
    )
  );
}

/**
 * A catch for background page work with no caller to answer: a page closing
 * underneath is routine and dropped, anything else is logged.
 */
export function warnUnlessClosed(what: string): (error: unknown) => void {
  return (error) => {
    if (!isClosedError(error))
      console.warn(`[browser] ${what} failed:`, firstLine(error));
  };
}

/** One line, without the URL Playwright appends (it may carry a query). */
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? "").replace(/\s+at\s+\S+:\/\/\S*$/, "");
}
