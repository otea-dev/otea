// How text an agent wrote is shown wherever the secretary or another agent reads it (a wake, `otea
// pending`, `otea conversation`, `otea bandeja`): as data, never as a line of Otea's own. One quoting
// for all: control and format characters and line breaks become one space, the quote marks are taken
// out of the words (so they cannot close the quote from inside), the length is cut, and the whole is
// wrapped in «». What is inside never starts a line, nor reads as an instruction of ours.

export const QUOTE_MAX_CHARS = 200;

// The words on one line, with no «» inside, cut at `max` characters (with an ellipsis).
export function plainLine(text: string, max = QUOTE_MAX_CHARS): string {
  const one = text
    .replace(/[«»]/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ')
    .trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

// The words of an agent, quoted as data.
export const quoteAgent = (text: string, max = QUOTE_MAX_CHARS): string =>
  `«${plainLine(text, max)}»`;
