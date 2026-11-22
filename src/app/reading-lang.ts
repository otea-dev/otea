import { AsyncLocalStorage } from 'node:async_hooks';
import { readsIn } from '../core/board/schema.ts';
import type { Lang } from '../core/board/template-words.ts';

// The language a request of the desk is answered in: the one on the person's screen. A board keeps
// its template's words in every language (core/board/localize.ts), so whoever reads it says them in
// a language, and the desk's requests give theirs here. A command with no desk (the CLI, an agent)
// gives none and reads each board in the language it was made in, which does not change while the
// person switches the desk. Work that is no request's (the notifier's scans, a poll) runs with
// `inLanguage(undefined, …)`: a timer started while a request ran would otherwise keep that
// request's language.

const asked = new AsyncLocalStorage<Lang | undefined>();

export const readingLang = (): Lang | undefined => asked.getStore();

export function inLanguage<T>(lang: Lang | undefined, work: () => T): T {
  return asked.run(lang, work);
}

readsIn(readingLang);
