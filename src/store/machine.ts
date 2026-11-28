import type { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations.ts';

// What belongs to this computer's one Otea server rather than to a project ($OTEA_HOME/machine.db):
// the paired devices, how a phone reaches the server, who is told when something becomes yours, the
// local projects the server was asked to serve and the person's preferences. The tables of devices,
// phone and notify_targets are laid out as a project's used to be, so the use cases in app/ read
// them the same way.
export const MACHINE_MIGRATIONS = [
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    paired_at TEXT NOT NULL,
    last_seen_at TEXT
  );

  CREATE TABLE phone (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    transport TEXT NOT NULL,
    tailscale_host TEXT,
    lan_open INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE notify_targets (
    id TEXT PRIMARY KEY,
    device TEXT UNIQUE REFERENCES devices (id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT,
    lang TEXT NOT NULL,
    prefs TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE local_projects (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    added_at TEXT NOT NULL
  );
  `,
  // How each paired device last reached Otea: 'tailscale' (HTTPS through tailscale serve) or
  // 'lan'; NULL until it is seen again. The Tailscale guide's last step reads it.
  `
  ALTER TABLE devices ADD COLUMN via TEXT;
  `,
  // What the person chose, not a device: today the language of the desk, which everything Otea
  // makes without a desk to ask (otea init, otea board add) is written in.
  `
  CREATE TABLE preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // The assistant was "the secretary" while 0.8 was built: the two notice switches a device chose
  // under that word keep their choice under the new one.
  `
  UPDATE notify_targets
     SET prefs = replace(replace(prefs, '"secretary_reply"', '"assistant_reply"'),
                         '"secretary_offline"', '"assistant_offline"')
   WHERE prefs LIKE '%"secretary_%';
  `,
];

export function migrateMachine(db: DatabaseSync): void {
  applyMigrations(db, MACHINE_MIGRATIONS);
}

export function selectPreference(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function upsertPreference(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

// A local project (.otea/ in its folder) the server serves beside the registered ones.
export type LocalProjectRow = { id: string; root: string };

export function upsertLocalProject(db: DatabaseSync, project: LocalProjectRow, at: string): void {
  db.prepare(
    `INSERT INTO local_projects (id, root, added_at) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET root = excluded.root`,
  ).run(project.id, project.root, at);
}

export function selectLocalProjects(db: DatabaseSync): LocalProjectRow[] {
  return db
    .prepare('SELECT id, root FROM local_projects ORDER BY added_at, rowid')
    .all() as LocalProjectRow[];
}

export function deleteLocalProject(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM local_projects WHERE id = ?').run(id);
}
