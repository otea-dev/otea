import type { AnswerMode } from './board/questions.ts';
import type { EvidenceKind } from './evidence.ts';

// The conversation (0.8): the project's one chat between the person and its secretary, kept by
// Otea. The person posts only through the desk's authenticated routes; the secretary reads and
// answers with `otea conversation` and `otea say`. Messages are plain text (item ids stay as typed,
// nothing is rendered), each with its attachments, and the person's carry a delivery state.

// Who wrote it: the person (desk route only), the project's secretary (otea say), or, for the topics
// that now live as consultations (app/topics.ts), the agent that recorded or answered one.
export const MESSAGE_AUTHORS = ['person', 'secretary', 'agent'] as const;

export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

// What a turn is, as the secretary classified it and the person may correct with one tap:
//   request       the person asked for work: the items and board drafts it produced are linked
//   consultation  the person asked a question: the question and the answer are kept (what the side
//                 topics were)
// A message with no kind is not classified (yet): ordinary talk.
export const MESSAGE_KINDS = ['request', 'consultation'] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === 'string' && (MESSAGE_KINDS as readonly string[]).includes(value);
}

// Who set the kind: the secretary, the person correcting it (which the secretary then keeps), or
// otea topic, which records a side topic as a consultation.
export type KindBy = 'secretary' | 'person' | 'topic';

// The person's messages are pending until the secretary read them.
export type Delivery = 'pending' | 'read';

export const MAX_MESSAGE_CHARS = 20_000;

// At most this many files come with one message, each within the evidence limit.
export const MAX_MESSAGE_FILES = 10;

export type MessageFile = {
  id: number;
  name: string;
  contentType: string;
  kind: EvidenceKind;
  size: number;
  sha256: string;
};

// How the person answered a question: tapped one of its options, wrote their own words, or left the
// decision to whoever asked (as an agent's question on an item is answered).
export type { AnswerMode };

// A message of the person's that is an answer to a question. `about` and `asked` are set when it
// only records an answer given to an agent's question on an item or a Bandeja entry (CAM-1, B-3): a
// trace in the thread, read at once, that wakes nobody; they are null when it answers a question
// of the secretary's own, which it wakes.
export type MessageChoice = {
  mode: AnswerMode;
  option: number | null;
  about: string | null;
  asked: string | null;
};

// What the person's tap on the first option of a question performs, as the person: the send-back or
// the discard of an item in their review, with the note the secretary drafted from their words (the
// person may edit it before they tap). The secretary never performs it, and nothing else takes an
// item out of their review (a relay never does).
// `round`: the round of the item's review when the card was asked: the tap is about that delivery.
// `to`: the name of the step it goes back to (a send-back) or the motive it is dropped with (a
// discard, empty when the board has none), which the desk says in its own words beside the first
// option (never the secretary's label).
export const ACTION_KINDS = ['send_back', 'drop'] as const;
export type MessageAction = {
  kind: (typeof ACTION_KINDS)[number];
  item: string;
  note: string;
  round: number;
  to: string;
  // A discard on a board with motives: the one it goes with, by name.
  motive?: string;
};

export type Message = {
  id: number;
  author: MessageAuthor;
  // The agent's name for the secretary and an agent; the person's own for the person.
  by: string;
  text: string;
  at: string;
  // The message it answers, when it answers one.
  replyTo: number | null;
  // The turn it belongs to: the person's message that began it (a secretary message is in the turn
  // of the one it answers; one that answers nothing begins its own). The kind and the links are the
  // turn's, shown on each of its messages.
  root: number;
  kind: MessageKind | null;
  kindBy: KindBy | null;
  // The items (and the Pedidos of board drafts) the turn produced.
  links: string[];
  attachments: MessageFile[];
  // The person's messages only (null for the others): pending until the secretary read it.
  delivery: Delivery | null;
  readAt: string | null;
  // The side topic this message is the record of, when it is (a consultation made by otea topic).
  topic: string | null;
  // A question of the secretary's with 2 to 4 options to tap (and the one it recommends), and the
  // person's answer to one (or to an agent's, as a trace).
  options: string[];
  recommended: number | null;
  // What the first option does when the person taps it, when the question carries an action.
  action: MessageAction | null;
  // The secretary's message that Otea could not tie to the session noted for it (the desk marks it).
  unverified: boolean;
  // The numbers (from 1) of the options that need the person's own words: tapping one opens the
  // text box instead of answering at once.
  optionText: number[];
  // A question that stopped being asked: withdrawn by the secretary, or settled by what the person
  // did (it sent the item back, the turn became an item). It no longer waits for them.
  closed: { at: string; why: string } | null;
  choice: MessageChoice | null;
  // The person's messages only: when the secretary's wait returned it, before it read it.
  heardAt: string | null;
  // The turn's kind was changed by the person and the secretary has not read that yet.
  kindNews: boolean;
};

// The first line of a message, shortened: what lists, wake-ups and backlinks quote.
export function messageSnippet(text: string, max = 100): string {
  const line = (text.trim().split(/\r?\n/)[0] ?? '').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

// The item or draft's side of a link: the turn it came from.
export type FromMessage = {
  id: number;
  at: string;
  author: MessageAuthor;
  kind: MessageKind | null;
  snippet: string;
};
