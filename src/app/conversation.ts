import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Performer } from '../core/authority.ts';
import { checkOptions, DELEGATED } from '../core/board/questions.ts';
import {
  type AnswerMode,
  type FromMessage,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_FILES,
  type Message,
  type MessageAction,
  type MessageAuthor,
  type MessageFile,
  type MessageKind,
  messageSnippet,
} from '../core/conversation.ts';
import { OteaError } from '../core/errors.ts';
import { evidenceTypeOf, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_MB } from '../core/evidence.ts';
import type { Actor } from '../core/item.ts';
import { plainLine, quoteAgent } from '../core/quote.ts';
import type { SecretaryView, SecretaryWaiting } from '../core/secretary.ts';
import { clockText, timeText } from '../core/time.ts';
import { selectEntryOfItem } from '../store/bandeja.ts';
import {
  clearKindNews,
  closeQuestions,
  countPending,
  deleteMessage,
  insertAttachment,
  insertLink,
  insertMessage,
  isAnswered,
  latestOfTopic,
  markRead,
  messageOfClientKey,
  type NewFile,
  type Page,
  selectAnswerOf,
  selectDefaultTurn,
  selectKindNews,
  selectLastTraceOf,
  selectLatestUnanswered,
  selectMessage,
  selectMessages,
  selectOpenQuestions,
  selectPending,
  selectRootKind,
  selectTurn,
  selectTurnsOfItem,
  setKind,
} from '../store/conversation.ts';
import { joinTransaction, transaction } from '../store/database.ts';
import { selectEvidence } from '../store/queries.ts';
import type { Context } from './context.ts';
import {
  evidenceFile,
  namedReadPath,
  placeFile,
  readEvidence,
  recordEvidence,
  storeFile,
} from './evidence.ts';
import { type Clock, requireItem, requireWritableItem, systemClock } from './items.ts';
import type { Project } from './project.ts';
import { addSecretarySource, requireSecretary } from './secretary.ts';
import { secretaryView } from './secretary-waiting.ts';

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

// The most a name to show keeps; longer is cut, its extension kept.
const MAX_NAME = 200;

function cutName(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return `${name.slice(0, MAX_NAME - extension.length - 1)}…${extension}`;
}

function checkedFiles(files: readonly MessageFileInput[]): MessageFileInput[] {
  if (files.length > MAX_MESSAGE_FILES) invalid(`Send at most ${MAX_MESSAGE_FILES} files`);
  return files.map(({ filename, bytes }) => {
    // The name to show: as it came, its folder dropped, a lone space or a very long one made fit.
    // The path an agent opens is made safe apart from it (core/evidence.ts safeFileName).
    const shown = basename(filename.replaceAll('\\', '/')).trim();
    if (shown === '.' || shown === '..') invalid('Each file needs a name');
    const name = shown === '' ? 'file' : shown.length > MAX_NAME ? cutName(shown) : shown;
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
  // The key counts per `scope` (the device, or the desk's session); the same key with another
  // message is refused, not answered with the first.
  clientKey?: { scope: string; key: string };
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
  const client =
    input.clientKey === undefined
      ? undefined
      : {
          ...input.clientKey,
          digest: createHash('sha256')
            .update(
              JSON.stringify([
                text,
                input.replyTo ?? null,
                files.map(({ filename, bytes }) => [
                  filename,
                  createHash('sha256').update(bytes).digest('hex'),
                ]),
              ]),
            )
            .digest('hex'),
        };
  if (client !== undefined) {
    const sent = messageOfClientKey(project.db, client.scope, client.key);
    if (sent !== undefined) {
      if (sent.digest !== client.digest) {
        throw new OteaError(
          'already_exists',
          'This Idempotency-Key already sent another message: send this one under a new key',
        );
      }
      const message = selectMessage(project.db, sent.id);
      if (message) return { message, replayed: true };
    }
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
      client,
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
  // The items (and the Pedidos of board drafts) it produced; with --reply-to they imply a request
  // unless the turn is already classified. Without --reply-to the message is a notice and the items
  // are what it mentions: they never become the origin of anything.
  links?: string[];
  // A question with 2 to 4 options to tap, and the number of the one the secretary recommends.
  options?: readonly string[];
  recommended?: number;
  // What the person's tap on the FIRST option performs for them (their send-back of an item in
  // their review, with a note the secretary drafted from their words). It needs the options: the
  // first does it, the others only answer. Only the person's tap performs it (conversation-act.ts).
  action?: MessageAction;
  // The numbers (from 1) of the options that need the person's own words ("I'll explain when I
  // answer"): tapping one opens the text box instead of answering at once.
  optionText?: readonly number[];
  // Otea could not tie this to the session noted for the secretary: the desk marks it.
  unverified?: boolean;
};

export type Said = {
  message: Message;
  // The kind the turn has now, and whether the person's own correction was kept instead of the one
  // asked for.
  kind: MessageKind | null;
  kept: boolean;
  // What was said but not done: a link that cannot hang from the message it answers. A `say` posts
  // whatever it can and warns, never failing for it (the person waited ten minutes on «pensando…»
  // for an answer a refused link kept from posting).
  warnings: string[];
};

// Gives the turn a kind, unless the person set it (their correction stands). True when it did. A
// kind the secretary already gave is not turned into the other by saying something else about the
// turn (a notice about items is a message of its own), and a notice has no kind.
function classify(project: Project, root: number, kind: MessageKind): boolean {
  const current = selectRootKind(project.db, root);
  if (current.by === 'person' && current.kind !== null) return current.kind === kind;
  if (current.kind !== null && current.kind !== kind) {
    invalid(
      `Message ${root} is already a ${current.kind}: saying more about it does not make it a ${kind} (the person corrects a kind with one tap). To tell them about items, send a notice: otea say "<text>" --links <item ids> with no --reply-to`,
    );
  }
  if (selectMessage(project.db, root)?.author === 'secretary') {
    invalid(
      `Message ${root} is your own notice, and a notice has no kind: say it about the person's message it follows`,
    );
  }
  setKind(project.db, root, kind, 'secretary');
  return true;
}

// `made`: the items were made from the turn (create --from-message). Otherwise an item counts as
// made when it was created after the turn began, as the secretary does when it makes the item and
// then says so; an older one is only mentioned (D-274c07).
function linkItems(
  project: Project,
  root: number,
  items: readonly string[],
  at: string,
  made = false,
): string[] {
  const began = selectMessage(project.db, root)?.at;
  for (const id of items) {
    const item = requireItem(project.db, id);
    insertLink(
      project.db,
      root,
      item.id,
      at,
      made || (began !== undefined && item.createdAt >= began),
    );
  }
  return carryFiles(project, root, items, at);
}

// What the person sent in a turn belongs to what the turn became: the files of their messages (a
// photo of the problem) go with each item made from it, as the person's own evidence, so the worker
// that opens the item sees them (field study 7). A file the item already holds is not added twice.
// An item that cannot take them (closed, archived, the part that takes them is full) is still linked:
// the reason comes back as a warning for the secretary to tell the person.
function carryFiles(
  project: Project,
  root: number,
  items: readonly string[],
  at: string,
): string[] {
  const sent = selectTurn(project.db, root)
    .filter(({ author }) => author === 'person')
    .flatMap(({ attachments }) => attachments);
  if (sent.length === 0) return [];
  const warnings: string[] = [];
  for (const id of items) {
    const item = requireItem(project.db, id);
    const held = new Set(selectEvidence(project.db, item.id).map(({ sha256 }) => sha256));
    const fresh = [...new Map(sent.map((file) => [file.sha256, file])).values()].filter(
      ({ sha256 }) => !held.has(sha256),
    );
    if (fresh.length === 0) continue;
    try {
      const placed = fresh.map((file) =>
        placeFile(
          project,
          requireWritableItem(project.db, item.id),
          {
            filename: file.name,
            bytes: readFileSync(evidenceFile(project.dataDir, file.sha256)),
          },
          PERSON.actor,
          at,
        ),
      );
      for (const file of placed) recordEvidence(project, item.id, file, PERSON, at);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      warnings.push(
        `${item.id} did not take the file${fresh.length === 1 ? '' : 's'} the person sent (${fresh.map(({ name }) => name).join(', ')}): ${why}. Tell the person, or attach them yourself with otea attach.`,
      );
    }
  }
  return warnings;
}

// The files came from the person, through the desk: they are theirs on the item.
const PERSON: Performer = { actor: { kind: 'human', name: 'human' }, channel: 'ui' };

// The action a question carries: its note is the person's own change, in a few words, and the first
// option is what performs it, so there must be options to tap.
function checkedAction(
  action: MessageAction | undefined,
  options: readonly string[],
): MessageAction | undefined {
  if (action === undefined) return undefined;
  const does = action.kind === 'drop' ? 'drops an item' : 'sends an item back';
  if (options.length === 0) {
    invalid(
      `Not said: a question that ${does} needs its options: the first one does it, the other says no (--option "<do it>" --option "<leave it>")`,
    );
  }
  const note = action.note.trim();
  if (note === '')
    invalid(
      `Not said: the note to ${action.kind === 'drop' ? 'drop' : 'send back'} the item with is empty`,
    );
  if (note.length > MAX_MESSAGE_CHARS)
    invalid(`Not said: the note takes at most ${MAX_MESSAGE_CHARS} characters`);
  return { ...action, note };
}

// A message Otea could not tie to the secretary's session never carries a card: the person's tap
// would do what a process of unknown origin drafted.
export function refuseUnverifiedCard(
  unverified: boolean | undefined,
  card: MessageAction['kind'] | undefined,
): void {
  if (!unverified || card === undefined) return;
  throw new OteaError(
    'forbidden',
    `Not said: this message could not be tied to the secretary's session, and a card (--${card === 'drop' ? 'drop' : 'send-back'}) only goes from it. If you are the secretary, declare your session first (otea profile --role secretary) and say it again; otherwise use otea escalate`,
  );
}

// The secretary's message: only the project's declared secretary says anything.
export function sayAsSecretary(project: Project, input: SayInput, now: Clock = systemClock): Said {
  requireSecretary(project.db, input.agent, 'speaks for the project (say)');
  const files = checkedFiles(input.files ?? []);
  const text = checkedText(input.text, files);
  const links = [...new Set((input.links ?? []).map((id) => id.trim()).filter((id) => id !== ''))];
  const checked = checkOptions(input.options, input.recommended);
  if ('problem' in checked) invalid(`Not said: ${checked.problem}`);
  refuseUnverifiedCard(input.unverified, input.action?.kind);
  const action = checkedAction(input.action, checked.options);
  const optionText = [...new Set(input.optionText ?? [])].sort((a, b) => a - b);
  for (const number of optionText) {
    if (!Number.isInteger(number) || number < 1 || number > checked.options.length) {
      invalid(
        `Not said: --option-text ${number} names no option (${checked.options.length} given, numbered from 1)`,
      );
    }
    if (action !== undefined && number === 1) {
      invalid('Not said: the first option performs the card for the person, it takes no words');
    }
  }
  // Classifying is about a turn of the person's. Without --reply-to it is the latest message
  // already read, and only when that is no guess: another message not read yet, or another read
  // turn not classified, and the secretary says which (a reply to the wrong turn would tie the
  // items to it). Links alone, with no --reply-to, are no classifying: the message is a notice that
  // mentions the items.
  const classifies = input.kind !== undefined;
  let replyTo = input.replyTo;
  if (classifies && replyTo === undefined) {
    const { latest, unread, otherUnclassified } = selectDefaultTurn(project.db);
    if (unread > 0 || otherUnclassified > 0) {
      invalid(
        `Which message does this classify or link? ${unread > 0 ? `${unread} of the person's messages are not read yet` : `${otherUnclassified + 1} read messages are not classified`}: say it with --reply-to <id> (otea conversation shows the numbers)`,
      );
    }
    if (latest === undefined) {
      invalid(
        'There is no message of the person to classify or link: say it with no --request, --consultation or --links',
      );
    }
    replyTo = latest;
  }
  // A plain say with no --reply-to while a message of the person's waits for an answer is that
  // answer: the desk and the secretary's wait count a message as answered only by a message in its
  // own turn, so a standalone reply left it «not answered yet» under the very answer (field study
  // 5, V4). A notice is no answer: one that names items (--links: the turn that waits has none),
  // asks with options, carries a card or classifies a turn stays a message of its own.
  if (
    replyTo === undefined &&
    input.kind === undefined &&
    links.length === 0 &&
    checked.options.length === 0 &&
    action === undefined
  ) {
    replyTo = selectLatestUnanswered(project.db, now())?.id;
  }
  if (replyTo !== undefined) requireMessage(project, replyTo);
  const warnings: string[] = [];
  const hung: string[] = [];
  for (const id of links) {
    const item = requireItem(project.db, id);
    // An item that came from a Bandeja note hangs from that note: never from a turn of the person's.
    // The answer is posted all the same, without that link, and the warning says so.
    const note = replyTo === undefined ? undefined : selectEntryOfItem(project.db, item.id);
    if (note !== undefined) {
      warnings.push(
        `${item.id} came from the Inbox note B-${note.id}: it does not hang from a message, so this was said without that link. Mention it in a notice if the person must see it: otea say "<text>" --links ${item.id} with no --reply-to`,
      );
    } else hung.push(item.id);
  }
  const at = now();
  return transaction(project.db, () => {
    const id = insertMessage(project.db, {
      author: 'secretary',
      name: input.agent,
      text,
      at,
      read: true,
      ...(replyTo === undefined ? {} : { replyTo }),
      options: checked.options,
      recommended: checked.recommended,
      action,
      unverified: input.unverified,
      optionText,
    });
    keepFiles(project, id, files);
    // What it answers is read: it answered from what the wake showed, without `otea conversation`,
    // and the next wait must not bring the same message back.
    if (replyTo !== undefined) markRead(project.db, [replyTo], at);
    const root = requireMessage(project, id).root;
    // Answering into a turn is acting on it: a kind the person changed there is no news any more.
    if (replyTo !== undefined) clearKindNews(project.db, [root]);
    // Items linked to a turn make it a request unless it is classified; a notice's links are its own.
    const wanted =
      input.kind ?? (replyTo !== undefined && hung.length > 0 ? ('request' as const) : undefined);
    const kept = wanted === undefined ? false : !classify(project, root, wanted);
    // A notice mentions every item it names; an answer hangs only the ones that can hang from it.
    warnings.push(...linkItems(project, root, replyTo === undefined ? links : hung, at));
    const message = requireMessage(project, id);
    return { message, kind: message.kind, kept, warnings };
  });
}

// How long the person may take back a tap on a question, while the secretary has not read it.
export const RETRACT_ANSWER_MS = 30_000;

// The person takes back the answer they just gave to a question (Deshacer): the question waits for
// them again. Only while the secretary has not heard it, within a few seconds, and never a card's
// tap, which already did what it said.
export function retractAnswer(project: Project, id: number, now: Clock = systemClock): Message {
  return joinTransaction(project.db, () => {
    const question = requireMessage(project, id);
    const answer = selectAnswerOf(project.db, id);
    const refuse = (why: string): never => {
      throw new OteaError('not_undoable', `Message ${id}: ${why}`);
    };
    if (answer === undefined) return refuse('there is no answer to take back');
    if (question.action !== null) return refuse('its tap already did what the card says');
    // A tap on an option only: what the person typed, or left to the secretary, is a message of
    // their own.
    if (answer.choice?.mode !== 'option')
      return refuse('only a tap on one of its options is taken back, not words you wrote');
    if (answer.readAt !== null || answer.heardAt !== null)
      return refuse('the secretary already has your answer');
    if (Date.parse(now()) - Date.parse(answer.at) > RETRACT_ANSWER_MS)
      return refuse('the answer is too old to take back');
    deleteMessage(project.db, answer.id);
    return requireMessage(project, id);
  });
}

// The secretary takes back a question of its own that nobody needs to answer any more (what it
// asked was settled some other way): it stops waiting for the person, who sees it was withdrawn.
export function withdrawQuestion(
  project: Project,
  input: { agent: string; id: number },
  now: Clock = systemClock,
): Message {
  requireSecretary(project.db, input.agent, 'withdraws its own question (say --withdraw)');
  const question = requireMessage(project, input.id);
  if (question.author !== 'secretary' || question.options.length === 0) {
    invalid(`Message ${input.id} is not a question of yours with options to tap`);
  }
  if (question.closed !== null)
    invalid(`Message ${input.id} is already closed (${question.closed.why})`);
  if (isAnswered(project.db, input.id)) invalid(`Message ${input.id} was already answered`);
  closeQuestions(project.db, { id: input.id }, now(), 'withdrawn');
  return requireMessage(project, input.id);
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
): Message & { warnings: string[] } {
  const message = requireLinkableMessage(project, agent, messageId);
  return joinTransaction(project.db, () => {
    const warnings = linkItems(project, message.root, [item], now(), true);
    if (selectRootKind(project.db, message.root).kind === null)
      classify(project, message.root, 'request');
    // The questions of this turn stay open: whether the item answers them is for the secretary to
    // say (openQuestionsOfTurn tells it, and say --withdraw closes one), not for Otea to guess.
    // Making an item out of a turn is acting on it, whether or not it was read.
    clearKindNews(project.db, [message.root]);
    return { ...requireMessage(project, messageId), warnings };
  });
}

// The secretary's questions still waiting for the person in a turn, by message id.
export function openQuestionsOfTurn(project: Project, root: number): number[] {
  return selectOpenQuestions(project.db)
    .filter((question) => question.root === root)
    .map(({ id }) => id);
}

// The message an item may be made from: the secretary's to ask, and a message of the person's turn
// (a tap on a question included), never one of the secretary's own notices. Checked before the item
// is made, so a refusal leaves nothing behind.
export function requireLinkableMessage(
  project: Project,
  agent: string,
  messageId: number,
): Message {
  requireSecretary(project.db, agent, 'links the conversation to items');
  const message = requireMessage(project, messageId);
  if (selectMessage(project.db, message.root)?.author === 'secretary') {
    invalid(
      `Message ${messageId} is your own notice, not something the person asked: make the item from the person's message (a tap on your question is one)`,
    );
  }
  return message;
}

// The person corrects what the secretary made of a turn, with one tap: it keeps the correction, and
// the secretary's later say of that turn does not undo it. A change wakes the secretary (kind_changed,
// from the turn's own state) until it reads the turn.
export function correctKind(project: Project, id: number, kind: MessageKind): Message {
  const message = requireMessage(project, id);
  if (selectMessage(project.db, message.root)?.author === 'secretary') {
    invalid(`Message ${id} is a notice of the secretary's: a notice has no kind to correct`);
  }
  const changed = selectRootKind(project.db, message.root).kind !== kind;
  setKind(project.db, message.root, kind, 'person', changed);
  // Taking the turn as the person means it is settled: what the secretary asked about it (is it
  // worth noting?) no longer waits for them.
  if (changed) closeQuestions(project.db, { root: message.root }, systemClock(), 'settled');
  return requireMessage(project, id);
}

// What the person gives to a question of the secretary's: one of its options (the number from 1),
// their own words, or the decision left to the secretary. Exactly one.
// `note`: with the first option of a question that carries an action, the person's own edit of the
// note it performs with.
// `explain`: with an option that needs the person's own words (say --option-text), what they added.
export type GivenAnswer =
  | {
      option: number;
      note?: string | undefined;
      explain?: string | undefined;
      text?: never;
      delegate?: never;
    }
  | { text: string; option?: never; delegate?: never; note?: never; explain?: never }
  | { delegate: true; text?: never; option?: never; note?: never; explain?: never };

// The person's answer to a question of the secretary's (say --option): their own message, in reply
// to it, that wakes the secretary like any message. Answered once: by a reply to that question;
// other questions and what else the person says leave it open. Only the desk's authenticated routes
// call this.
export function answerSecretaryQuestion(
  project: Project,
  id: number,
  given: GivenAnswer,
  now: Clock = systemClock,
  by = 'human',
): Message {
  const question = requireMessage(project, id);
  if (question.author !== 'secretary' || question.options.length === 0) {
    throw new OteaError('invalid_fields', `Message ${id} is not a question with options to tap`);
  }
  // A question the secretary took back is not answered. One that was settled some other way may
  // still be: the person's words reach the secretary all the same.
  if (question.closed?.why === 'withdrawn') {
    throw new OteaError(
      'invalid_transition',
      `Message ${id} was withdrawn by the secretary: it no longer waits for an answer`,
    );
  }
  let words: string;
  let mode: AnswerMode;
  let option: number | undefined;
  if (given.delegate && question.action !== null) {
    invalid(
      `Message ${id} ${question.action.kind === 'drop' ? 'drops' : 'sends'} ${question.action.item}${question.action.kind === 'drop' ? '' : ' back'}: only you decide that, so it is not left to the secretary`,
    );
  }
  if (given.note !== undefined && (question.action === null || given.option !== 1)) {
    invalid(`Message ${id} has no note to edit: a note goes with the first option of its action`);
  }
  if (given.delegate) {
    words = DELEGATED;
    mode = 'delegated';
  } else if (given.option !== undefined) {
    const chosen = question.options[given.option - 1];
    if (chosen === undefined) invalid(`Message ${id} has no option ${given.option}`);
    const explained = (given.explain ?? '').trim();
    if (question.optionText.includes(given.option) && explained === '') {
      invalid(`Option ${given.option} of message ${id} needs your own words: say them`);
    }
    if (explained !== '' && !question.optionText.includes(given.option)) {
      invalid(`Option ${given.option} of message ${id} takes no words of your own`);
    }
    words = explained === '' ? chosen : `${chosen} — ${explained}`;
    if (words.length > MAX_MESSAGE_CHARS)
      invalid(`An answer takes at most ${MAX_MESSAGE_CHARS} characters`);
    mode = 'option';
    option = given.option;
  } else {
    words = (given.text ?? '').trim();
    if (words === '') invalid('Say your answer');
    if (words.length > MAX_MESSAGE_CHARS)
      invalid(`An answer takes at most ${MAX_MESSAGE_CHARS} characters`);
    mode = 'text';
  }
  return joinTransaction(project.db, () => {
    if (isAnswered(project.db, id)) {
      throw new OteaError('invalid_transition', `Message ${id} was already answered`);
    }
    const made = insertMessage(project.db, {
      author: 'person',
      name: by,
      text: words,
      at: now(),
      replyTo: id,
      choice: { mode, option },
    });
    return requireMessage(project, made);
  });
}

// What the person answered to an agent's question on an item or a Bandeja entry (CAM-1, B-3), kept
// in the thread as their own message, already read: a trace of what they chose, which wakes nobody
// (the agent is told by the item).
export function traceAnswer(
  ctx: Context,
  trace: {
    about: string;
    asked: string;
    text: string;
    mode: AnswerMode;
    option?: number | undefined;
    by: string;
  },
  now: Clock = systemClock,
): void {
  insertMessage(ctx.db, {
    author: 'person',
    name: trace.by,
    text: trace.text,
    at: now(),
    read: true,
    choice: {
      mode: trace.mode,
      option: trace.option,
      about: trace.about,
      // Kept whole (the thread is the record): it is made one short quoted line only when printed.
      asked: trace.asked,
    },
  });
}

// The trace of a tap goes when the person takes the tap back (Deshacer): the latest one about `about`
// (an item or a note), and only one of an option they tapped.
export function dropTraceOf(ctx: Context, about: string): void {
  const id = selectLastTraceOf(ctx.db, about);
  if (id !== undefined) deleteMessage(ctx.db, id);
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
  // The secretary as M1 tells it, and what waits for it (the same object GET /api/secretary gives).
  secretary: SecretaryView | null;
  waiting: SecretaryWaiting;
};

// With no secretary nothing is read, so only the person's own messages wait.
function withoutSecretary(db: DatabaseSync): SecretaryWaiting {
  const messages = countPending(db);
  return { ...messages, messages: messages.count, notes: 0, reports: 0 };
}

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
  const secretary = secretaryView(project.db, now) ?? null;
  // What waits for the secretary is one count with the secretary's own state, never a second one:
  // with none, only the person's messages wait for it.
  return {
    messages,
    more,
    secretary,
    waiting: secretary?.waiting ?? withoutSecretary(project.db),
  };
}

export type Read = {
  messages: Message[];
  // The person's messages this look marked as read.
  fresh: number[];
  more: boolean;
  // The path each attachment can be opened at, and why one has none: worked out before anything is
  // marked read, so a file that cannot be made available never costs the secretary its message.
  paths: Map<number, string>;
  problems: Map<number, string>;
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
    // A kind the person changed is read with its turn, wherever it lies, so the secretary sees what
    // they decided and the news stops waking it.
    const news = selectKindNews(project.db).map(({ root }) => root);
    const have = new Set(messages.map(({ id }) => id));
    const turns = news.flatMap((root) =>
      selectTurn(project.db, root).filter(({ id }) => !have.has(id)),
    );
    if (turns.length > 0) messages = [...messages, ...turns].sort((a, b) => a.id - b.id);
    // The files first: the messages are marked read only once they are in hand.
    const { paths, problems } = openablePaths(project, messages);
    clearKindNews(project.db, news);
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
    return { messages: read, fresh, more, paths, problems };
  });
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// How a message of the person's answers a question, for the secretary's read of it.
function choiceHeads(message: Message): string[] {
  const { choice } = message;
  if (choice === null) return [];
  if (choice.about !== null)
    return [
      `answered ${choice.about}'s question${choice.asked ? ` ${quoteAgent(choice.asked)}` : ''}`,
    ];
  if (choice.mode === 'delegated')
    return ['answer to your question: left the decision to you, your call'];
  if (choice.mode === 'option') return [`answer to your question: chose option ${choice.option}`];
  return ['answer to your question, in their own words'];
}

// The messages as the secretary reads them: plain text, each with its number, who wrote it and
// when, the kind and the items of its turn, and each file with a path it can open.
export function messagesText(
  messages: readonly Message[],
  fresh: ReadonlySet<number>,
  paths: ReadonlyMap<number, string>,
  problems: ReadonlyMap<number, string>,
): string {
  return messages
    .map((message) => {
      const who =
        message.author === 'person' ? 'person' : `${message.author} ${plainLine(message.by, 60)}`;
      const heads = [
        `${who}, ${timeText(message.at)}`,
        ...(message.replyTo === null ? [] : [`reply to ${message.replyTo}`]),
        ...(fresh.has(message.id) ? ['new'] : []),
        ...(message.kind === null
          ? []
          : [
              `${message.kind}${message.kindNews && message.id === message.root ? ' (changed by the person)' : ''}${message.links.length === 0 ? '' : ` -> ${message.links.join(', ')}`}`,
            ]),
        ...choiceHeads(message),
        ...(message.options.length === 0
          ? []
          : [
              `question with options to tap: ${message.options.map((each, at) => `${at + 1}) ${each}`).join(' · ')}`,
            ]),
      ];
      const files = message.attachments.map((file) => {
        const path = paths.get(file.id);
        const problem = problems.get(file.id);
        const where =
          path === undefined ? ` (no path: ${problem ?? 'not available'})` : `: ${path}`;
        return `  attached: ${file.name} (${file.kind}, ${sizeText(file.size)})${where}`;
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
export function conversationText(
  agent: string,
  read: Read,
  now: number = Date.now(),
  zone?: string,
): string {
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
          `Answer with: otea say "<text>" --reply-to ${last.id} --as ${agent}. Mark the turn a request with --request --links <item ids>, or a consultation (a question you answer) with --consultation; plain text with item ids, short, the conclusion first. News of your own (an item ready for review, something that went wrong) is a message with no --reply-to: otea say "<text>" --links <item ids> --as ${agent}. A question with options to tap: --option "<a>" --option "<b>" --recommend <n>.`,
        ];
  const changed = read.messages.filter(
    ({ id, root, kind, kindNews }) => kindNews && id === root && kind !== null,
  );
  const changes = changed.map(
    ({ id, kind }) =>
      `The person changed message ${id} to a ${kind}: act on it (a request becomes items, a consultation is answered) and do not ask again what they decided.`,
  );
  return [
    heading,
    ...changes,
    ...(read.messages.length === 0
      ? []
      : [messagesText(read.messages, fresh, read.paths, read.problems)]),
    ...(read.problems.size === 0
      ? []
      : [
          `${read.problems.size} file(s) could not be made available at a path; they are still on the desk, and the person can send them again.`,
        ]),
    ...more,
    // The messages' times are UTC, as every text's: what the person reads is their own clock.
    ...(read.messages.length === 0
      ? []
      : [
          `The person's clock now: ${clockText(now, zone)}. The times above are UTC: tell the person times as their clock reads.`,
        ]),
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

// A kind the person changed wakes the secretary from the turn's own state, as a message of theirs
// does, until it reads the turn.
addSecretarySource((ctx) => {
  const [first] = selectKindNews(ctx.db, true);
  if (first === undefined) return undefined;
  const kind = selectRootKind(ctx.db, first.root).kind;
  return {
    kind: 'kind_changed',
    ref: String(first.root),
    text: `"${messageSnippet(first.text, 120)}" is now a ${kind ?? 'turn'}`,
  };
});

// The turns an item came from, newest last: what show, next and the item's page tell. An item made
// with no message has none.
export function turnsOfItem(ctx: Context, item: string): FromMessage[] {
  const held = new Set(selectEvidence(ctx.db, item).map(({ sha256 }) => sha256));
  return selectTurnsOfItem(ctx.db, item).map((message) => {
    // The files the person sent in the turn that the item holds as evidence.
    const files = new Set(
      selectTurn(ctx.db, message.root)
        .filter(({ author }) => author === 'person')
        .flatMap(({ attachments }) => attachments.map(({ sha256 }) => sha256))
        .filter((sha256) => held.has(sha256)),
    ).size;
    return {
      id: message.id,
      at: message.at,
      author: message.author,
      kind: message.kind,
      snippet: messageSnippet(message.text),
      ...(files === 0 ? {} : { files }),
    };
  });
}

// What show and next say of where an item came from, or nothing.
export function fromMessageLine(turns: readonly FromMessage[]): string | undefined {
  if (turns.length === 0) return undefined;
  const said = turns.map(
    (turn) => `message ${turn.id}${turn.kind === null ? '' : ` (${turn.kind})`}: "${turn.snippet}"`,
  );
  const files = turns.reduce((sum, { files: n }) => sum + (n ?? 0), 0);
  // Where the worker finds them: the item's own evidence, with the path to open each.
  const sent =
    files === 0
      ? ''
      : ` ${files} file${files === 1 ? '' : 's'} the person sent ${files === 1 ? 'is' : 'are'} attached to this item as evidence: open ${files === 1 ? 'it' : 'them'} from the paths listed under Evidence.`;
  return `Asked in the conversation, ${said.join('; ')}. Read the turn with otea conversation --since ${Math.max(0, (turns[0]?.id ?? 1) - 1)}.${sent}`;
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
// A file that cannot be made available (the stored copy is gone, the disk refuses) is a problem noted
// for it, never an error that stops the rest.
export function openablePaths(
  project: Project,
  messages: readonly Message[],
): { paths: Map<number, string>; problems: Map<number, string> } {
  const paths = new Map<number, string>();
  const problems = new Map<number, string>();
  for (const message of messages) {
    for (const file of message.attachments) {
      try {
        const path = namedReadPath(project.dataDir, `m${file.id}`, {
          sha256: file.sha256,
          filename: file.name,
        });
        if (path === undefined) problems.set(file.id, 'the stored file is missing');
        else paths.set(file.id, path);
      } catch (error) {
        problems.set(file.id, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { paths, problems };
}

export function attachmentPaths(project: Project, message: Message): Map<number, string> {
  return openablePaths(project, [message]).paths;
}
