import type { DatabaseSync } from 'node:sqlite';
import type { AgentRole, SecretarySignalKind } from '../core/secretary.ts';

// The secretary's rows: the role an agent declared (agents.role), the signals that wake it
// (secretary_signals) and the stretches a board has gone unheard (unheard_stretches).

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

// The oldest signal no wait returned yet.
export function selectNextSignal(db: DatabaseSync): SignalRecord | undefined {
  const sql = `SELECT id, kind, ref, text, at FROM secretary_signals WHERE taken_at IS NULL
    ORDER BY id LIMIT 1`;
  return db.prepare(sql).get() as SignalRecord | undefined;
}

export function countPendingSignals(db: DatabaseSync): number {
  const sql = 'SELECT COUNT(*) AS n FROM secretary_signals WHERE taken_at IS NULL';
  return Number((db.prepare(sql).get() as { n: number }).n);
}

export function takeSignal(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE secretary_signals SET taken_at = :at WHERE id = :id').run({ id, at });
}

// When each stretch of unheard work began (ms), and whether the secretary was told of it.
export function selectStretches(db: DatabaseSync): Map<string, { since: number; told: boolean }> {
  const rows = db.prepare('SELECT key, since, told_at FROM unheard_stretches').all() as {
    key: string;
    since: number;
    told_at: string | null;
  }[];
  return new Map(rows.map((row) => [row.key, { since: row.since, told: row.told_at !== null }]));
}

export function insertStretch(db: DatabaseSync, key: string, since: number): void {
  db.prepare('INSERT OR IGNORE INTO unheard_stretches (key, since) VALUES (:key, :since)').run({
    key,
    since,
  });
}

export function deleteStretch(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM unheard_stretches WHERE key = ?').run(key);
}

export function tellStretch(db: DatabaseSync, key: string, at: string): void {
  db.prepare('UPDATE unheard_stretches SET told_at = :at WHERE key = :key').run({ key, at });
}
