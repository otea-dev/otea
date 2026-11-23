import { searchWords, wordsHeld } from '../../../src/core/search-words.ts';
import type { Item } from '../types.ts';

// The phone's search (the magnifier in the top bar): the items the app already holds, found by
// their id, title and fields with the words the desk's search uses (src/core/search-words.ts:
// accents and plurals folded, any of the words, the one holding the most first). It reads what is
// on the phone, so it answers at once and with no PC too; the desk's own endpoint looks in the
// threads and keeps five, which is a different question (what was concluded, not where is it).

// A page of results: past it, a longer search is what finds the rest.
export const SEARCH_MAX = 40;

const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function findItems(items: readonly Item[], search: string): Item[] {
  const searched = searchWords(search);
  if (searched.length === 0) return [];
  const typedId = folded(search.trim());
  const scored = items.flatMap((item) => {
    const heading = `${item.id}\n${item.title}`;
    const all = `${heading}\n${Object.values(item.fields).join('\n')}`;
    const held = wordsHeld(all, searched);
    if (held === 0) return [];
    // What the heading holds counts double, and an id typed whole comes first.
    const score = (folded(item.id) === typedId ? 100 : 0) + wordsHeld(heading, searched) + held;
    return [{ item, score }];
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.item.turn === 'none') - Number(b.item.turn === 'none') ||
        b.item.updatedAt.localeCompare(a.item.updatedAt),
    )
    .slice(0, SEARCH_MAX)
    .map(({ item }) => item);
}
