import { useEffect, useState } from 'react';
import { fetchConversation } from './api.ts';
import { type Message, type MessageKind, quotedSnippet } from './conversation.ts';

// Searching what was said in Hablar (field study 3: a consultation about «backoff» was not found
// by the search, which looked only at items). The server searches the conversation by words
// (GET /api/conversation?search=); a hit is the moment of a turn, which opens in Hablar.
export type Hit = {
  // The turn it belongs to: `#/hablar/<root>` opens it, reading earlier pages until it is there.
  root: number;
  kind: MessageKind | null;
  text: string;
  at: string;
};

// The turns the messages found belong to, newest first, each said by its first message that
// matched (the question, when it did).
export function hitsOf(messages: readonly Message[], max = 12): Hit[] {
  const first = new Map<number, Message>();
  for (const message of [...messages].sort((a, b) => a.id - b.id)) {
    if (!first.has(message.root)) first.set(message.root, message);
  }
  return [...first.values()]
    .sort((a, b) => b.root - a.root)
    .slice(0, max)
    .map((message) => ({
      root: message.root,
      kind: message.kind,
      // A preview, cut where it is: its backticks go (a cut in a span leaves a mark with no mate).
      text: quotedSnippet(message.text, 120),
      at: message.at,
    }));
}

const DELAY_MS = 250;

// Where a search stands: nothing typed, asked and not answered yet, answered (maybe with no hit),
// or the PC did not answer. «Nothing says it» is only for `ready`.
export type HitsState = 'idle' | 'searching' | 'ready' | 'failed';

// The hits of what is typed, a moment after the last key, and where the search stands; no hits for
// a blank search, one still on its way, or a PC that does not answer.
export function useConversationHits(search: string): { hits: Hit[]; state: HitsState } {
  const [heard, setHeard] = useState<{ for: string; hits: Hit[] | null }>({
    for: '',
    hits: null,
  });
  const asked = search.trim();
  useEffect(() => {
    if (asked === '') return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      fetchConversation({ search: asked, limit: 40 }, control.signal).then(
        (view) => setHeard({ for: asked, hits: hitsOf(view.messages) }),
        () => {
          if (!control.signal.aborted) setHeard({ for: asked, hits: null });
        },
      );
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [asked]);
  if (asked === '') return { hits: [], state: 'idle' };
  if (heard.for !== asked) return { hits: [], state: 'searching' };
  return heard.hits === null ? { hits: [], state: 'failed' } : { hits: heard.hits, state: 'ready' };
}
