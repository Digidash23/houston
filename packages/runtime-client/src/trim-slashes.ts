/**
 * `url` without its trailing `/`s. A loop, not `/\/+$/`: that regex backtracks
 * quadratically on a long run of slashes followed by anything else, and the
 * base URLs it trims come from callers.
 */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return end === url.length ? url : url.slice(0, end);
}
