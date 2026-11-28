import type { DatabaseSync } from 'node:sqlite';

// What a write of the person answered, by the Idempotency-Key it came with (see the replays
// migration). A client's key is its own, and one route's.
export type Replay = { digest: string; status: number; body: string };

export function selectReplay(
  db: DatabaseSync,
  scope: string,
  key: string,
  route: string,
): Replay | undefined {
  return db
    .prepare('SELECT digest, status, body FROM replays WHERE scope = ? AND key = ? AND route = ?')
    .get(scope, key, route) as Replay | undefined;
}

// Kept a week: far past any phone's retries, and the table stays small.
const KEPT_MS = 7 * 24 * 60 * 60 * 1000;

export function insertReplay(
  db: DatabaseSync,
  scope: string,
  key: string,
  route: string,
  replay: Replay,
  at: string,
): void {
  db.prepare('DELETE FROM replays WHERE at < ?').run(
    new Date(Date.parse(at) - KEPT_MS).toISOString(),
  );
  db.prepare(
    `INSERT OR IGNORE INTO replays (scope, key, route, digest, status, body, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(scope, key, route, replay.digest, replay.status, replay.body, at);
}
