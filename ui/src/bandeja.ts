import type {
  BandejaEntry,
  BandejaQuestion,
  BandejaState,
  FromBandeja,
} from '../../src/core/bandeja.ts';
import { messageSnippet } from '../../src/core/conversation.ts';

// The Bandeja on the page (src/app/bandeja.ts): the person's rough captures with where each stands,
// and the words the desk says it with.

export type { BandejaEntry, BandejaQuestion, BandejaState, FromBandeja };

// What GET /api/bandeja answers.
export type BandejaView = { entries: BandejaEntry[] };

// How an entry shows its state, by its message key: «esperando al secretario», «puliendo · <agent>»,
// «te pregunta», «archivado en CAM-12». The words are the catalog's.
export function stateKey(entry: BandejaEntry): `bandeja.st.${BandejaState}` {
  return `bandeja.st.${entry.state}`;
}

// The first line of what was captured: the title of its row. A capture of only files has none.
export function entryTitle(entry: Pick<BandejaEntry, 'text'>, max = 120): string {
  return messageSnippet(entry.text, max);
}

// The entries that need the person (a question waits for their tap) come first, then those that
// are being worked on or wait, then the filed ones, newest first. Within a group, oldest first.
export function ordered(entries: readonly BandejaEntry[]): BandejaEntry[] {
  const rank = (entry: BandejaEntry) =>
    entry.state === 'asking' ? 0 : entry.state === 'filed' ? 2 : 1;
  return [...entries].sort((a, b) => {
    const by = rank(a) - rank(b);
    if (by !== 0) return by;
    return rank(a) === 2 ? b.id - a.id : a.id - b.id;
  });
}

// How many entries wait for the person to answer.
export function askingCount(entries: readonly BandejaEntry[]): number {
  return entries.filter(({ state }) => state === 'asking').length;
}
