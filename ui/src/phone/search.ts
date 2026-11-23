import { searchWords } from '../../../src/core/search-words.ts';
import type { Item } from '../types.ts';

// The phone's search (the magnifier in the top bar): the items the app already holds, found by
// their id, title and fields with the words the desk's search uses (src/core/search-words.ts:
// accents and plurals folded, any of the words, the one holding the most first). It reads what is
// on the phone, so it answers at once and with no PC too; the desk's own endpoint looks in the
// threads and keeps five, which is a different question (what was concluded, not where is it).
//
// The word being typed counts by its start from its first letter («lo» finds login and logs); the
// words before it are whole, as on the desk.

// A page of results: past it, a longer search is what finds the rest.
export const SEARCH_MAX = 40;

const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text: string) =>
  folded(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');

// What an item holds, folded and split once: a search then only compares words.
type Entry = { item: Item; id: string; heading: string[]; all: string[] };
export type SearchIndex = readonly Entry[];

export function indexItems(items: readonly Item[]): SearchIndex {
  return items.map((item) => {
    const heading = [...new Set(wordsOf(`${item.id}\n${item.title}`))];
    const fields = wordsOf(Object.values(item.fields).join('\n'));
    return { item, id: folded(item.id), heading, all: [...new Set([...heading, ...fields])] };
  });
}

// A word matches a whole word of the text, or the start of one when it has four letters or more.
const holds = (words: readonly string[], form: string) =>
  words.includes(form) || (form.length >= 4 && words.some((word) => word.startsWith(form)));

export function findItems(index: SearchIndex, search: string): Item[] {
  // The word being typed: the last, unless a space or a sign already ended it.
  const tail = /[\p{L}\p{N}]+$/u.exec(search)?.[0] ?? '';
  const typing = folded(tail);
  const whole = searchWords(search.slice(0, search.length - tail.length));
  if (whole.length === 0 && typing === '') return [];
  const typed = typing === '' ? [] : searchWords(typing).flat();
  const count = (words: readonly string[]) =>
    whole.filter((forms) => forms.some((form) => holds(words, form))).length +
    (typing !== '' &&
    (words.some((word) => word.startsWith(typing)) || typed.some((form) => holds(words, form)))
      ? 1
      : 0);
  const typedId = folded(search.trim());
  const scored = index.flatMap((entry) => {
    const held = count(entry.all);
    if (held === 0) return [];
    // What the heading holds counts double, and an id typed whole comes first.
    const score = (entry.id === typedId ? 100 : 0) + count(entry.heading) + held;
    return [{ item: entry.item, score }];
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
