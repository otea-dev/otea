import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.ts';
import { MACHINE_MIGRATIONS } from './machine.ts';
import { applyMigrations } from './migrations.ts';

describe('the machine database', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => db.close());

  // The assistant was "the secretary" while 0.8 was built: a device keeps the choice it made for
  // the two notice switches under the new names.
  it('keeps a device’s assistant notice switches when they were stored under the old word', () => {
    applyMigrations(db, MACHINE_MIGRATIONS.slice(0, -1));
    db.exec(`
      INSERT INTO notify_targets (id, lang, prefs, created_at) VALUES
        ('desktop', 'es', '{"turn":true,"secretary_reply":false,"secretary_offline":true}', 't'),
        ('other', 'en', '{"turn":true,"assistant_reply":false}', 't');
    `);

    applyMigrations(db, MACHINE_MIGRATIONS);

    expect(db.prepare('SELECT id, prefs FROM notify_targets ORDER BY id').all()).toEqual([
      { id: 'desktop', prefs: '{"turn":true,"assistant_reply":false,"assistant_offline":true}' },
      { id: 'other', prefs: '{"turn":true,"assistant_reply":false}' },
    ]);
  });
});
