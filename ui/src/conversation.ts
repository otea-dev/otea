import {
  type FromMessage,
  type Message,
  type MessageFile,
  type MessageKind,
  messageSnippet,
} from '../../src/core/conversation.ts';
import type { SecretaryStatus } from '../../src/core/secretary.ts';
import { activeLease } from './active-lease.ts';
import type { Look } from './lanes/looks.ts';
import { lookOf } from './lanes/looks.ts';
import type { Item } from './types.ts';

// Hablar on the page (src/app/conversation.ts): the project's one conversation with its secretary
// worked into turns, and what a turn produced worked into what the view draws: the thinking state,
// the folded reply, the branch of items, the cards of «Lo que salió».

export type { FromMessage, Message, MessageFile, MessageKind, SecretaryStatus };

// What GET /api/conversation answers: the messages in order, the secretary as M1 tells it, and how
// many of the person's messages wait for it.
export type ConversationView = {
  messages: Message[];
  more: boolean;
  secretary: SecretaryStatus | null;
  waiting: { count: number; since: string | null };
};

// The composer's three static suggestions (SPEC §7), by their message keys.
export const SUGGESTIONS = ['hablar.sugg.today', 'hablar.sugg.done', 'hablar.sugg.board'] as const;

// A turn: what the person said and what came back, ordered, with the kind and the links they share.
export type Turn = {
  // The message that began it: the turn's key, and what a link to it carries.
  root: number;
  messages: Message[];
  person: Message[];
  // The secretary's (and an agent's) messages, in order.
  replies: Message[];
  kind: MessageKind | null;
  // The items (and board drafts) it produced.
  links: string[];
  // The side topic this turn is the record of (TEM-3), when it is.
  topic: string | null;
  at: string;
  // The last message is the person's: still on its way (pending), or read and not answered yet
  // (reading, the secretary holds the turn).
  waits: 'pending' | 'reading' | null;
};

// The messages of every page loaded, once each by id, in order. A later list wins: a message read
// since or a turn corrected shows as it stands now.
export function mergeMessages(...lists: readonly (readonly Message[])[]): Message[] {
  const byId = new Map<number, Message>();
  for (const list of lists) for (const message of list) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// The messages grouped by turn, the turns in the order they began.
export function turnsOf(messages: readonly Message[]): Turn[] {
  const byRoot = new Map<number, Message[]>();
  for (const message of [...messages].sort((a, b) => a.id - b.id)) {
    const list = byRoot.get(message.root);
    if (list) list.push(message);
    else byRoot.set(message.root, [message]);
  }
  const turns: Turn[] = [];
  for (const [root, group] of byRoot) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) continue;
    const person = group.filter((m) => m.author === 'person');
    const waits =
      last.author !== 'person' ? null : last.delivery === 'pending' ? 'pending' : 'reading';
    turns.push({
      root,
      messages: group,
      person,
      replies: group.filter((m) => m.author !== 'person'),
      // The turn's kind and links are shown on each of its messages; one that was read before
      // the secretary classified the turn still has none.
      kind: group.findLast((m) => m.kind !== null)?.kind ?? null,
      links: [...new Set(group.flatMap((m) => m.links))],
      topic: group.find((m) => m.topic !== null)?.topic ?? null,
      at: first.at,
      waits,
    });
  }
  return turns.sort((a, b) => a.root - b.root);
}

// The turn the secretary holds now: it read the person's words and has not answered yet. While it
// is offline nothing is thinking: the banner says it is away.
export function thinkingRoot(
  turns: readonly Turn[],
  secretary: SecretaryStatus | null,
): number | undefined {
  if (!secretary || secretary.state === 'offline') return undefined;
  return turns.findLast((turn) => turn.waits === 'reading')?.root;
}

// How much of a reply shows before «ver más»: the first line, then this many lines or characters.
// The secretary's own rule is to be short (M4); this is the page's guard for when it is not.
export const FOLD_LINES = 4;
export const FOLD_CHARS = 280;

export type Reply = {
  // The one-line conclusion.
  lead: string;
  // The rest, apart from the lead.
  rest: string;
  // The rest is long: it folds behind «ver más».
  folds: boolean;
};

export function splitReply(text: string): Reply {
  const trimmed = text.trim();
  const cut = trimmed.indexOf('\n');
  const lead = (cut < 0 ? trimmed : trimmed.slice(0, cut)).trim();
  const rest = cut < 0 ? '' : trimmed.slice(cut + 1).trim();
  const lines = rest === '' ? 0 : rest.split(/\r?\n/).length;
  return { lead, rest, folds: lines > FOLD_LINES || rest.length > FOLD_CHARS };
}

// The text as pieces: item ids of this project (they link to the item), web addresses (they open),
// and plain words. Messages are plain text; nothing is rendered as markup.
export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'item'; id: string }
  | { kind: 'url'; url: string };

const WORDS = /(https?:\/\/[^\s<>"')\]]+)|(\b[A-Za-z][A-Za-z0-9]*-\d+\b)/g;
const TRAILING = /[.,;:!?]+$/;

export function piecesOf(text: string, known: ReadonlySet<string>): Piece[] {
  const out: Piece[] = [];
  let from = 0;
  for (const match of text.matchAll(WORDS)) {
    const at = match.index;
    const [found, address] = match;
    const isItem = address === undefined && known.has(found);
    if (address === undefined && !isItem) continue;
    // A sentence's own punctuation after an address is not part of it.
    const url = address?.replace(TRAILING, '');
    const whole = url ?? found;
    if (at > from) out.push({ kind: 'text', text: text.slice(from, at) });
    out.push(url === undefined ? { kind: 'item', id: found } : { kind: 'url', url });
    from = at + whole.length;
  }
  if (from < text.length) out.push({ kind: 'text', text: text.slice(from) });
  return out;
}

// Whether a file shows as a thumbnail that opens large: only the formats an image is served in.
export function isPicture(file: Pick<MessageFile, 'kind' | 'contentType'>): boolean {
  return file.kind === 'image' && /^image\/(png|jpe?g|gif|webp)$/.test(file.contentType);
}

// What a turn produced, as one chip of its branch: the item, how it looks as a node, and the words
// of its state. An id no item answers to (a board draft) has no look.
export type Chip = {
  id: string;
  look: Look | null;
  title: string;
  // The agent holding it while it works.
  agent: string | null;
  // The state's word key; it asks you (`asks`) when an agent's question waits for your answer.
  state: StateWord;
  asks: boolean;
};

export type StateWord =
  | 'hablar.st.working'
  | 'hablar.st.queued'
  | 'hablar.st.waiting'
  | 'hablar.st.stuck'
  | 'hablar.st.done'
  | 'hablar.st.dropped'
  | 'hablar.st.yours'
  | 'hablar.st.asks'
  | 'hablar.st.draft';

export function chipOf(id: string, items: ReadonlyMap<string, Item>, now: number): Chip {
  const item = items.get(id);
  if (!item)
    return { id, look: null, title: '', agent: null, state: 'hablar.st.draft', asks: false };
  const look = lookOf(item, now);
  const asks = item.asks !== undefined && item.turn === 'human';
  const state: StateWord = asks
    ? 'hablar.st.asks'
    : look === 'yours'
      ? 'hablar.st.yours'
      : (`hablar.st.${look}` as StateWord);
  return {
    id,
    look,
    title: item.title,
    agent: look === 'working' ? (activeLease(item.lease, now)?.holder ?? null) : null,
    state,
    asks,
  };
}

// The branch of a turn: its links as chips, in the order the secretary linked them.
export function branchOf(turn: Turn, items: ReadonlyMap<string, Item>, now: number): Chip[] {
  return turn.links.map((id) => chipOf(id, items, now));
}

// The questions of agents (otea ask) that wait for the person on items this turn produced.
export function asksOf(turn: Turn, items: ReadonlyMap<string, Item>): Item[] {
  return turn.links.flatMap((id) => {
    const item = items.get(id);
    return item?.asks && item.turn === 'human' ? [item] : [];
  });
}

export type Filter = 'all' | 'request' | 'consultation';

// A card of «Lo que salió»: a request with its items, or a consultation with its answer.
export type Card = {
  root: number;
  kind: MessageKind;
  title: string;
  at: string;
  // A consultation's one-line answer.
  answer: string | null;
  chips: Chip[];
  // Some item of it asks you something: «te pregunta».
  asks: boolean;
};

export function titleOf(turn: Turn): string {
  const first = turn.person[0] ?? turn.messages[0];
  return first ? messageSnippet(first.text, 90) : '';
}

// The cards, newest first: every turn that is a request or a consultation and, for a request, has
// produced something (a request with nothing linked yet is still being worked out).
export function cardsOf(
  turns: readonly Turn[],
  items: ReadonlyMap<string, Item>,
  now: number,
  filter: Filter = 'all',
): Card[] {
  const cards: Card[] = [];
  for (const turn of turns) {
    const { kind } = turn;
    if (kind === null || (filter !== 'all' && kind !== filter)) continue;
    if (kind === 'request' && turn.links.length === 0) continue;
    const chips = kind === 'request' ? branchOf(turn, items, now) : [];
    const reply = turn.replies[0];
    cards.push({
      root: turn.root,
      kind,
      title: titleOf(turn),
      at: turn.at,
      answer: kind === 'consultation' && reply ? messageSnippet(reply.text, 140) : null,
      chips,
      asks: chips.some((chip) => chip.asks),
    });
  }
  return cards.reverse();
}

// How many of each kind the cards hold, for the filter's counts.
export function cardCounts(
  turns: readonly Turn[],
  items: ReadonlyMap<string, Item>,
  now: number,
): Record<Filter, number> {
  const all = cardsOf(turns, items, now);
  return {
    all: all.length,
    request: all.filter((card) => card.kind === 'request').length,
    consultation: all.filter((card) => card.kind === 'consultation').length,
  };
}

// The other kind: what one tap on the label turns a turn into.
export function otherKind(kind: MessageKind): MessageKind {
  return kind === 'request' ? 'consultation' : 'request';
}

// The turn a link points at: by the number of its message, or by the side topic it records.
export function turnAt(
  turns: readonly Turn[],
  at: { turn?: number | undefined; topic?: string | undefined },
): Turn | undefined {
  if (at.turn !== undefined) {
    const turn = at.turn;
    return turns.find((each) => each.root === turn || each.messages.some((m) => m.id === turn));
  }
  const topic = at.topic;
  return topic === undefined ? undefined : turns.find((each) => each.topic === topic);
}

// Whether the secretary is away, and since when: what the banner says.
export function awayOf(secretary: SecretaryStatus | null): { since: string | null } | null {
  return secretary?.state === 'offline' ? { since: secretary.since } : null;
}
