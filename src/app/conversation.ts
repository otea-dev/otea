import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  type FromMessage,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_FILES,
  type Message,
  type MessageAuthor,
  type MessageFile,
  type MessageKind,
  messageSnippet,
} from '../core/conversation.ts';
import { OteaError } from '../core/errors.ts';
import { evidenceTypeOf, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_MB } from '../core/evidence.ts';
import type { Actor } from '../core/item.ts';
import type { SecretaryStatus } from '../core/secretary.ts';
import { timeText } from '../core/time.ts';
import {
  countPending,
  insertAttachment,
  insertLink,
  insertMessage,
  latestOfTopic,
  latestPersonMessage,
  markRead,
  messageOfClientKey,
  type NewFile,
  type Page,
  selectMessage,
  selectMessages,
  selectPending,
  selectRootKind,
  selectTurnsOfItem,
  setKind,
} from '../store/conversation.ts';
import { transaction } from '../store/database.ts';
import type { Context } from './context.ts';
import { evidenceFile, namedReadPath, readEvidence, storeFile } from './evidence.ts';
import { type Clock, requireItem, systemClock } from './items.ts';
import type { Project } from './project.ts';
import { addSecretarySource, requireSecretary, secretaryStatus } from './secretary.ts';

// The conversation between the person and the project's secretary (core/conversation.ts).
//
// Who may write what is decided here, not by the callers: a message of the person's is made only by
// postPersonMessage, which only the desk's authenticated routes call (server/server.ts); the
// secretary's by sayAsSecretary, which refuses anyone who is not the declared secretary. No command
// of the command line or of MCP makes a person's message, so an agent can never post as the person.

// A file already read: its name and its bytes (what the desk's form and `otea say --file` hand in).
export type MessageFileInput = { filename: string; bytes: Buffer };

// How many messages one look at the conversation gives, unless it asks for fewer.
export const PAGE_SIZE = 50;

// What the secretary reads before the first message it has not read: the talk it answers into.
export const CONTEXT_SIZE = 5;

function invalid(message: string): never {
  throw new OteaError('invalid_fields', message);
}

function checkedText(text: string, files: readonly MessageFileInput[]): string {
  const trimmed = text.trim();
  if (trimmed === '' && files.length === 0) invalid('A message needs some text or a file');
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    invalid(
      `A message takes at most ${MAX_MESSAGE_CHARS} characters; put the rest in a file (--file)`,
    );
  }
  return trimmed;
}

function checkedFiles(files: readonly MessageFileInput[]): MessageFileInput[] {
  if (files.length > MAX_MESSAGE_FILES) invalid(`Send at most ${MAX_MESSAGE_FILES} files`);
  return files.map(({ filename, bytes }) => {
    const name = basename(filename.replaceAll('\\', '/'));
    if (name === '' || name === '.' || name === '..') invalid('Each file needs a name');
    if (bytes.length > MAX_EVIDENCE_BYTES) {
      throw new OteaError(
        'evidence_too_large',
        `${name} is over the ${MAX_EVIDENCE_MB} MB evidence limit`,
      );
    }
    return { filename: name, bytes };
  });
}

// The files, stored once by hash under evidence/ (as the items' evidence is), and their rows.
function keepFiles(project: Project, messageId: number, files: readonly MessageFileInput[]): void {
  for (const { filename, bytes } of files) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    storeFile(project.dataDir, sha256, bytes);
    const { kind, contentType } = evidenceTypeOf(filename);
    const file: NewFile = { name: filename, contentType, kind, size: bytes.length, sha256 };
    insertAttachment(project.db, messageId, file);
  }
}

// A file on the agent's disk, read for `otea say --file`, within the same limit as evidence.
export function messageFileAt(path: string): MessageFileInput {
  return { filename: basename(path), bytes: readEvidence(path) };
}

export function requireMessage(ctx: Context, id: number): Message {
  const message = selectMessage(ctx.db, id);
  if (!message) throw new OteaError('not_found', `Message ${id} not found`);
  return message;
}

// A message id as a person or an agent writes it: 12, #12 or m12.
export function messageIdOf(text: string): number {
  const id = Number(text.trim().replace(/^(#|m(sg)?-?)/i, ''));
  if (!Number.isInteger(id) || id < 1) {
    throw new OteaError(
      'invalid_fields',
      `Not a message number: ${text}. Pass the number, such as 12`,
    );
  }
  return id;
}

export type PostInput = {
  text: string;
  files?: MessageFileInput[];
  // The message it answers or follows up.
  replyTo?: number;
  // A phone that sends again what it never heard back about gets the first message, not a second.
  clientKey?: string;
  // The person's name as the desk shows it.
  by?: string;
};

// The person's message, to wait for the secretary: pending until it reads it. Only the desk's
// authenticated routes call this.
export function postPersonMessage(
  project: Project,
  input: PostInput,
  now: Clock = systemClock,
): { message: Message; replayed: boolean } {
  const files = checkedFiles(input.files ?? []);
  const text = checkedText(input.text, files);
  if (input.clientKey !== undefined) {
    const sent = messageOfClientKey(project.db, input.clientKey);
    const message = sent === undefined ? undefined : selectMessage(project.db, sent);
    if (message) return { message, replayed: true };
  }
  if (input.replyTo !== undefined) requireMessage(project, input.replyTo);
  const at = now();
  const id = transaction(project.db, () => {
    const made = insertMessage(project.db, {
      author: 'person',
      name: input.by ?? 'human',
      text,
      at,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...(input.clientKey === undefined ? {} : { clientKey: input.clientKey }),
    });
    keepFiles(project, made, files);
    return made;
  });
  return { message: requireMessage(project, id), replayed: false };
}

export type SayInput = {
  agent: string;
  text: string;
  files?: MessageFileInput[];
  replyTo?: number;
  // The turn is a request or a consultation. Without --reply-to it is the person's latest message.
  kind?: MessageKind;
  // The items (and the Pedidos of board drafts) it produced; they imply a request unless the turn
  // is already classified.
  links?: string[];
};

export type Said = {
  message: Message;
  // The kind the turn has now, and whether the person's own correction was kept instead of the one
  // asked for.
  kind: MessageKind | null;
  kept: boolean;
};

// Gives the turn a kind, unless the person set it (their correction stands). True when it did.
function classify(project: Project, root: number, kind: MessageKind): boolean {
  const current = selectRootKind(project.db, root);
  if (current.by === 'person' && current.kind !== null) return current.kind === kind;
  setKind(project.db, root, kind, 'secretary');
  return true;
}

function linkItems(project: Project, root: number, items: readonly string[], at: string): void {
  for (const id of items) insertLink(project.db, root, requireItem(project.db, id).id, at);
}

// The secretary's message: only the project's declared secretary says anything.
export function sayAsSecretary(project: Project, input: SayInput, now: Clock = systemClock): Said {
  requireSecretary(project.db, input.agent, 'speaks for the project (say)');
  const files = checkedFiles(input.files ?? []);
  const text = checkedText(input.text, files);
  const links = [...new Set((input.links ?? []).map((id) => id.trim()).filter((id) => id !== ''))];
  // Classifying or linking is about a turn of the person's: the latest one unless it says which.
  const classifies = input.kind !== undefined || links.length > 0;
  const replyTo = input.replyTo ?? (classifies ? latestPersonMessage(project.db) : undefined);
  if (classifies && replyTo === undefined) {
    invalid(
      'There is no message of the person to classify or link: say it with no --request, --consultation or --links',
    );
  }
  if (replyTo !== undefined) requireMessage(project, replyTo);
  for (const id of links) requireItem(project.db, id);
  const at = now();
  return transaction(project.db, () => {
    const id = insertMessage(project.db, {
      author: 'secretary',
      name: input.agent,
      text,
      at,
      read: true,
      ...(replyTo === undefined ? {} : { replyTo }),
    });
    keepFiles(project, id, files);
    const root = requireMessage(project, id).root;
    // Items linked to a turn not classified yet make it a request.
    const unclassified = links.length > 0 && selectRootKind(project.db, root).kind === null;
    const wanted = input.kind ?? (unclassified ? 'request' : undefined);
    const kept = wanted === undefined ? false : !classify(project, root, wanted);
    linkItems(project, root, links, at);
    const message = requireMessage(project, id);
    return { message, kind: message.kind, kept };
  });
}

// Links the turn a message belongs to with an item the secretary made out of it (otea create
// --from-message): the item says where it came from and the turn lists it. A turn not classified
// yet becomes a request.
export function linkMessageToItem(
  project: Project,
  agent: string,
  messageId: number,
  item: string,
  now: Clock = systemClock,
): Message {
  requireSecretary(project.db, agent, 'links the conversation to items');
  const message = requireMessage(project, messageId);
  return transaction(project.db, () => {
    linkItems(project, message.root, [item], now());
    if (selectRootKind(project.db, message.root).kind === null)
      classify(project, message.root, 'request');
    return requireMessage(project, messageId);
  });
}

// The person corrects what the secretary made of a turn, with one tap: it keeps the correction, and
// the secretary's later say of that turn does not undo it.
export function correctKind(project: Project, id: number, kind: MessageKind): Message {
  const message = requireMessage(project, id);
  setKind(project.db, message.root, kind, 'person');
  return requireMessage(project, id);
}

export type Look = {
  since?: number | undefined;
  before?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  kind?: MessageKind | undefined;
};

export type Conversation = {
  messages: Message[];
  // More messages lie beyond this page (after `since`, before `before`, else earlier than the first).
  more: boolean;
  // The secretary as M1 tells it, and how many of the person's messages wait for it.
  secretary: SecretaryStatus | null;
  waiting: { count: number; since: string | null };
};

function limitOf(limit: number | undefined): number {
  if (limit === undefined) return PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    invalid('limit is a number from 1 to 200');
  return limit;
}

// What the desk shows: the newest page (or the one after `since`, or before `before`), in order,
// beside the secretary's state and how many messages wait for it. Reading it marks nothing.
export function listConversation(
  project: Project,
  look: Look = {},
  now: Clock = systemClock,
): Conversation {
  const page: Page = { limit: limitOf(look.limit) };
  if (look.since !== undefined) page.since = look.since;
  if (look.before !== undefined) page.before = look.before;
  if (look.search !== undefined) page.search = look.search;
  if (look.kind !== undefined) page.kind = look.kind;
  if (look.since !== undefined && look.before !== undefined)
    invalid('Give since or before, not both');
  const { messages, more } = selectMessages(project.db, page);
  return {
    messages,
    more,
    secretary: secretaryStatus(project.db, now) ?? null,
    waiting: countPending(project.db),
  };
}

export type Read = {
  messages: Message[];
  // The person's messages this look marked as read.
  fresh: number[];
  more: boolean;
};

// The secretary reads the conversation, which marks the person's messages it returns as read. Without
// `since`: the person's unread messages (the few before them, for context), else the latest ones.
// With it: the messages after it. A look that does not reach every unread message leaves the rest
// pending, so the next one finds them.
export function readAsSecretary(
  project: Project,
  input: { agent: string; since?: number; limit?: number },
  now: Clock = systemClock,
): Read {
  requireSecretary(project.db, input.agent, 'reads the conversation');
  const limit = limitOf(input.limit);
  return transaction(project.db, () => {
    let messages: Message[];
    let more = false;
    if (input.since !== undefined) {
      ({ messages, more } = selectMessages(project.db, { since: input.since, limit }));
    } else {
      const first = selectPending(project.db)[0];
      if (first === undefined) {
        ({ messages } = selectMessages(project.db, { limit: Math.min(limit, CONTEXT_SIZE * 2) }));
      } else {
        const before = selectMessages(project.db, {
          before: first.id,
          limit: CONTEXT_SIZE,
        }).messages;
        const after = selectMessages(project.db, { since: first.id - 1, limit });
        messages = [...before, ...after.messages];
        more = after.more;
      }
    }
    const fresh = markRead(
      project.db,
      messages
        .filter(({ author, delivery }) => author === 'person' && delivery === 'pending')
        .map(({ id }) => id),
      now(),
    );
    const marked = new Set(fresh);
    const read = messages.map((message) =>
      marked.has(message.id) ? { ...message, delivery: 'read' as const, readAt: now() } : message,
    );
    return { messages: read, fresh, more };
  });
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The messages as the secretary reads them: plain text, each with its number, who wrote it and
// when, the kind and the items of its turn, and each file with a path it can open.
export function messagesText(
  project: Project,
  messages: readonly Message[],
  fresh: ReadonlySet<number>,
): string {
  return messages
    .map((message) => {
      const who = message.author === 'person' ? 'person' : `${message.author} ${message.by}`;
      const heads = [
        `${who}, ${timeText(message.at)}`,
        ...(message.replyTo === null ? [] : [`reply to ${message.replyTo}`]),
        ...(fresh.has(message.id) ? ['new'] : []),
        ...(message.kind === null
          ? []
          : [
              `${message.kind}${message.links.length === 0 ? '' : ` -> ${message.links.join(', ')}`}`,
            ]),
      ];
      const paths = attachmentPaths(project, message);
      const files = message.attachments.map((file) => {
        const path = paths.get(file.id);
        return `  attached: ${file.name} (${file.kind}, ${sizeText(file.size)})${path === undefined ? '' : `: ${path}`}`;
      });
      return [
        `[${message.id}] ${heads.join(', ')}`,
        ...message.text.split('\n').map((line) => `  ${line}`),
        ...files,
      ].join('\n');
    })
    .join('\n');
}

// What `otea conversation` prints: what is new, the talk before it, and how to answer.
export function conversationText(project: Project, agent: string, read: Read): string {
  const fresh = new Set(read.fresh);
  const last = read.messages.at(-1);
  const heading =
    fresh.size === 0 ? 'Nothing new from the person.' : `${fresh.size} new from the person.`;
  const more =
    read.more && last !== undefined
      ? [`More after message ${last.id}: otea conversation --since ${last.id} --as ${agent}`]
      : [];
  const answer =
    last === undefined
      ? []
      : [
          `Answer with: otea say "<text>" --reply-to ${last.id} --as ${agent}. Mark the turn a request with --request --links <item ids>, or a consultation (a question you answer) with --consultation; plain text with item ids, short, the conclusion first.`,
        ];
  return [
    heading,
    ...(read.messages.length === 0 ? [] : [messagesText(project, read.messages, fresh)]),
    ...more,
    ...answer,
  ].join('\n');
}

// A registered source of the secretary's wait: while the person has a message the secretary has not
// read, the wait returns it, from the messages' own state (not a signal that can be lost): it stops
// when the secretary reads them.
addSecretarySource((ctx) => {
  const pending = selectPending(ctx.db);
  const [first] = pending;
  if (first === undefined) return undefined;
  const more = pending.length > 1 ? ` (and ${pending.length - 1} more)` : '';
  return {
    kind: 'person_message',
    ref: String(first.id),
    text: `"${messageSnippet(first.text, 120)}"${more}`,
  };
});

// The turns an item came from, newest last: what show, next and the item's page tell. An item made
// with no message has none.
export function turnsOfItem(ctx: Context, item: string): FromMessage[] {
  return selectTurnsOfItem(ctx.db, item).map((message) => ({
    id: message.id,
    at: message.at,
    author: message.author,
    kind: message.kind,
    snippet: messageSnippet(message.text),
  }));
}

// What show and next say of where an item came from, or nothing.
export function fromMessageLine(turns: readonly FromMessage[]): string | undefined {
  if (turns.length === 0) return undefined;
  const said = turns.map(
    (turn) => `message ${turn.id}${turn.kind === null ? '' : ` (${turn.kind})`}: "${turn.snippet}"`,
  );
  return `Asked in the conversation, ${said.join('; ')}. Read the turn with otea conversation --since ${Math.max(0, (turns[0]?.id ?? 1) - 1)}.`;
}

// A topic's turn kept as a consultation: the question and the answer, in the conversation, so the
// consultations are what the topics were. They are the record of what otea topic holds (nothing
// to answer: already read), and never the person's own words unless the person wrote the topic.
export function mirrorTopicTurn(
  ctx: Context,
  turn: {
    topic: string;
    kind: 'question' | 'answer';
    text: string;
    actor: Actor;
    // The answer given again: replaces the text of the one kept.
    replace?: boolean;
  },
  now: Clock = systemClock,
): void {
  const latest = latestOfTopic(ctx.db, turn.topic);
  if (turn.replace && latest !== undefined) {
    ctx.db
      .prepare("UPDATE conversation_messages SET text = ? WHERE id = ? AND author = 'agent'")
      .run(turn.text, latest);
    return;
  }
  const author: MessageAuthor =
    turn.kind === 'answer' || turn.actor.kind === 'agent' ? 'agent' : 'person';
  const at = now();
  const id = insertMessage(ctx.db, {
    author,
    name: turn.actor.name,
    text: turn.text,
    at,
    read: true,
    topic: turn.topic,
    ...(latest === undefined ? {} : { replyTo: latest }),
  });
  const root = selectMessage(ctx.db, id)?.root ?? id;
  if (selectRootKind(ctx.db, root).kind === null) setKind(ctx.db, root, 'consultation', 'topic');
}

// The consultations, newest last: each a question and its answer, the topics of before. A search
// keeps those whose words are in it.
export function listConsultations(project: Project, search?: string, limit?: number): Conversation {
  return listConversation(project, {
    kind: 'consultation',
    ...(search === undefined ? {} : { search }),
    ...(limit === undefined ? {} : { limit }),
  });
}

// One attachment as the desk serves it: its entry and the stored file's path.
export function attachmentToServe(
  project: Project,
  id: string,
): { file: MessageFile & { messageId: number }; path: string } {
  const row = /^[1-9]\d{0,14}$/.test(id)
    ? (project.db
        .prepare(
          `SELECT id, message_id AS messageId, filename AS name, content_type AS contentType, kind, size, sha256
           FROM conversation_attachments WHERE id = ?`,
        )
        .get(Number(id)) as (MessageFile & { messageId: number }) | undefined)
    : undefined;
  const path = row && evidenceFile(project.dataDir, row.sha256);
  if (!row || !path || !existsSync(path)) {
    throw new OteaError('not_found', `Attachment "${id}" not found`);
  }
  return { file: row, path };
}

// A path an agent can open for each attachment of a message: the stored file under the name it came
// with, in files/m<its number>/.
export function attachmentPaths(project: Project, message: Message): Map<number, string> {
  const paths = new Map<number, string>();
  for (const file of message.attachments) {
    const path = namedReadPath(project.dataDir, `m${file.id}`, {
      sha256: file.sha256,
      filename: file.name,
    });
    if (path !== undefined) paths.set(file.id, path);
  }
  return paths;
}
