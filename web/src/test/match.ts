/* Route-pattern matching for the harness (`./routes.tsx`, `./app.tsx`). */

/**
 * Matches `pathname` against a pattern whose dynamic segments are `:name`,
 * answering the params and a rank: static segments outrank dynamic ones, as
 * they do in Next and did in react-router, so `/songs/new` beats `/songs/:id`.
 */
function matchPattern(
  pattern: string,
  pathname: string,
): { params: Record<string, string>; rank: number } | null {
  const want = segments(pattern);
  const have = segments(pathname);
  if (want.length !== have.length) return null;

  const params: Record<string, string> = {};
  let rank = 0;
  for (const [index, segment] of want.entries()) {
    const actual = have[index] ?? "";
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(actual);
      rank += 1;
    } else if (segment === actual) {
      rank += 2;
    } else {
      return null;
    }
  }
  return { params, rank };
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** The best-ranked of `patterns` matching `pathname`, if any does. */
export function bestMatch<T extends string>(
  patterns: readonly T[],
  pathname: string,
): { pattern: T; params: Record<string, string> } | null {
  let best: { pattern: T; params: Record<string, string>; rank: number } | null = null;
  for (const pattern of patterns) {
    const match = matchPattern(pattern, pathname);
    if (match && (!best || match.rank > best.rank)) best = { pattern, ...match };
  }
  return best && { pattern: best.pattern, params: best.params };
}
