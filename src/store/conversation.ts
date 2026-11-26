import type { DatabaseSync } from 'node:sqlite';
import type {
  AnswerMode,
  KindBy,
  Message,
  MessageAuthor,
  MessageChoice,
  MessageFile,
  MessageKind,
} from '../core/conversation.ts';

// The conversation's rows: messages, the files that came with them and the items each turn
// produced. A message's turn is its root (the person's message that began it, see
// core/conversation.ts); the kind and the links are kept on the root and read through it.

type MessageRow = {
  id: number;
  author: MessageAuthor;
  author_name: string;
  text: string;
  at: string;
  reply_to: number | null;
  root: number;
  read_at: string | null;
  topic: string | null;
  options: string | null;
  recommended: number | null;
  choice: AnswerMode | null;
  choice_option: number | null;
  about: string | null;
  asked: string | null;
  heard_at: string | null;
};

const COLUMNS =
  'm.id, m.author, m.author_name, m.text, m.at, m.reply_to, m.root, m.read_at, m.topic, m.options, m.recommended, m.choice, m.choice_option, m.about, m.asked, m.heard_at';

export type NewMessage = {
  author: MessageAuthor;
  name: string;
  text: string;
  at: string;
  replyTo?: number | undefined;
  topic?: string | undefined;
  // Who sent it (the device, or the desk's session), the key it sent it under and a digest of it.
  client?: { scope: string; key: string; digest: string } | undefined;
  // Already read: what is not the person's for the secretary to answer (and a topic's record).
  read?: boolean;
  // A question with options to tap.
  options?: readonly string[] | undefined;
  recommended?: number | undefined;
  // The person's answer to a question: how, and what it records when it is only a trace.
  choice?: { mode: AnswerMode; option?: number | undefined; about?: string; asked?: string };
};

// A person's message begins a turn; any other joins the turn of the message it answers, or begins
// its own when it answers none.
export function insertMessage(db: DatabaseSync, message: NewMessage): number {
  const above =
    message.author === 'person' || message.replyTo === undefined
      ? undefined
      : (
          db.prepare('SELECT root FROM conversation_messages WHERE id = ?').get(message.replyTo) as
            | { root: number }
            | undefined
        )?.root;
  const sql = `INSERT INTO conversation_messages
    (author, author_name, text, at, reply_to, root, read_at, topic, client_scope, client_key, client_digest,
     options, recommended, choice, choice_option, about, asked)
    VALUES (:author, :name, :text, :at, :replyTo, :root, :readAt, :topic, :scope, :key, :digest,
     :options, :recommended, :choice, :choiceOption, :about, :asked)`;
  const result = db.prepare(sql).run({
    author: message.author,
    name: message.name,
    text: message.text,
    at: message.at,
    replyTo: message.replyTo ?? null,
    root: above ?? null,
    readAt: message.read ? message.at : null,
    topic: message.topic ?? null,
    scope: message.client?.scope ?? null,
    key: message.client?.key ?? null,
    digest: message.client?.digest ?? null,
    options:
      message.options === undefined || message.options.length === 0
        ? null
        : JSON.stringify(message.options),
    recommended: message.recommended ?? null,
    choice: message.choice?.mode ?? null,
    choiceOption: message.choice?.option ?? null,
    about: message.choice?.about ?? null,
    asked: message.choice?.asked ?? null,
  });
  const id = Number(result.lastInsertRowid);
  if (above === undefined) {
    db.prepare('UPDATE conversation_messages SET root = id WHERE id = ?').run(id);
  }
  return id;
}

export type NewFile = Omit<MessageFile, 'id'>;

export function insertAttachment(db: DatabaseSync, messageId: number, file: NewFile): number {
  const sql = `INSERT INTO conversation_attachments
    (message_id, filename, content_type, kind, size, sha256)
    VALUES (:messageId, :name, :contentType, :kind, :size, :sha256)`;
  const result = db.prepare(sql).run({ messageId, ...file });
  return Number(result.lastInsertRowid);
}

export function insertLink(db: DatabaseSync, root: number, item: string, at: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO conversation_links (message_id, item_id, at) VALUES (?, ?, ?)',
  ).run(root, item, at);
}

// The message a client already sent under this key, for this device or session, and the digest of
// what it sent.
export function messageOfClientKey(
  db: DatabaseSync,
  scope: string,
  key: string,
): { id: number; digest: string | null } | undefined {
  return db
    .prepare(
      'SELECT id, client_digest AS digest FROM conversation_messages WHERE client_scope = ? AND client_key = ?',
    )
    .get(scope, key) as { id: number; digest: string | null } | undefined;
}

// Sets (or, with the same, keeps) the kind of the turn whose root is `root`, and who set it.
// `news`: the person changed it, and the secretary has not read that yet (a later setKind by anyone
// else keeps it until the secretary reads the turn).
export function setKind(
  db: DatabaseSync,
  root: number,
  kind: MessageKind,
  by: KindBy,
  news = false,
): void {
  db.prepare(
    'UPDATE conversation_messages SET kind = ?, kind_by = ?, kind_news = CASE WHEN ? THEN 1 ELSE kind_news END WHERE id = ?',
  ).run(kind, by, news ? 1 : 0, root);
}

// The turns whose kind the person changed and the secretary has not read yet, oldest first: the root
// and the words of the message that began each. `waking`: only those still worth a wake (not the
// ones already brought back KIND_WAKES times); a read takes them all.
export function selectKindNews(db: DatabaseSync, waking = false): { root: number; text: string }[] {
  return db
    .prepare(
      `SELECT id AS root, text FROM conversation_messages WHERE kind_news BETWEEN 1 AND ${waking ? KIND_WAKES : 1_000_000} ORDER BY id`,
    )
    .all() as { root: number; text: string }[];
}

// The secretary read these turns: their kind is no news any more.
export function clearKindNews(db: DatabaseSync, roots: readonly number[]): void {
  const clear = db.prepare('UPDATE conversation_messages SET kind_news = 0 WHERE id = ?');
  for (const root of roots) clear.run(root);
}

// The person's messages the secretary's wait returned and it has not read yet: noted once, the
// first time, so the desk can say it was heard. The ones this call marked.
export function markHeard(db: DatabaseSync, at: string): number {
  return Number(
    db
      .prepare(
        "UPDATE conversation_messages SET heard_at = ? WHERE author = 'person' AND read_at IS NULL AND heard_at IS NULL",
      )
      .run(at).changes,
  );
}

// Whether the person has answered this question of the secretary's: a message of theirs that replies
// to it. What else they say, or answer to other questions, leaves it open.
export function isAnswered(db: DatabaseSync, id: number): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM conversation_messages WHERE author = 'person' AND reply_to = ? LIMIT 1",
      )
      .get(id) !== undefined
  );
}

// A wake for a changed kind is returned at most this many times when the secretary does nothing
// about it (the counter kind_news runs 1, 2, then it is let go).
export const KIND_WAKES = 2;

// The wait returned this turn's changed kind: one delivery counted.
export function bumpKindNews(db: DatabaseSync, root: number): void {
  db.prepare(
    'UPDATE conversation_messages SET kind_news = kind_news + 1 WHERE id = ? AND kind_news BETWEEN 1 AND ?',
  ).run(root, KIND_WAKES);
}

// Every message of a turn, in order.
export function selectTurn(db: DatabaseSync, root: number): Message[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM conversation_messages m WHERE m.root = ? ORDER BY m.id`)
    .all(root) as MessageRow[];
  return hydrate(db, rows);
}

export function selectRootKind(
  db: DatabaseSync,
  root: number,
): { kind: MessageKind | null; by: KindBy | null } {
  const row = db
    .prepare('SELECT kind, kind_by FROM conversation_messages WHERE id = ?')
    .get(root) as { kind: MessageKind | null; kind_by: KindBy | null } | undefined;
  return { kind: row?.kind ?? null, by: row?.kind_by ?? null };
}

function filesOf(db: DatabaseSync, ids: readonly number[]): Map<number, MessageFile[]> {
  const files = new Map<number, MessageFile[]>();
  if (ids.length === 0) return files;
  const rows = db
    .prepare(
      `SELECT id, message_id AS messageId, filename AS name, content_type AS contentType, kind, size, sha256
       FROM conversation_attachments WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    )
    .all(...ids) as (MessageFile & { messageId: number })[];
  for (const { messageId, ...file } of rows) {
    files.set(messageId, [...(files.get(messageId) ?? []), file]);
  }
  return files;
}

function linksOf(db: DatabaseSync, roots: readonly number[]): Map<number, string[]> {
  const links = new Map<number, string[]>();
  if (roots.length === 0) return links;
  const rows = db
    .prepare(
      `SELECT message_id AS root, item_id AS item FROM conversation_links
       WHERE message_id IN (${roots.map(() => '?').join(',')}) ORDER BY rowid`,
    )
    .all(...roots) as { root: number; item: string }[];
  for (const { root, item } of rows) links.set(root, [...(links.get(root) ?? []), item]);
  return links;
}

function hydrate(db: DatabaseSync, rows: readonly MessageRow[]): Message[] {
  if (rows.length === 0) return [];
  const attachments = filesOf(
    db,
    rows.map(({ id }) => id),
  );
  const roots = [...new Set(rows.map(({ root }) => root))];
  const heads = new Map(
    (
      db
        .prepare(
          `SELECT id, kind, kind_by, kind_news FROM conversation_messages WHERE id IN (${roots.map(() => '?').join(',')})`,
        )
        .all(...roots) as {
        id: number;
        kind: MessageKind | null;
        kind_by: KindBy | null;
        kind_news: number;
      }[]
    ).map((row) => [row.id, row]),
  );
  const links = linksOf(db, roots);
  return rows.map((row) => {
    const head = heads.get(row.root);
    return {
      id: row.id,
      author: row.author,
      by: row.author_name,
      text: row.text,
      at: row.at,
      replyTo: row.reply_to,
      root: row.root,
      kind: head?.kind ?? null,
      kindBy: head?.kind_by ?? null,
      links: links.get(row.root) ?? [],
      attachments: attachments.get(row.id) ?? [],
      delivery: row.author === 'person' ? (row.read_at === null ? 'pending' : 'read') : null,
      readAt: row.read_at,
      topic: row.topic,
      options: row.options === null ? [] : (JSON.parse(row.options) as string[]),
      recommended: row.recommended,
      choice: choiceOf(row),
      heardAt: row.heard_at,
      kindNews: (head?.kind_news ?? 0) > 0,
    };
  });
}

function choiceOf(row: MessageRow): MessageChoice | null {
  return row.choice === null
    ? null
    : { mode: row.choice, option: row.choice_option, about: row.about, asked: row.asked };
}

export function selectMessage(db: DatabaseSync, id: number): Message | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM conversation_messages m WHERE m.id = ?`).get(id) as
    | MessageRow
    | undefined;
  return row ? hydrate(db, [row])[0] : undefined;
}

export type Page = {
  // Only the messages after this one (the newest ones come last).
  since?: number | undefined;
  // Only the messages before this one: an earlier page.
  before?: number | undefined;
  limit: number;
  // The words a turn holds (any case): its messages whose turn has one that does.
  search?: string | undefined;
  // Only the turns of this kind.
  kind?: MessageKind | undefined;
};

// A page of messages in order (oldest first), and whether more lie beyond it: after `since` the next
// ones, before `before` the earlier ones, else the newest. A kind or a search keeps the whole turns
// that match.
export function selectMessages(
  db: DatabaseSync,
  page: Page,
): { messages: Message[]; more: boolean } {
  const where: string[] = [];
  const params: Record<string, string | number> = { limit: page.limit + 1 };
  if (page.since !== undefined) {
    where.push('m.id > :since');
    params.since = page.since;
  }
  if (page.before !== undefined) {
    where.push('m.id < :before');
    params.before = page.before;
  }
  if (page.kind !== undefined) {
    where.push('m.root IN (SELECT id FROM conversation_messages WHERE kind = :kind)');
    params.kind = page.kind;
  }
  const words = (page.search ?? '').trim();
  if (words !== '') {
    where.push(
      "m.root IN (SELECT root FROM conversation_messages WHERE text LIKE :words ESCAPE '\\')",
    );
    params.words = `%${words.replace(/[\\%_]/g, '\\$&')}%`;
  }
  const ascending = page.since !== undefined;
  const sql = `SELECT ${COLUMNS} FROM conversation_messages m
    ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
    ORDER BY m.id ${ascending ? 'ASC' : 'DESC'} LIMIT :limit`;
  const rows = db.prepare(sql).all(params) as MessageRow[];
  const more = rows.length > page.limit;
  const kept = rows.slice(0, page.limit);
  if (!ascending) kept.reverse();
  return { messages: hydrate(db, kept), more };
}

// The person's messages the secretary has not read, oldest first.
export function selectPending(db: DatabaseSync): { id: number; text: string }[] {
  return db
    .prepare(
      "SELECT id, text FROM conversation_messages WHERE author = 'person' AND read_at IS NULL ORDER BY id",
    )
    .all() as { id: number; text: string }[];
}

// The secretary's messages said in a turn the person began, from `since` (an ISO time), oldest first.
// What a notice about a reply reads; never the topics' records.
export function selectRepliesSince(
  db: DatabaseSync,
  since: string,
): { id: number; root: number; by: string; text: string }[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.root, m.author_name, m.text FROM conversation_messages m
       JOIN conversation_messages r ON r.id = m.root
       WHERE m.author = 'secretary' AND r.author = 'person' AND m.topic IS NULL AND m.at >= ?
       ORDER BY m.id`,
    )
    .all(since) as { id: number; root: number; author_name: string; text: string }[];
  return rows.map((row) => ({ id: row.id, root: row.root, by: row.author_name, text: row.text }));
}

export function countPending(db: DatabaseSync): { count: number; since: string | null } {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, MIN(at) AS since FROM conversation_messages WHERE author = 'person' AND read_at IS NULL",
    )
    .get() as { n: number; since: string | null };
  return { count: Number(row.n), since: row.since };
}

// Marks the person's messages among `ids` as read; the ones this call marked.
export function markRead(db: DatabaseSync, ids: readonly number[], at: string): number[] {
  const marked: number[] = [];
  const mark = db.prepare(
    "UPDATE conversation_messages SET read_at = ? WHERE id = ? AND author = 'person' AND read_at IS NULL",
  );
  for (const id of ids) if (Number(mark.run(at, id).changes) === 1) marked.push(id);
  return marked;
}

// The turns an item came out of: the root of each, newest last.
export function selectTurnsOfItem(db: DatabaseSync, item: string): Message[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM conversation_messages m
       JOIN conversation_links l ON l.message_id = m.id
       WHERE l.item_id = ? COLLATE NOCASE AND m.author <> 'secretary' ORDER BY m.id`,
    )
    .all(item) as MessageRow[];
  return hydrate(db, rows);
}

// The latest message of the topic, the one a new turn of it answers.
export function latestOfTopic(db: DatabaseSync, topic: string): number | undefined {
  const row = db
    .prepare('SELECT MAX(id) AS id FROM conversation_messages WHERE topic = ?')
    .get(topic) as { id: number | null };
  return row.id ?? undefined;
}

// What a say that classifies or links with no --reply-to would aim at: the latest of the person's
// messages that the secretary already read (never a topic's record), and what makes that a guess:
// messages not read yet, and other read turns not classified.
export function selectDefaultTurn(db: DatabaseSync): {
  latest: number | undefined;
  unread: number;
  otherUnclassified: number;
} {
  const latest = (
    db
      .prepare(
        "SELECT MAX(id) AS id FROM conversation_messages WHERE author = 'person' AND topic IS NULL AND about IS NULL AND read_at IS NOT NULL",
      )
      .get() as { id: number | null }
  ).id;
  const unread = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM conversation_messages WHERE author = 'person' AND topic IS NULL AND about IS NULL AND read_at IS NULL",
      )
      .get() as { n: number }
  ).n;
  const others = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversation_messages
         WHERE author = 'person' AND topic IS NULL AND about IS NULL AND read_at IS NOT NULL AND kind IS NULL AND id <> :latest`,
      )
      .get({ latest: latest ?? 0 }) as { n: number }
  ).n;
  return { latest: latest ?? undefined, unread: Number(unread), otherUnclassified: Number(others) };
}
