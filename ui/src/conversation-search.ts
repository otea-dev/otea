import { useEffect, useState } from 'react';
import { messageSnippet } from '../../src/core/conversation.ts';
import { fetchConversation } from './api.ts';
import type { Message, MessageKind } from './conversation.ts';

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
      text: messageSnippet(message.text, 120),
      at: message.at,
    }));
}

const DELAY_MS = 250;

// The hits of what is typed, a moment after the last key; none for a blank search or a PC that
// does not answer.
export function useConversationHits(search: string): Hit[] {
  const [hits, setHits] = useState<{ for: string; hits: Hit[] }>({ for: '', hits: [] });
  const asked = search.trim();
  useEffect(() => {
    if (asked === '') return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      fetchConversation({ search: asked, limit: 40 }, control.signal).then(
        (view) => setHits({ for: asked, hits: hitsOf(view.messages) }),
        () => undefined,
      );
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [asked]);
  return asked !== '' && hits.for === asked ? hits.hits : [];
}
