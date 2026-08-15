/**
 * Delimiters the API wraps around matched terms in a lyrics snippet.
 * Kept in sync with SnippetStartSel/SnippetStopSel in the Go store package.
 */
const START = "⟦";
const STOP = "⟧";

export interface SnippetSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits a delimited snippet into plain and highlighted runs.
 *
 * The API delimits matches with sentinel characters rather than HTML because
 * PostgreSQL's ts_headline returns the source lyrics verbatim — any markup a
 * contributor typed comes back untouched. Splitting on sentinels means the
 * lyrics are only ever rendered as text, so there is nothing to sanitize and
 * no way to inject markup.
 */
export function parseSegments(text: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let rest = text;

  while (rest.length > 0) {
    const start = rest.indexOf(START);
    if (start === -1) {
      segments.push({ text: rest, highlighted: false });
      break;
    }

    if (start > 0) {
      segments.push({ text: rest.slice(0, start), highlighted: false });
    }

    const stop = rest.indexOf(STOP, start + START.length);
    if (stop === -1) {
      // Unterminated marker: render the remainder as plain text rather than
      // dropping it, so a truncated snippet still shows its lyrics.
      segments.push({ text: rest.slice(start + START.length), highlighted: false });
      break;
    }

    segments.push({ text: rest.slice(start + START.length, stop), highlighted: true });
    rest = rest.slice(stop + STOP.length);
  }

  return segments;
}
