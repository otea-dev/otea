import type { DatabaseSync } from 'node:sqlite';
import type { BandejaQuestion } from '../core/bandeja.ts';
import type { MessageFile } from '../core/conversation.ts';

// The Bandeja's rows (core/bandeja.ts): the entries, the files that came with them and the
// questions a refiner asked on them. What state an entry is in is worked out by app/bandeja.ts
// from these rows and the time.

export type EntryRow = {
  id: number;
  author_name: string;
  text: string;
  at: string;
  claimed_by: string | null;
  claim_until: string | null;
  item_id: string | null;
  filed_by: string | null;
  filed_at: string | null;
};

const COLUMNS = 'id, author_name, text, at, claimed_by, claim_until, item_id, filed_by, filed_at';

export type NewEntry = {
  name: string;
  text: string;
  at: string;
  // Who sent it (the device, or the desk's session), the key it sent it under and a digest of it.
  client?: { scope: string; key: string; digest: string } | undefined;
};

export function insertEntry(db: DatabaseSync, entry: NewEntry): number {
  const sql = `INSERT INTO bandeja_entries (author_name, text, at, client_scope, client_key, client_digest)
    VALUES (:name, :text, :at, :scope, :key, :digest)`;
  const result = db.prepare(sql).run({
    name: entry.name,
    text: entry.text,
    at: entry.at,
    scope: entry.client?.scope ?? null,
    key: entry.client?.key ?? null,
    digest: entry.client?.digest ?? null,
  });
  return Number(result.lastInsertRowid);
}

export type NewEntryFile = Omit<MessageFile, 'id'>;

export function insertEntryFile(db: DatabaseSync, entry: number, file: NewEntryFile): number {
  const sql = `INSERT INTO bandeja_attachments (entry_id, filename, content_type, kind, size, sha256)
    VALUES (:entry, :name, :contentType, :kind, :size, :sha256)`;
  return Number(db.prepare(sql).run({ entry, ...file }).lastInsertRowid);
}

// The entry a client already sent under this key, for this device or session, and the digest of
// what it sent.
export function entryOfClientKey(
  db: DatabaseSync,
  scope: string,
  key: string,
): { id: number; digest: string | null } | undefined {
  return db
    .prepare(
      'SELECT id, client_digest AS digest FROM bandeja_entries WHERE client_scope = ? AND client_key = ?',
    )
    .get(scope, key) as { id: number; digest: string | null } | undefined;
}

export function selectEntryRow(db: DatabaseSync, id: number): EntryRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM bandeja_entries WHERE id = ?`).get(id) as
    | EntryRow
    | undefined;
}

// The entries not filed yet, oldest first, and the filed ones, newest first up to `filed`.
export function selectEntryRows(db: DatabaseSync, filed: number): EntryRow[] {
  const open = db
    .prepare(`SELECT ${COLUMNS} FROM bandeja_entries WHERE filed_at IS NULL ORDER BY id`)
    .all() as EntryRow[];
  if (filed <= 0) return open;
  const done = db
    .prepare(
      `SELECT ${COLUMNS} FROM bandeja_entries WHERE filed_at IS NOT NULL ORDER BY id DESC LIMIT ?`,
    )
    .all(filed) as EntryRow[];
  return [...open, ...done];
}

export function filesOfEntries(
  db: DatabaseSync,
  ids: readonly number[],
): Map<number, MessageFile[]> {
  const files = new Map<number, MessageFile[]>();
  if (ids.length === 0) return files;
  const rows = db
    .prepare(
      `SELECT id, entry_id AS entryId, filename AS name, content_type AS contentType, kind, size, sha256
       FROM bandeja_attachments WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    )
    .all(...ids) as (MessageFile & { entryId: number })[];
  for (const { entryId, ...file } of rows) {
    files.set(entryId, [...(files.get(entryId) ?? []), file]);
  }
  return files;
}

type QuestionRow = {
  entry_id: number;
  n: number;
  text: string;
  options: string | null;
  recommended: number | null;
  asked_by: string;
  at: string;
  answer_text: string | null;
  answer_mode: 'option' | 'text' | 'delegated' | null;
  answer_option: number | null;
  answered_at: string | null;
};

function questionOf(row: QuestionRow): BandejaQuestion {
  const options = row.options === null ? [] : (JSON.parse(row.options) as string[]);
  const answered = row.answer_text !== null && row.answered_at !== null && row.answer_mode !== null;
  return {
    question: row.n,
    text: row.text,
    at: row.at,
    by: row.asked_by,
    ...(options.length === 0 ? {} : { options }),
    ...(row.recommended === null ? {} : { recommended: row.recommended }),
    ...(answered
      ? {
          answer: {
            text: row.answer_text ?? '',
            at: row.answered_at ?? '',
            mode: row.answer_mode ?? 'text',
            ...(row.answer_option === null ? {} : { option: row.answer_option }),
          },
        }
      : {}),
  };
}

export function questionsOfEntries(
  db: DatabaseSync,
  ids: readonly number[],
): Map<number, BandejaQuestion[]> {
  const out = new Map<number, BandejaQuestion[]>();
  if (ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT * FROM bandeja_questions WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY entry_id, n`,
    )
    .all(...ids) as QuestionRow[];
  for (const row of rows) {
    out.set(row.entry_id, [...(out.get(row.entry_id) ?? []), questionOf(row)]);
  }
  return out;
}

export function insertQuestion(
  db: DatabaseSync,
  entry: number,
  question: {
    n: number;
    text: string;
    options: readonly string[];
    recommended?: number | undefined;
    by: string;
    at: string;
  },
): void {
  const sql = `INSERT INTO bandeja_questions (entry_id, n, text, options, recommended, asked_by, at)
    VALUES (:entry, :n, :text, :options, :recommended, :by, :at)`;
  db.prepare(sql).run({
    entry,
    n: question.n,
    text: question.text,
    options: question.options.length === 0 ? null : JSON.stringify(question.options),
    recommended: question.recommended ?? null,
    by: question.by,
    at: question.at,
  });
}

// Records the answer on the question, only while it is still unanswered. True when this call did.
export function answerQuestionRow(
  db: DatabaseSync,
  entry: number,
  n: number,
  answer: { text: string; mode: 'option' | 'text' | 'delegated'; option?: number | undefined },
  at: string,
): boolean {
  const sql = `UPDATE bandeja_questions
    SET answer_text = :text, answer_mode = :mode, answer_option = :option, answered_at = :at
    WHERE entry_id = :entry AND n = :n AND answered_at IS NULL`;
  const result = db
    .prepare(sql)
    .run({ entry, n, text: answer.text, mode: answer.mode, option: answer.option ?? null, at });
  return Number(result.changes) === 1;
}

// Holds the entry for `agent` until `until`, unless another holds it still (its lease not run out
// at `at`), it is filed, or `agent` asked and waits: atomic, so two refiners never both take it.
// True when this call took (or kept) it.
export function holdEntry(
  db: DatabaseSync,
  id: number,
  agent: string,
  at: string,
  until: string,
): boolean {
  const sql = `UPDATE bandeja_entries
    SET claimed_by = :agent, claimed_at = :at, claim_until = :until
    WHERE id = :id AND filed_at IS NULL
      AND (claimed_by IS NULL OR claimed_by = :agent OR claim_until <= :at)`;
  return Number(db.prepare(sql).run({ id, agent, at, until }).changes) === 1;
}

// How many entries wait for the secretary at `at` (nobody holds them, none is filed, no question
// waits for the person), and since when the oldest does.
export function countWaitingEntries(
  db: DatabaseSync,
  at: string,
): { count: number; since: string | null } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(e.at) AS since FROM bandeja_entries e
       WHERE e.filed_at IS NULL AND (e.claimed_by IS NULL OR e.claim_until <= :at)
         AND NOT EXISTS (SELECT 1 FROM bandeja_questions q WHERE q.entry_id = e.id AND q.answered_at IS NULL)`,
    )
    .get({ at }) as { n: number; since: string | null };
  return { count: Number(row.n), since: row.since };
}

// Any call of a refiner keeps the entries it holds (as it keeps its items' leases): their lease
// starts over. Only those still held at `at`; one that ran out is not taken back.
export function renewEntries(db: DatabaseSync, agent: string, at: string, until: string): void {
  db.prepare(
    `UPDATE bandeja_entries SET claim_until = :until
     WHERE claimed_by = :agent AND filed_at IS NULL AND claim_until > :at`,
  ).run({ agent, at, until });
}

export function releaseEntry(db: DatabaseSync, id: number): void {
  db.prepare(
    'UPDATE bandeja_entries SET claimed_by = NULL, claimed_at = NULL, claim_until = NULL WHERE id = ?',
  ).run(id);
}

// Files the entry under the item it became, only while the agent holds it. True when this call did.
export function fileEntry(
  db: DatabaseSync,
  id: number,
  agent: string,
  item: string,
  at: string,
): boolean {
  const sql = `UPDATE bandeja_entries
    SET item_id = :item, filed_by = :agent, filed_at = :at, claimed_by = NULL, claimed_at = NULL, claim_until = NULL
    WHERE id = :id AND filed_at IS NULL AND claimed_by = :agent AND claim_until > :at`;
  return Number(db.prepare(sql).run({ id, agent, item, at }).changes) === 1;
}

// The entry an item was filed from.
export function selectEntryOfItem(db: DatabaseSync, item: string): EntryRow | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM bandeja_entries WHERE item_id = ? COLLATE NOCASE`)
    .get(item) as EntryRow | undefined;
}

// Whether any entry file has this hash (a board's deletion keeps what the Bandeja holds).
export function entryFileKept(db: DatabaseSync, sha256: string): boolean {
  return (
    db.prepare('SELECT 1 FROM bandeja_attachments WHERE sha256 = ? LIMIT 1').get(sha256) !==
    undefined
  );
}
