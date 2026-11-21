import { useEffect } from 'react';
import { postLanguage } from './api.ts';
import { type Language, useLanguage } from './i18n/i18n.ts';

// Tells the server which language the person uses, so what Otea makes without a desk (otea init,
// otea board add, otea prompt) is written in it. The page that opens fills the gap while the server
// knows none, and never overrides what a switch said before; a switch always does. The server
// being away, or the viewer not signed in, changes nothing on screen.
let opened = false;

export async function keepLanguage(lang: Language, post = postLanguage): Promise<void> {
  const opening = !opened;
  opened = true;
  try {
    await post(lang, opening);
  } catch {
    // The language on screen is the browser's own; the server hears it at the next switch.
  }
}

export function useKeepLanguage(): void {
  const lang = useLanguage();
  useEffect(() => {
    void keepLanguage(lang);
  }, [lang]);
}

// For tests: a page that has not opened yet.
export function forgetOpening(): void {
  opened = false;
}
