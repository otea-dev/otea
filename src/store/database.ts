import { DatabaseSync } from 'node:sqlite';
import { OteaError } from '../core/errors.ts';

// SQLite's bare «unable to open database file» says nothing a person or an agent can act on: the
// path, the usual cause and what to do are said instead (field study 4, U3: an agent in a sandbox
// that cannot write Otea's folder, which cannot even escalate, as that needs the same database).
function unopenable(path: string, error: unknown): Error {
  if (!/unable to open database file/i.test(String((error as Error)?.message))) {
    return error as Error;
  }
  return new OteaError(
    'forbidden',
    `Otea cannot open its database at ${path}: this session most likely has no permission to write there (a sandbox, a read-only folder or drive, or the folder is missing). Stop and tell the person; do not change Otea or its files.`,
  );
}

export function openDatabase(path: string): DatabaseSync {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    throw unopenable(path, error);
  }
  // The timeout goes first: switching to WAL needs a lock, and another process may hold it.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// Opens the database at `path` and runs `setup` on it (migrations and what depends on them). When
// `setup` throws the connection is closed first, so a database that cannot be opened is not left
// locked by the attempt.
export function openWithSetup<T>(path: string, setup: (db: DatabaseSync) => T): T {
  const db = openDatabase(path);
  try {
    return setup(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Runs `fn` in the transaction already open on `db`, or opens one: for a step that is atomic alone
// and also part of a larger atomic action (a command that declares two things or none).
export function joinTransaction<T>(db: DatabaseSync, fn: () => T): T {
  return db.isTransaction ? fn() : transaction(db, fn);
}

export function dataVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA data_version').get()?.data_version);
}

// A consistent copy of the whole database in a new file, taken without blocking other connections.
export function vacuumInto(db: DatabaseSync, path: string): void {
  db.prepare('VACUUM INTO ?').run(path);
}

export function integrityCheck(db: DatabaseSync): string {
  const rows = db.prepare('PRAGMA integrity_check').all();
  return rows.map((row) => String(row.integrity_check)).join(' ');
}

export type TableSummary = Record<string, { rows: number; lastRowid: number }>;

// Per table, its row count and highest rowid: two copies that agree hold the same rows, unless a
// row was changed in place.
export function tableSummary(db: DatabaseSync): TableSummary {
  const sql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
  const names = db
    .prepare(sql)
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(
    names.sort().map((name) => {
      const row = db.prepare(`SELECT count(*) AS n, max(rowid) AS last FROM "${name}"`).get();
      return [name, { rows: Number(row?.n ?? 0), lastRowid: Number(row?.last ?? 0) }];
    }),
  );
}
