import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  BANDEJA_LEASE_MS,
  type BandejaEntry,
  type BandejaQuestion,
  type BandejaState,
  bandejaRef,
  type FromBandeja,
  isBandejaRef,
} from '../core/bandeja.ts';
import { checkOptions, DELEGATED } from '../core/board/questions.ts';
import { MAX_MESSAGE_CHARS, MAX_MESSAGE_FILES, messageSnippet } from '../core/conversation.ts';
import { OteaError } from '../core/errors.ts';
import { evidenceTypeOf, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_MB } from '../core/evidence.ts';
import type { BandejaAskFacts } from '../core/notify/signals.ts';
import { plainLine, quoteAgent } from '../core/quote.ts';
import { timeText } from '../core/time.ts';
import { saveRole, selectRoles } from '../store/assistant.ts';
import {
  answerQuestionRow,
  closeEntry,
  countWaitingEntries,
  type EntryRow,
  entryOfClientKey,
  fileEntry,
  filesOfEntries,
  holdEntry,
  insertEntry,
  insertEntryFile,
  insertQuestion,
  questionsOfEntries,
  releaseEntry,
  renewEntries,
  reopenEntry,
  retractQuestionRow,
  selectClaimedAt,
  selectEntryOfItem,
  selectEntryRow,
  selectEntryRows,
  selectHolders,
} from '../store/bandeja.ts';
import { joinTransaction, transaction } from '../store/database.ts';
import { findItem } from '../store/queries.ts';
import { addAssistantSource, assistantName } from './assistant.ts';
import { addWaitingSource } from './assistant-waiting.ts';
import type { Context } from './context.ts';
import {
  dropTraceOf,
  type MessageFileInput,
  RETRACT_ANSWER_MS,
  traceAnswer,
} from './conversation.ts';
import { evidenceFile, namedReadPath, storeFile } from './evidence.ts';
import { type Clock, requireItem, systemClock } from './items.ts';
import { listAgents, sessionEnded } from './presence.ts';
import type { Project } from './project.ts';

// The Bandeja (core/bandeja.ts): the person's rough captures, and the way a refiner turns each into
// an item. Who may do what is decided here, not by the callers: an entry is made only by
// captureToBandeja and the person's answer recorded only by answerBandeja, which only the desk's
// authenticated routes call (server/server.ts); no command of the command line or of MCP makes
// either, so an agent can never capture or answer as the person. The refiner's side (take, ask,
// file) refuses a person's name and anyone who does not hold the entry.

function invalid(message: string): never {
  throw new OteaError('invalid_fields', message);
}

// What an agent writes into an entry (a refiner's question, the reason for closing one) is read by
// the assistant and the person: a bound, as a capture has.
export const MAX_QUESTION_CHARS = 2000;
export const MAX_REASON_CHARS = 500;

const MAX_NAME = 200;

// The files as the conversation checks them (same limits), the name kept as it came.
function checkedFiles(files: readonly MessageFileInput[]): MessageFileInput[] {
  if (files.length > MAX_MESSAGE_FILES) invalid(`Send at most ${MAX_MESSAGE_FILES} files`);
  return files.map(({ filename, bytes }) => {
    const shown = basename(filename.replaceAll('\\', '/')).trim();
    if (shown === '.' || shown === '..') invalid('Each file needs a name');
    const name = shown === '' ? 'file' : shown.slice(0, MAX_NAME);
    if (bytes.length > MAX_EVIDENCE_BYTES) {
      throw new OteaError(
        'evidence_too_large',
        `${name} is over the ${MAX_EVIDENCE_MB} MB evidence limit`,
      );
    }
    return { filename: name, bytes };
  });
}

export type CaptureInput = {
  text: string;
  files?: MessageFileInput[];
  // A phone that sends again what it never heard back gets the first entry, not a second.
  clientKey?: { scope: string; key: string };
  // The person's name as the desk shows it.
  by?: string;
};

// The person's rough note, to wait for the assistant. Only the desk's authenticated routes call
// this.
export function captureToBandeja(
  project: Project,
  input: CaptureInput,
  now: Clock = systemClock,
): { entry: BandejaEntry; replayed: boolean } {
  const files = checkedFiles(input.files ?? []);
  const text = input.text.trim();
  if (text === '' && files.length === 0) invalid('A capture needs some text or a file');
  if (text.length > MAX_MESSAGE_CHARS) {
    invalid(`A capture takes at most ${MAX_MESSAGE_CHARS} characters; put the rest in a file`);
  }
  const client =
    input.clientKey === undefined
      ? undefined
      : {
          ...input.clientKey,
          digest: createHash('sha256')
            .update(
              JSON.stringify([
                text,
                files.map(({ filename, bytes }) => [
                  filename,
                  createHash('sha256').update(bytes).digest('hex'),
                ]),
              ]),
            )
            .digest('hex'),
        };
  if (client !== undefined) {
    const sent = entryOfClientKey(project.db, client.scope, client.key);
    if (sent !== undefined) {
      if (sent.digest !== client.digest) {
        throw new OteaError(
          'already_exists',
          'This Idempotency-Key already sent another capture: send this one under a new key',
        );
      }
      return { entry: requireEntry(project, sent.id, now), replayed: true };
    }
  }
  const at = now();
  const id = transaction(project.db, () => {
    const made = insertEntry(project.db, { name: input.by ?? 'human', text, at, client });
    for (const { filename, bytes } of files) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      storeFile(project.dataDir, sha256, bytes);
      const { kind, contentType } = evidenceTypeOf(filename);
      insertEntryFile(project.db, made, {
        name: filename,
        contentType,
        kind,
        size: bytes.length,
        sha256,
      });
    }
    return made;
  });
  return { entry: requireEntry(project, id, now), replayed: false };
}

function stateOf(
  row: EntryRow,
  questions: readonly BandejaQuestion[],
  at: string,
  gone: ReadonlySet<string>,
): BandejaState {
  if (row.filed_at !== null) return 'filed';
  if (row.closed_at !== null) return 'closed';
  const last = questions.at(-1);
  if (last !== undefined && last.answer === undefined) return 'asking';
  if (
    row.claimed_by !== null &&
    row.claim_until !== null &&
    row.claim_until > at &&
    !gone.has(row.claimed_by)
  )
    return 'refining';
  return 'waiting';
}

// The refiners holding a note whose session ended (their harness is gone, noted by their take or
// wait): what they hold is held by nobody, not for the rest of the lease. Never for one heard
// through no process Otea can watch.
function goneHolders(db: DatabaseSync, at: string): string[] {
  return selectHolders(db, at).filter((name) => sessionEnded(db, name, () => at));
}

function hydrate(ctx: Context, rows: readonly EntryRow[], at: string): BandejaEntry[] {
  const ids = rows.map(({ id }) => id);
  const files = filesOfEntries(ctx.db, ids);
  const asked = questionsOfEntries(ctx.db, ids);
  const gone = new Set(goneHolders(ctx.db, at));
  return rows.map((row) => {
    const questions = asked.get(row.id) ?? [];
    const state = stateOf(row, questions, at, gone);
    const last = questions.at(-1);
    const holding = state === 'refining';
    return {
      id: row.id,
      ref: bandejaRef(row.id),
      text: row.text,
      at: row.at,
      by: row.author_name,
      attachments: files.get(row.id) ?? [],
      state,
      claimedBy: holding ? row.claimed_by : null,
      claimUntil: holding ? row.claim_until : null,
      questions,
      asking: state === 'asking' && last ? last : null,
      item: row.item_id,
      filedBy: row.filed_by,
      filedAt: row.filed_at,
      closedBy: row.closed_by,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
    };
  });
}

export function requireEntry(ctx: Context, id: number, now: Clock = systemClock): BandejaEntry {
  const row = selectEntryRow(ctx.db, id);
  if (!row) {
    throw new OteaError(
      'not_found',
      `${bandejaRef(id)} is not in the Inbox (otea bandeja lists it)`,
    );
  }
  const [entry] = hydrate(ctx, [row], now());
  if (!entry) throw new OteaError('not_found', `${bandejaRef(id)} is not in the Inbox`);
  return entry;
}

// The questions that wait for the person on a Bandeja note, for the notifier (one per entry).
export function bandejaAskFacts(ctx: Context, now: Clock = systemClock): BandejaAskFacts[] {
  return listBandeja(ctx, {}, now).flatMap(({ ref, text, asking }) =>
    asking === null
      ? []
      : [
          {
            ref,
            snippet: messageSnippet(text),
            question: asking.question,
            by: asking.by,
            text: asking.text,
            options: asking.options,
          },
        ],
  );
}

// The entries as the desk and `otea bandeja` show them: those not filed yet (oldest first), then
// the last `filed` filed ones (newest first).
export function listBandeja(
  ctx: Context,
  look: { filed?: number } = {},
  now: Clock = systemClock,
): BandejaEntry[] {
  return hydrate(ctx, selectEntryRows(ctx.db, look.filed ?? 0), now());
}

export type Held = { entry: BandejaEntry; renewed: boolean };

// A refiner takes an entry to work on it, for a lease: two never hold one at once. Only the refiner
// itself takes a note (the assistant never takes one for it). A refiner that already holds it keeps
// it (the lease starts again).
export function takeBandeja(
  project: Project,
  input: { id: number; agent: string },
  now: Clock = systemClock,
): Held {
  const { id, agent } = input;
  return transaction(project.db, () => {
    const at = now();
    const was = requireEntry(project, id, () => at);
    if (was.state === 'filed') {
      throw new OteaError(
        'invalid_transition',
        `${was.ref} is filed already, as ${was.item ?? 'an item'}: nothing to take`,
      );
    }
    if (was.state === 'asking') {
      throw new OteaError(
        'invalid_transition',
        `${was.ref} waits for the person's answer to your question ${quoteAgent(was.asking?.text ?? '')}: it is taken again once they answer`,
      );
    }
    if (was.state === 'closed') {
      throw new OteaError(
        'invalid_transition',
        `${was.ref} is closed (${quoteAgent(was.closeReason ?? 'no reason given')}): the person may reopen it`,
      );
    }
    // Held by a refiner whose session ended: let go of it first, then it is taken as any free note.
    if (was.state === 'waiting') releaseEntry(project.db, id);
    const until = new Date(Date.parse(at) + BANDEJA_LEASE_MS).toISOString();
    if (!holdEntry(project.db, id, agent, at, until)) {
      throw new OteaError(
        'forbidden',
        `${was.ref} is held by ${was.claimedBy ?? 'another refiner'} until ${timeText(was.claimUntil ?? at)}: take another entry, or wait for it`,
      );
    }
    return { entry: requireEntry(project, id, () => at), renewed: was.claimedBy === agent };
  });
}

// Any call of the refiner keeps what it holds: the lease of its entries starts over.
export function keepHeldEntries(ctx: Context, agent: string, now: Clock = systemClock): void {
  const at = now();
  renewEntries(ctx.db, agent, at, new Date(Date.parse(at) + BANDEJA_LEASE_MS).toISOString());
}

// One refiner for the whole Bandeja (field study 3, S5): it takes the entry it already holds, else
// the oldest nobody holds, and gets none while nothing waits for a refiner (every entry filed,
// closed, held by another or asking the person). Two refiners at once never get the same one.
export function takeNextBandeja(
  project: Project,
  input: { agent: string },
  now: Clock = systemClock,
): Held | undefined {
  const at = now();
  const entries = listBandeja(project, {}, () => at);
  const mine = entries.filter(
    ({ state, claimedBy }) => state === 'refining' && claimedBy === input.agent,
  );
  const free = entries.filter(({ state }) => state === 'waiting');
  for (const { id } of [...mine, ...free]) {
    try {
      return takeBandeja(project, { id, agent: input.agent }, () => at);
    } catch (error) {
      // Another refiner took it between the look and the take: the next one.
      if (error instanceof OteaError && error.code === 'forbidden') continue;
      throw error;
    }
  }
  return undefined;
}

// The agent that takes the notes in turn is the project's refiner: noted once, so the desk never
// counts it as a worker connected (it takes no item, and waiting for a note is no listening on the
// boards). The assistant's own role stays, and so does any other it already has.
export function noteRefiner(project: Project, agent: string, now: Clock = systemClock): void {
  if (selectRoles(project.db).has(agent)) return;
  saveRole(project.db, agent, 'refiner', now());
}

// The assistant closes an entry that needs no item (a duplicate of one that exists, a note that asks
// nothing), or the refiner that holds it does; the reason is kept and shown, and the person may
// reopen it. A filed entry is an item's already.
export function closeBandeja(
  project: Project,
  input: { id: number; agent: string; reason: string },
  now: Clock = systemClock,
): BandejaEntry {
  return transaction(project.db, () => {
    const at = now();
    const entry = requireEntry(project, input.id, () => at);
    const reason = input.reason.trim();
    if (entry.state === 'filed') {
      throw new OteaError(
        'invalid_transition',
        `${entry.ref} is filed already, as ${entry.item ?? 'an item'}: nothing to close`,
      );
    }
    if (entry.state === 'closed') {
      throw new OteaError(
        'invalid_transition',
        `${entry.ref} is closed already (${quoteAgent(entry.closeReason ?? 'no reason given')})`,
      );
    }
    // A question that waits for the person is theirs to answer first: closing would leave it
    // asking on a closed note.
    if (entry.state === 'asking') {
      throw new OteaError(
        'invalid_transition',
        `${entry.ref} waits for the person's answer to ${quoteAgent(entry.asking?.text ?? '')}: close it after they answer (they tap or write it on the desk)`,
      );
    }
    if (reason.length > MAX_REASON_CHARS) {
      invalid(`Not closed: ${MAX_REASON_CHARS} characters at most for the reason, in one line`);
    }
    const holds = entry.state === 'refining' && entry.claimedBy === input.agent;
    if (!holds && assistantName(project.db) !== input.agent) {
      throw new OteaError(
        'forbidden',
        `Only the project's assistant, or the refiner that holds ${entry.ref}, closes it${entry.claimedBy === null ? '' : ` (${entry.claimedBy} holds it)`}`,
      );
    }
    if (reason === '') {
      throw new OteaError(
        'reason_required',
        `Not closed: say the reason for closing ${entry.ref} (the person reads it, and may reopen the entry)`,
      );
    }
    if (!closeEntry(project.db, input.id, input.agent, reason, at)) {
      throw new OteaError('invalid_transition', `${entry.ref} was closed or filed meanwhile`);
    }
    return requireEntry(project, input.id, () => at);
  });
}

// The person reopens a closed entry on the desk: it waits for the assistant again.
export function reopenBandeja(
  project: Project,
  input: { id: number },
  now: Clock = systemClock,
): BandejaEntry {
  return transaction(project.db, () => {
    const at = now();
    const entry = requireEntry(project, input.id, () => at);
    if (entry.state !== 'closed' || !reopenEntry(project.db, input.id)) {
      throw new OteaError('invalid_transition', `${entry.ref} is not closed: nothing to reopen`);
    }
    return requireEntry(project, input.id, () => at);
  });
}

// The entry the agent holds now, or the refusal that says to take it.
function requireHold(ctx: Context, id: number, agent: string, at: string): BandejaEntry {
  const entry = requireEntry(ctx, id, () => at);
  if (entry.state === 'filed') {
    throw new OteaError(
      'invalid_transition',
      `${entry.ref} is filed already, as ${entry.item ?? 'an item'}`,
    );
  }
  if (entry.state === 'closed') {
    throw new OteaError(
      'invalid_transition',
      `${entry.ref} is closed (${quoteAgent(entry.closeReason ?? 'no reason given')})`,
    );
  }
  if (entry.state !== 'refining' || entry.claimedBy !== agent) {
    throw new OteaError(
      'forbidden',
      `You do not hold ${entry.ref}${entry.claimedBy === null ? '' : ` (${entry.claimedBy} does)`}: take it first with otea bandeja take ${entry.ref} --as ${agent}`,
    );
  }
  return entry;
}

// The item that is about to come out of an entry, checked before it is made: the agent holds the
// entry.
export function requireBandejaHold(
  ctx: Context,
  id: number,
  agent: string,
  now: Clock = systemClock,
): BandejaEntry {
  return requireHold(ctx, id, agent, now());
}

export type BandejaAsk = {
  id: number;
  agent: string;
  text: string;
  options?: readonly string[];
  recommended?: number | undefined;
  optionText?: readonly number[] | undefined;
};

// The refiner asks the person what the entry lacks, with options to tap (as an item's question
// has): the entry waits for their answer, the refiner's hold ends, and the assistant is told once
// they answer.
export function askOnBandeja(
  project: Project,
  input: BandejaAsk,
  now: Clock = systemClock,
): { entry: BandejaEntry; question: BandejaQuestion } {
  const text = input.text.trim();
  if (text === '') {
    throw new OteaError(
      'reason_required',
      `Not asked on ${bandejaRef(input.id)}: say your question`,
    );
  }
  if (text.length > MAX_QUESTION_CHARS) {
    invalid(
      `Not asked on ${bandejaRef(input.id)}: ${MAX_QUESTION_CHARS} characters at most, the question first; the rest goes in the item`,
    );
  }
  const checked = checkOptions(input.options, input.recommended);
  if ('problem' in checked) {
    throw new OteaError(
      'invalid_fields',
      `Not asked on ${bandejaRef(input.id)}: ${checked.problem}`,
    );
  }
  const optionText = [...new Set(input.optionText ?? [])].sort((a, b) => a - b);
  for (const number of optionText) {
    if (!Number.isInteger(number) || number < 1 || number > checked.options.length) {
      invalid(
        `Not asked on ${bandejaRef(input.id)}: --option-text ${number} names no option (${checked.options.length} given, numbered from 1)`,
      );
    }
  }
  return transaction(project.db, () => {
    const at = now();
    const entry = requireHold(project, input.id, input.agent, at);
    const n = Math.max(0, ...entry.questions.map(({ question }) => question)) + 1;
    insertQuestion(project.db, input.id, {
      n,
      text,
      options: checked.options,
      recommended: checked.recommended,
      optionText,
      by: input.agent,
      at,
    });
    releaseEntry(project.db, input.id);
    const asked = requireEntry(project, input.id, () => at);
    const question = asked.asking;
    if (!question) throw new Error(`question ${n} on ${asked.ref} was not kept`);
    return { entry: asked, question };
  });
}

// What the person gives: their words, the number (from 1) of one of the options, or the decision
// left to the refiner. `question` is the number of the question they were shown: a tap on one that
// has changed since is refused.
export type PersonAnswer = { id: number; question?: number; by?: string } & (
  | { text: string; option?: never; delegate?: never }
  | { option: number; text?: never; delegate?: never }
  | { delegate: true; text?: never; option?: never }
);

// The person's answer to the question that waits on an entry. Only the desk's authenticated routes
// call this. The entry is free again: the assistant's wait returns it, and a refiner takes it.
export function answerBandeja(
  project: Project,
  input: PersonAnswer,
  now: Clock = systemClock,
): BandejaEntry {
  return transaction(project.db, () => {
    const at = now();
    const entry = requireEntry(project, input.id, () => at);
    const open = entry.asking;
    if (!open) {
      throw new OteaError('invalid_transition', `${entry.ref}: no question waits for you`);
    }
    if (input.question !== undefined && input.question !== open.question) {
      throw new OteaError(
        'invalid_transition',
        `${entry.ref}: question ${input.question} is no longer the one that waits (it is question ${open.question}): read it again`,
      );
    }
    let answer: { text: string; mode: 'option' | 'text' | 'delegated'; option?: number };
    if (input.delegate) answer = { text: DELEGATED, mode: 'delegated' };
    else if (input.option !== undefined) {
      const text = open.options?.[input.option - 1];
      if (text === undefined) {
        throw new OteaError(
          'invalid_fields',
          `${entry.ref}: the question has no option ${input.option}`,
        );
      }
      answer = { text, mode: 'option', option: input.option };
    } else {
      const text = (input.text ?? '').trim();
      if (text === '')
        throw new OteaError('reason_required', `Not answered on ${entry.ref}: say your answer`);
      if (text.length > MAX_MESSAGE_CHARS) {
        invalid(`An answer takes at most ${MAX_MESSAGE_CHARS} characters`);
      }
      answer = { text, mode: 'text' };
    }
    if (!answerQuestionRow(project.db, input.id, open.question, answer, at)) {
      throw new OteaError('invalid_transition', `${entry.ref}: the question was answered already`);
    }
    traceAnswer(
      project,
      {
        about: entry.ref,
        asked: open.text,
        text: answer.text,
        mode: answer.mode,
        option: answer.option,
        by: input.by ?? 'human',
      },
      () => at,
    );
    return requireEntry(project, input.id, () => at);
  });
}

// The person takes back a tap on an option of a refiner's question (Deshacer): the note waits for
// their answer again. The same rule as every question of an agent: within 30 seconds, only a tapped
// option, and only while the refiner has not taken the note again nor filed or closed it.
export function retractBandejaAnswer(
  project: Project,
  input: { id: number },
  now: Clock = systemClock,
): BandejaEntry {
  return transaction(project.db, () => {
    const at = now();
    const entry = requireEntry(project, input.id, () => at);
    const undoable = (why: string): never => {
      throw new OteaError('not_undoable', `${entry.ref}: ${why}`);
    };
    const answered = entry.questions.findLast((each) => each.answer !== undefined);
    const answer = answered?.answer;
    if (!answered || !answer) return undoable('there is no answer to take back');
    if (answer.mode !== 'option')
      return undoable('only a tap on one of its options is taken back, not words you wrote');
    if (entry.filedAt !== null || entry.closedAt !== null || selectClaimedAt(project.db, input.id))
      return undoable('the refiner already went on with your answer');
    if (Date.parse(at) - Date.parse(answer.at) > RETRACT_ANSWER_MS)
      return undoable('the answer is too old to take back');
    if (!retractQuestionRow(project.db, input.id, answered.question, answer.at))
      return undoable('there is no answer to take back');
    dropTraceOf(project, entry.ref);
    return requireEntry(project, input.id, () => at);
  });
}

// The entry became an item: the refiner that holds it files it under the item, which ends the
// entry's wait. `otea create --from-bandeja` calls this in the transaction that makes the item, so a
// note that cannot be filed leaves no item behind.
export function fileBandeja(
  project: Project,
  input: { id: number; agent: string; item: string },
  now: Clock = systemClock,
): BandejaEntry {
  return joinTransaction(project.db, () => {
    const at = now();
    requireHold(project, input.id, input.agent, at);
    const item = requireItem(project.db, input.item).id;
    if (!fileEntry(project.db, input.id, input.agent, item, at)) {
      throw new OteaError('forbidden', `You no longer hold ${bandejaRef(input.id)}: take it again`);
    }
    return requireEntry(project, input.id, () => at);
  });
}

// Whether a name given to a command (ask, escalate) is a Bandeja note. B is reserved for notes from
// 0.8, but a 0.7 board named B has items B-1 already: a real item comes first, and only a name no
// item has is a note.
export function isBandejaTarget(ctx: Context, text: string): boolean {
  return isBandejaRef(text) && findItem(ctx.db, text.trim().toUpperCase()) === undefined;
}

// The entry an item came from, for the item's page and `otea show`.
export function bandejaOfItem(ctx: Context, item: string): FromBandeja | undefined {
  const row = selectEntryOfItem(ctx.db, item);
  if (!row) return undefined;
  return { id: row.id, ref: bandejaRef(row.id), at: row.at, snippet: messageSnippet(row.text) };
}

// The assistant's wait returns an entry while one waits for it, from the entries' own state (never a
// signal that can be lost): not held by a refiner, not filed, no question waiting for the person.
// It stops when the entry is taken (otea bandeja take), and returns once its lease runs out or the
// person answers.
// The captures nobody took count among what waits for an absent assistant (the notice «te esperan
// N»), beside the person's unread messages.
addWaitingSource((db) => {
  const at = systemClock();
  return countWaitingEntries(db, at, goneHolders(db, at));
});

// How long a note may wait for a refiner that is there (busy with another note) before it is the
// assistant's: it takes the notes in turn, and the assistant taking one meanwhile is what the
// refiner is for (field study 4, U6).
export const REFINER_BUSY_MS = 10 * 60_000;

addAssistantSource((ctx, now) => {
  const at = Date.parse(now());
  const waiting = hydrate(ctx, selectEntryRows(ctx.db, 0), now()).filter(
    ({ state }) => state === 'waiting',
  );
  const [first] = waiting;
  if (first === undefined) return undefined;
  // A refiner is there (connected, or at work on a note): the notes are its next. Only one that
  // waited for it a long while, or with no refiner there, is the assistant's.
  const refinerThere = listAgents(ctx.db, now).some(
    ({ role, status }) =>
      role === 'refiner' &&
      (status === 'working' || status === 'listening' || status === 'connected'),
  );
  if (refinerThere && at - Date.parse(first.at) < REFINER_BUSY_MS) return undefined;
  const answered = first.questions.length > 0 ? ' (the person answered your question)' : '';
  const more = waiting.length > 1 ? ` (and ${waiting.length - 1} more)` : '';
  return {
    kind: 'bandeja_item',
    ref: first.ref,
    text: `"${messageSnippet(first.text, 120)}"${answered}${more}`,
  };
});

// One attachment as the desk serves it: its entry and the stored file's path.
export function bandejaFileToServe(
  project: Project,
  id: string,
): { file: BandejaEntry['attachments'][number]; path: string } {
  const row = /^[1-9]\d{0,14}$/.test(id)
    ? (project.db
        .prepare(
          `SELECT id, filename AS name, content_type AS contentType, kind, size, sha256
           FROM bandeja_attachments WHERE id = ?`,
        )
        .get(Number(id)) as BandejaEntry['attachments'][number] | undefined)
    : undefined;
  const path = row && evidenceFile(project.dataDir, row.sha256);
  if (!row || !path || !existsSync(path)) {
    throw new OteaError('not_found', `Attachment "${id}" not found`);
  }
  return { file: row, path };
}

// A path an agent can open for each attachment of an entry: the stored file under the name it came
// with, in files/b<its number>/. A file that cannot be made available is a problem noted for it.
export function bandejaPaths(
  project: Project,
  entries: readonly BandejaEntry[],
): { paths: Map<number, string>; problems: Map<number, string> } {
  const paths = new Map<number, string>();
  const problems = new Map<number, string>();
  for (const entry of entries) {
    for (const file of entry.attachments) {
      try {
        const path = namedReadPath(project.dataDir, `b${file.id}`, {
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

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATE_WORD: Record<BandejaState, string> = {
  waiting: 'waiting for a refiner',
  refining: 'being refined',
  asking: 'asked the person',
  filed: 'filed',
  closed: 'closed',
};

function stateLine(entry: BandejaEntry): string {
  if (entry.state === 'refining')
    return `${STATE_WORD.refining} by ${entry.claimedBy ?? '?'} until ${timeText(entry.claimUntil ?? entry.at)}`;
  if (entry.state === 'filed') return `${STATE_WORD.filed} as ${entry.item ?? 'an item'}`;
  if (entry.state === 'closed')
    return `${STATE_WORD.closed} by ${plainLine(entry.closedBy ?? '?', 60)}: ${plainLine(entry.closeReason ?? 'no reason given', MAX_REASON_CHARS)}`;
  if (entry.state === 'asking')
    return `${STATE_WORD.asking}: ${quoteAgent(entry.asking?.text ?? '')}`;
  return STATE_WORD.waiting;
}

// One entry as a refiner reads it: the person's words, each file with a path it can open, the talk
// that came of it (the questions and what the person answered), and what to do next.
export function entryText(
  entry: BandejaEntry,
  paths: ReadonlyMap<number, string>,
  problems: ReadonlyMap<number, string>,
  agent?: string,
): string {
  const as = agent === undefined ? '' : ` --as ${agent}`;
  const files = entry.attachments.map((file) => {
    const path = paths.get(file.id);
    const problem = problems.get(file.id);
    const where = path === undefined ? ` (no path: ${problem ?? 'not available'})` : `: ${path}`;
    return `  attached: ${file.name} (${file.kind}, ${sizeText(file.size)})${where}`;
  });
  const talk = entry.questions.flatMap((question) => {
    const options = (question.options ?? []).map(
      (option, i) => `${i + 1}. ${option}${question.recommended === i + 1 ? ' (recommended)' : ''}`,
    );
    const answer = question.answer;
    return [
      `  ${plainLine(question.by, 60)} asked: ${quoteAgent(question.text, 1000)}${options.length === 0 ? '' : ` Options: ${options.join(' · ')}`}`,
      ...(answer === undefined
        ? ['  (the person has not answered yet)']
        : [
            answer.mode === 'delegated'
              ? '  The person left the decision to you: decide it yourself, and say what you chose when you file it.'
              : `  The person ${answer.mode === 'option' ? `chose option ${answer.option ?? ''}` : 'answered'}: "${answer.text}"`,
          ]),
    ];
  });
  const next =
    entry.state === 'filed' || entry.state === 'closed'
      ? []
      : [
          `  Next: take it (otea bandeja take ${entry.ref}${as}), then make the item (otea create --collection <board> --title "<title>" --field "<What I want>=..." --field "<How I check it>=..." --from-bandeja ${entry.ref}${as}), or ask the person what is missing (otea ask ${entry.ref} "<question>" --option "<a>" --option "<b>"${as}).`,
        ];
  return [
    `${entry.ref} · ${timeText(entry.at)} · ${stateLine(entry)}`,
    ...entry.text.split('\n').map((line) => `  ${line}`),
    ...files,
    ...talk,
    ...next,
  ].join('\n');
}

// The lines `otea bandeja` prints: one per entry.
export function listText(entries: readonly BandejaEntry[], agent?: string): string {
  if (entries.length === 0) return 'The Inbox is empty: nothing waits to be refined.';
  const as = agent === undefined ? '' : ` --as ${agent}`;
  return [
    ...entries.map(
      (entry) =>
        `${entry.ref}  ${timeText(entry.at)}  ${stateLine(entry)}\n  "${messageSnippet(entry.text, 100)}"${entry.attachments.length === 0 ? '' : ` (+${entry.attachments.length} file(s))`}`,
    ),
    `Read one with otea bandeja <id>${as}; take it with otea bandeja take <id>${as}.`,
  ].join('\n');
}
