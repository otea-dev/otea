import type { DatabaseSync } from 'node:sqlite';
import type { AgentRole, SecretarySignalKind } from '../core/secretary.ts';

// The secretary's rows: the role an agent declared (agents.role), the signals that wake it
// (secretary_signals) and the stretches a board has gone unheard (unheard_stretches).
//
// A signal or a stretch is *returned* by a wait (taken_at / told_at), and *acked* once the secretary
// acted: its next otea command that is no secretary wait (ackReturned). Until then a later wait
// returns it again (app/secretary.ts), so a response lost with a killed wait is never lost.

// Gives an agent a role, or takes it back (null). The agent is noted as seen `at` when it was not
// known yet (otea connect --as names an agent before its first session).
export function saveRole(
  db: DatabaseSync,
  agent: string,
  role: AgentRole | null,
  at: string,
): void {
  const sql = `INSERT INTO agents (name, last_seen, role) VALUES (:agent, :at, :role)
    ON CONFLICT (name) DO UPDATE SET role = excluded.role`;
  db.prepare(sql).run({ agent, at, role });
}

// The role each agent that has one declared.
export function selectRoles(db: DatabaseSync): Map<string, AgentRole> {
  const rows = db.prepare('SELECT name, role FROM agents WHERE role IS NOT NULL').all() as {
    name: string;
    role: AgentRole;
  }[];
  return new Map(rows.map(({ name, role }) => [name, role]));
}

export type SignalRecord = {
  id: number;
  kind: SecretarySignalKind;
  ref: string | null;
  text: string | null;
  at: string;
  // When a wait last returned it (null: none yet), and how many times it was returned.
  takenAt: string | null;
  deliveries: number;
};

export function insertSignal(
  db: DatabaseSync,
  signal: { kind: SecretarySignalKind; ref?: string | undefined; text?: string | undefined },
  at: string,
): number {
  const sql =
    'INSERT INTO secretary_signals (kind, ref, text, at) VALUES (:kind, :ref, :text, :at)';
  const result = db
    .prepare(sql)
    .run({ kind: signal.kind, ref: signal.ref ?? null, text: signal.text ?? null, at });
  return Number(result.lastInsertRowid);
}

// The signals not acked yet, oldest first: new ones, and those a wait returned that the secretary
// has not acted on.
export function selectOpenSignals(db: DatabaseSync): SignalRecord[] {
  const sql = `SELECT id, kind, ref, text, at, taken_at AS takenAt, deliveries
    FROM secretary_signals WHERE acked_at IS NULL ORDER BY id`;
  return db.prepare(sql).all() as SignalRecord[];
}

// What agents escalated that the secretary has not acted on yet, oldest first.
export function selectOpenEscalations(
  db: DatabaseSync,
): { id: number; ref: string | null; text: string; at: string }[] {
  const sql = `SELECT id, ref, COALESCE(text, '') AS text, at FROM secretary_signals
    WHERE kind = 'escalation' AND acked_at IS NULL ORDER BY id`;
  return db.prepare(sql).all() as { id: number; ref: string | null; text: string; at: string }[];
}

export function countPendingSignals(db: DatabaseSync): number {
  const sql = 'SELECT COUNT(*) AS n FROM secretary_signals WHERE acked_at IS NULL';
  return Number((db.prepare(sql).get() as { n: number }).n);
}

// Returns the signal to one wait, atomically: only if nobody returned it since `was` (the taken_at
// the caller read), so two waits at once never both get it. True when this call took it.
export function takeSignal(db: DatabaseSync, id: number, was: string | null, at: string): boolean {
  const sql = `UPDATE secretary_signals SET taken_at = :at, deliveries = deliveries + 1
    WHERE id = :id AND acked_at IS NULL AND taken_at IS :was`;
  return Number(db.prepare(sql).run({ id, was, at }).changes) === 1;
}

// A signal returned twice and still not acted on is let go: the secretary saw it.
export function dropSignal(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE secretary_signals SET acked_at = :at WHERE id = :id').run({ id, at });
}

// The secretary acted: everything returned to it so far is acked.
export function ackReturned(db: DatabaseSync, at: string): void {
  db.prepare(
    'UPDATE secretary_signals SET acked_at = :at WHERE taken_at IS NOT NULL AND acked_at IS NULL',
  ).run({ at });
  db.prepare(
    'UPDATE unheard_stretches SET acked_at = :at WHERE told_at IS NOT NULL AND acked_at IS NULL',
  ).run({ at });
}

export type StretchRecord = {
  // When the stretch began (ms), and when a look last found it unheard (ms).
  since: number;
  seenAt: number;
  // When a wait last returned it (null: not yet), how many times, and whether the secretary acked.
  toldAt: string | null;
  tells: number;
  acked: boolean;
};

// The stretches of unheard work, by the key they are counted under.
export function selectStretches(db: DatabaseSync): Map<string, StretchRecord> {
  const rows = db
    .prepare('SELECT key, since, seen_at, told_at, tells, acked_at FROM unheard_stretches')
    .all() as {
    key: string;
    since: number;
    seen_at: number | null;
    told_at: string | null;
    tells: number;
    acked_at: string | null;
  }[];
  return new Map(
    rows.map((row) => [
      row.key,
      {
        since: row.since,
        seenAt: row.seen_at ?? row.since,
        toldAt: row.told_at,
        tells: row.tells,
        acked: row.acked_at !== null,
      },
    ]),
  );
}

export function insertStretch(db: DatabaseSync, key: string, since: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO unheard_stretches (key, since, seen_at) VALUES (:key, :since, :since)',
  ).run({ key, since });
}

export function touchStretch(db: DatabaseSync, key: string, seenAt: number): void {
  db.prepare('UPDATE unheard_stretches SET seen_at = :seenAt WHERE key = :key').run({
    key,
    seenAt,
  });
}

export function deleteStretch(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM unheard_stretches WHERE key = ?').run(key);
}

// Returns the stretch to one wait, atomically (as takeSignal): only if nobody returned it since
// `was`. True when this call took it.
export function tellStretch(
  db: DatabaseSync,
  key: string,
  was: string | null,
  at: string,
): boolean {
  const sql = `UPDATE unheard_stretches SET told_at = :at, tells = tells + 1, acked_at = NULL
    WHERE key = :key AND told_at IS :was`;
  return Number(db.prepare(sql).run({ key, was, at }).changes) === 1;
}

export function dropStretch(db: DatabaseSync, key: string, at: string): void {
  db.prepare('UPDATE unheard_stretches SET acked_at = :at WHERE key = :key').run({ key, at });
}

// A listener on the boards appeared: nothing is unheard any more, and no stretch goes on. Not for
// the secretary, which is no listener (app/presence.ts waitBeat).
export function clearStretchesFor(db: DatabaseSync, agent: string): void {
  db.prepare(
    `DELETE FROM unheard_stretches
     WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = :agent AND role = 'secretary')`,
  ).run({ agent });
}
