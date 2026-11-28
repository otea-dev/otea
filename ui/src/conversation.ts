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
export { messageSnippet };

// A snippet of a message to quote in one line («sobre «…»», a title): the code marks of its backticks
// go, as a cut in the middle of a span would leave a backtick with no mate.
export function quotedSnippet(text: string, max: number): string {
  return messageSnippet(text.replaceAll('`', ''), max);
}

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
  // Who set the kind: a kind the person set (a correction) stays whatever the secretary says.
  kindBy: Message['kindBy'];
  // The items (and board drafts) it produced.
  links: string[];
  // The side topic this turn is the record of (TEM-3), when it is.
  topic: string | null;
  at: string;
  // The last message is the person's: still on its way (pending), or heard or read and not answered
  // yet (reading, the secretary holds the turn).
  waits: 'pending' | 'reading' | null;
};

// The messages of every page loaded, once each by id, in order. A later list wins: a message read
// since or a turn corrected shows as it stands now.
export function mergeMessages(...lists: readonly (readonly Message[])[]): Message[] {
  const byId = new Map<number, Message>();
  for (const list of lists) for (const message of list) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// A message of the person's that only records what they chose on an agent's question on an item or
// a Bandeja note: it is in the thread so they can see it, and asks nothing of anyone.
export function isTrace(message: Message): boolean {
  return message.choice !== null && message.choice.about !== null;
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
    // A trace of an answer given to an agent's question is read at once and asks nothing of the
    // secretary; any other message of the person's is heard, then read, then answered.
    const heard = last.delivery !== 'pending' || last.heardAt !== null;
    // Items made from the turn are an answer as much as words: the secretary's wait counts it so
    // too (selectOwed), and the desk never says «no ha respondido» under it (field study 5, V4).
    const made = group.some((m) => m.links.length > 0);
    const waits =
      last.author !== 'person' || isTrace(last) || (made && heard)
        ? null
        : heard
          ? 'reading'
          : 'pending';
    turns.push({
      root,
      messages: group,
      person,
      replies: group.filter((m) => m.author !== 'person'),
      // The turn's kind and links are shown on each of its messages; one that was read before
      // the secretary classified the turn still has none.
      kind: group.findLast((m) => m.kind !== null)?.kind ?? null,
      kindBy: group.findLast((m) => m.kind !== null)?.kindBy ?? null,
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
  now: number = Date.now(),
): number | undefined {
  if (!secretary || secretary.state === 'offline') return undefined;
  const turn = turns.findLast((each) => each.waits === 'reading');
  if (turn === undefined || secretary.state !== 'listening') return turn?.root;
  // A secretary in its wait holds nothing: the wait brings back a message read and not answered
  // within seconds (U6, field study 4). If it is still here after that, nobody holds it.
  const last = turn.messages.at(-1);
  const since = Date.parse(last?.heardAt ?? last?.readAt ?? last?.at ?? '');
  return Number.isNaN(since) || now - since >= LISTENING_QUIET_MS ? turn.root : undefined;
}

// How long a message may stay read and unanswered while the secretary listens before the desk says
// it has not answered (its wait brings the message back well within it).
export const LISTENING_QUIET_MS = 20_000;

// How much of a reply shows before «ver más»: the first line (the conclusion), then at most this
// many short lines. It is the secretary's own rule (its text, `otea prompt --role secretary`: one
// line, then at most 3 short lines, anything longer as a file or on the item); the page folds a
// reply that breaks it. A line is short up to about 80 characters, so the rest is 240 at most.
// Blank lines between paragraphs are not lines.
export const FOLD_LINES = 3;
export const FOLD_CHARS = 240;

export type Reply = {
  // The one-line conclusion.
  lead: string;
  // The rest, apart from the lead.
  rest: string;
  // The rest is long: it folds behind «ver más».
  folds: boolean;
};

// The most a conclusion is, in characters: a headline, never a paragraph.
export const LEAD_CHARS = 140;

// Words after which a full stop does not end a sentence (e.g., p. ej., etc., vs.), and a bare
// number: the «1.» of a list item.
const ABBREVIATIONS =
  /(?:^|\s)(?:[A-Za-zÁÉÍÓÚáéíóú]|\d+|e\.g|i\.e|ej|etc|vs|sr|sra|dr|dra|aprox|nº)$/i;

// Where the first sentence of a line ends: after . ! ? or … followed by a space or the end, and not
// at an abbreviation. A line with no such end is one sentence.
function sentenceEnd(line: string): number {
  for (const match of line.matchAll(/[.!?…]+(?=\s|$)/g)) {
    const end = match.index + match[0].length;
    if (match[0] === '.' && ABBREVIATIONS.test(line.slice(0, match.index))) continue;
    return end;
  }
  return line.length;
}

// A reply as the page sets it: the conclusion is the first sentence only (cut at a word when it is
// itself too long), whatever the reply's lines are; the rest is body text.
export function splitReply(text: string): Reply {
  const trimmed = text.trim();
  const cut = trimmed.indexOf('\n');
  const first = (cut < 0 ? trimmed : trimmed.slice(0, cut)).trim();
  const below = cut < 0 ? '' : trimmed.slice(cut + 1).trim();
  let end = sentenceEnd(first);
  let lead = first.slice(0, end).trim();
  let skip = 0;
  if (lead.length > LEAD_CHARS) {
    // Too long for a headline: it ends where its thought turns (the last comma, semicolon, colon or
    // dash within the budget, past its first words), never cut mid-clause with a mark, which left
    // the last words falling to the body. With no such turn it stays whole.
    const budget = lead.slice(0, LEAD_CHARS + 1);
    const turn = [...budget.matchAll(/[,;:]\s|\s[—–]\s/g)].findLast(({ index }) => index >= 40);
    if (turn) {
      end = turn.index;
      lead = first.slice(0, end).trim();
      skip = turn[0].length;
    }
  }
  const remainder = first.slice(end + skip).trim();
  const rest = [remainder, below].filter((part) => part !== '').join('\n');
  const lines = rest.split(/\r?\n/).filter((line) => line.trim() !== '').length;
  return { lead, rest, folds: lines > FOLD_LINES || rest.length > FOLD_CHARS };
}

// What a question to you leads with: the question itself (its last sentence that ends in «?», from
// its «¿» when it has one), never the sentence that happens to come first. The buttons under a card
// answer it, so it is read before them; the context (what was approved, what it would change) is
// what folds. A text with no such question, or whose question already leads, is set as any reply.
export function splitQuestion(text: string): Reply {
  const usual = splitReply(text);
  const lines = text.trim().split(/\r?\n/);
  let found: { line: number; from: number; to: number } | undefined;
  for (const [at, line] of lines.entries()) {
    let from = 0;
    while (from < line.length) {
      const end = from + sentenceEnd(line.slice(from));
      const sentence = line.slice(from, end);
      if (/[?？]\s*$/.test(sentence)) {
        found = { line: at, from: from + Math.max(0, sentence.lastIndexOf('¿')), to: end };
      }
      from = end;
      while (line[from] === ' ') from += 1;
    }
  }
  if (!found) return usual;
  const question = (lines[found.line] ?? '').slice(found.from, found.to).trim();
  // The question already is the first sentence.
  if (found.line === 0 && found.from === 0) return usual;
  const context = lines
    .map((line, at) =>
      at === found?.line
        ? `${line.slice(0, found.from)}${line.slice(found.to)}`.trim()
        : line.trim(),
    )
    .filter((line) => line !== '')
    .join('\n');
  return { lead: question, rest: context, folds: context !== '' };
}

// A text to copy inside a message: what the secretary pastes for another session to read (the
// text of a worker or a refiner, when its harness cannot launch subagents). The secretary sets
// each in a fenced block under its number (the secretary text says so); the page draws it apart,
// with the line above as its caption and a button that copies it, and never folds it.
// `number` is the secretary's own (the «2.» of «2. Refinador:»), `caption` the words after it.
export type TextBlock = { number: number; caption: string; text: string };

// Where a fenced block opens and closes in a list of lines: the fence is three backticks or more,
// and only a line of at least as many closes it, so a block can hold a shorter fence. A fence that
// never closes is not one. `at` is the line it opens on, `end` the line that closes it.
function fenceAt(lines: readonly string[], at: number): { end: number; inner: string[] } | null {
  const open = /^\s*(`{3,})/.exec(lines[at] ?? '');
  if (!open?.[1]) return null;
  const size = open[1].length;
  const close = new RegExp(`^\\s*\`{${size},}\\s*$`);
  const end = lines.findIndex((line, index) => index > at && close.test(line));
  return end < 0 ? null : { end, inner: lines.slice(at + 1, end) };
}

// The numbered line of words above a block of text to paste: «1. Trabajador de Cambios: …».
const NUMBERED = /^\s*(\d+)[.)]\s*(.*)$/;

// Only a fenced block under a numbered line is a text to paste (the secretary's rule for the
// sessions it asks the person to open); any other fence is a code block of an ordinary reply and
// stays in its words.
export function blocksOf(text: string): { rest: string; blocks: TextBlock[] } {
  const lines = text.split(/\r?\n/);
  const rest: string[] = [];
  const blocks: TextBlock[] = [];
  // Lines of words since the last block: its caption comes from them, never from what stands
  // above an earlier block.
  let since = 0;
  let at = 0;
  while (at < lines.length) {
    const fence = fenceAt(lines, at);
    if (fence) {
      let caption: RegExpExecArray | null = null;
      let blanks = 0;
      while (since > blanks && (rest[rest.length - 1 - blanks] ?? '').trim() === '') blanks += 1;
      if (since > blanks) caption = NUMBERED.exec(rest[rest.length - 1 - blanks] ?? '');
      if (caption) {
        rest.length -= blanks + 1;
        blocks.push({
          number: Number(caption[1]),
          caption: (caption[2] ?? '').trim(),
          text: fence.inner.join('\n'),
        });
        since = 0;
        at = fence.end + 1;
        continue;
      }
      // An ordinary code block: its lines stay with the words.
      rest.push(...lines.slice(at, fence.end + 1));
      since += fence.end + 1 - at;
      at = fence.end + 1;
      continue;
    }
    rest.push(lines[at] ?? '');
    since += 1;
    at += 1;
  }
  return blocks.length === 0 ? { rest: text, blocks } : { rest: rest.join('\n').trim(), blocks };
}

// A text as words and code, in order: the code of an ordinary reply is drawn as code.
export function fencesOf(text: string): { code: boolean; text: string }[] {
  const lines = text.split(/\r?\n/);
  const parts: { code: boolean; text: string }[] = [];
  let words: string[] = [];
  const flush = () => {
    const joined = words.join('\n').trim();
    if (joined !== '') parts.push({ code: false, text: joined });
    words = [];
  };
  let at = 0;
  while (at < lines.length) {
    const fence = fenceAt(lines, at);
    if (fence) {
      flush();
      parts.push({ code: true, text: fence.inner.join('\n') });
      at = fence.end + 1;
    } else {
      words.push(lines[at] ?? '');
      at += 1;
    }
  }
  flush();
  return parts;
}

// The text as pieces: item ids of this project (they link to the item), web addresses (they open),
// and plain words. Messages are plain text; nothing is rendered as markup.
export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'item'; id: string }
  | { kind: 'url'; url: string };

// An item id is a word of its own: inside a branch name or a path (change/CHA-5-undo-delete) it is
// not one.
const WORDS =
  /(https?:\/\/[^\s<>"')\]]+)|((?<![\w/.-])[A-Za-z][A-Za-z0-9]*-\d+(?![\w/]|-[A-Za-z0-9]))/g;
const TRAILING = /[.,;:!?]+$/;

// A word that looks like an item id after «carpeta» or «folder»: the name of a folder (a test's
// working folder is often called as the item), not the item.
const FOLDER = /(?:carpeta|folder|directorio|directory|ruta|path)\s+$/i;
const namesAFolder = (text: string, at: number): boolean =>
  FOLDER.test(text.slice(Math.max(0, at - 16), at));

export function piecesOf(text: string, known: ReadonlySet<string>): Piece[] {
  const out: Piece[] = [];
  let from = 0;
  for (const match of text.matchAll(WORDS)) {
    const at = match.index;
    const [found, address] = match;
    const isItem = address === undefined && known.has(found) && !namesAFolder(text, at);
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

// A link piece with the marks that hold to it: «(CAM-1),» is one unbreakable unit, so a line never
// ends on a lone «(» nor starts with a lone «)».
export type Glued =
  | { kind: 'text'; text: string }
  | { kind: 'item'; id: string; open?: string; close?: string }
  | { kind: 'url'; url: string };

const OPENING = /[([«“"¿¡]+$/;
const CLOSING = /^[)\]»”",.;:!?…]+/;

export function gluePunctuation(pieces: readonly Piece[]): Glued[] {
  const out: Glued[] = pieces.map((piece) => ({ ...piece }));
  const text = (at: number) => {
    const piece = out[at];
    return piece?.kind === 'text' ? piece : undefined;
  };
  out.forEach((piece, at) => {
    // An address is long and breaks where it must: only an id holds its marks.
    if (piece.kind !== 'item') return;
    const before = text(at - 1);
    const open = before ? OPENING.exec(before.text)?.[0] : undefined;
    const after = text(at + 1);
    const close = after ? CLOSING.exec(after.text)?.[0] : undefined;
    if (before && open) before.text = before.text.slice(0, -open.length);
    if (after && close) after.text = after.text.slice(close.length);
    if (open) piece.open = open;
    if (close) piece.close = close;
  });
  return out.filter((piece) => piece.kind !== 'text' || piece.text !== '');
}

// The words of a message and, between backticks, the code the secretary wrote: `otea pending` is
// drawn as code, not with its marks. A backtick with no mate stays a backtick.
export function codeSpans(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  let from = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index > from) parts.push({ code: false, text: text.slice(from, match.index) });
    parts.push({ code: true, text: match[1] ?? '' });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ code: false, text: text.slice(from) });
  return parts;
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
  // The items an approved item waits for, or merges main after: the word names them.
  first?: string;
};

export type StateWord =
  | 'hablar.st.waits'
  | 'hablar.st.merging'
  | 'hablar.st.working'
  | 'hablar.st.queued'
  | 'hablar.st.waiting'
  | 'hablar.st.stuck'
  | 'hablar.st.aside'
  | 'hablar.st.landing'
  | 'hablar.st.bounced'
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
  // A set-aside item is not queued, an approved one is not done until it lands, and one an agent took
  // back after approving it says why it is on its step again (H2, field study 4).
  const waits = item.turn === 'agent' && !activeLease(item.lease, now);
  const state: StateWord = asks
    ? 'hablar.st.asks'
    : look === 'yours'
      ? 'hablar.st.yours'
      : waits && item.setAside
        ? 'hablar.st.aside'
        : item.landing && item.landsAfter?.overlap
          ? 'hablar.st.waits'
          : item.merging && look !== 'working'
            ? 'hablar.st.merging'
            : item.landing
              ? 'hablar.st.landing'
              : item.bounced && look !== 'working'
                ? 'hablar.st.bounced'
                : (`hablar.st.${look}` as StateWord);
  return {
    id,
    look,
    title: item.title,
    agent: look === 'working' ? (activeLease(item.lease, now)?.holder ?? null) : null,
    state,
    asks,
    ...(state === 'hablar.st.waits' && item.landsAfter ? { first: item.landsAfter.first } : {}),
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
  // Null: the secretary answered the turn and never said what it is; one tap on the card sets it.
  kind: MessageKind | null;
  title: string;
  at: string;
  // A consultation's one-line answer.
  answer: string | null;
  chips: Chip[];
  // Some item of it asks you something: «te pregunta».
  asks: boolean;
  // A request you set yourself that nothing came out of yet: the secretary is taking it.
  taking: boolean;
  // A consultation (you corrected it from a request) whose items are still open: the card says
  // they are waiting for the secretary to set them aside.
  leftover: boolean;
};

const isOpenLook = (look: Look): boolean => look !== 'done' && look !== 'dropped';

export function titleOf(turn: Turn): string {
  // A turn the secretary began with a question: it is titled by that question, not by the person's
  // tap on one of its options («Sí, encárgalo»).
  const root = turn.messages[0];
  if (root && root.author !== 'person' && root.options.length > 0) {
    return quotedSnippet(splitQuestion(root.text).lead, 90);
  }
  const first = turn.person[0] ?? turn.messages[0];
  return first ? quotedSnippet(first.text, 90) : '';
}

// A turn the person began and the secretary answered, and never classified: ordinary talk it did
// not mark, or a request it forgot to. A turn still on its way (unanswered), a trace of a tap, one
// a secretary's question began and a side topic's record are not this.
function isUnclassified(turn: Turn): boolean {
  const root = turn.messages[0];
  return (
    turn.kind === null &&
    turn.waits === null &&
    turn.topic === null &&
    root?.author === 'person' &&
    root.choice === null &&
    turn.replies.length > 0
  );
}

function unclassifiedCard(turn: Turn, items: ReadonlyMap<string, Item>, now: number): Card {
  const reply = turn.replies[0];
  return {
    root: turn.root,
    kind: null,
    title: titleOf(turn),
    at: turn.at,
    answer: reply ? quotedSnippet(reply.text, 140) : null,
    chips: branchOf(turn, items, now),
    asks: false,
    taking: false,
    leftover: false,
  };
}

// The cards, newest first: every turn that is a request or a consultation and, for a request, has
// produced something (a request with nothing linked yet is still being worked out), unless it is
// one the person made themselves by correcting a consultation: that one stays in sight, saying the
// secretary is taking it.
export function cardsOf(
  turns: readonly Turn[],
  items: ReadonlyMap<string, Item>,
  now: number,
  filter: Filter = 'all',
): Card[] {
  const cards: Card[] = [];
  for (const turn of turns) {
    const { kind } = turn;
    if (kind === null) {
      if (filter === 'all' && isUnclassified(turn)) cards.push(unclassifiedCard(turn, items, now));
      continue;
    }
    if (filter !== 'all' && kind !== filter) continue;
    const taking = kind === 'request' && turn.links.length === 0 && turn.kindBy === 'person';
    if (kind === 'request' && turn.links.length === 0 && !taking) continue;
    // What came out of a turn stays with it when the person corrects a request to a consultation:
    // those items exist, and the card says they are still there (`leftover`).
    const chips = branchOf(turn, items, now);
    const reply = turn.replies[0];
    cards.push({
      root: turn.root,
      kind,
      title: titleOf(turn),
      at: turn.at,
      answer: kind === 'consultation' && reply ? quotedSnippet(reply.text, 140) : null,
      chips,
      asks: chips.some((chip) => chip.asks),
      taking,
      leftover:
        kind === 'consultation' &&
        chips.some((chip) => chip.look !== null && isOpenLook(chip.look)),
    });
  }
  return cards.reverse();
}

// What the thread is, row by row, in the order things were said. A turn groups what belongs
// together (the kind, the branch of items), never where it is drawn: a message stands where it was
// said, whatever it answers.
export type Row =
  | { type: 'person'; message: Message; turn: Turn }
  | {
      type: 'reply';
      message: Message;
      turn: Turn;
      // The first reply of its turn: it carries the turn's kind and its branch of items.
      head: boolean;
      // The older message it answers, when it is not the one right above it.
      answers: Message | null;
      // A question with options to tap: open until the person has replied to it.
      // `closed`: the secretary withdrew it, or what it asked was settled some other way.
      question: 'open' | 'answered' | 'closed' | null;
    }
  // What the person chose or answered: their own row.
  | { type: 'choice'; message: Message; turn: Turn; asked: Message | null };

export function rowsOf(messages: readonly Message[], turns: readonly Turn[]): Row[] {
  const byRoot = new Map(turns.map((turn) => [turn.root, turn]));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  return sorted.flatMap((message, index): Row[] => {
    const turn = byRoot.get(message.root);
    if (!turn) return [];
    if (message.choice !== null) {
      return [
        {
          type: 'choice',
          message,
          turn,
          asked: message.replyTo === null ? null : (byId.get(message.replyTo) ?? null),
        },
      ];
    }
    if (message.author === 'person') return [{ type: 'person', message, turn }];
    const above = sorted[index - 1];
    const answers =
      message.replyTo === null || above?.id === message.replyTo
        ? null
        : (byId.get(message.replyTo) ?? null);
    // Answered by a reply to this very question; anything else the person says leaves it open.
    const spoke = sorted.some((each) => each.author === 'person' && each.replyTo === message.id);
    return [
      {
        type: 'reply',
        message,
        turn,
        head: turn.replies[0]?.id === message.id,
        answers,
        question:
          message.options.length === 0
            ? null
            : spoke
              ? 'answered'
              : message.closed !== null
                ? 'closed'
                : 'open',
      },
    ];
  });
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
