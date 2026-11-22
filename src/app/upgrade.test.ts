import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../store/migrations.ts';
import { openRegistry } from './home.ts';
import { listItems } from './items.ts';
import { openMachine } from './machine.ts';
import { databasePath, openProject } from './project.ts';
import { listTopics } from './topics.ts';

// The project database the published @otea/cli@0.1.0 wrote: two items on the To-dos board, one image
// attached to the first, one answered topic. Regenerate it with scripts/make-upgrade-fixture.mjs.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'otea-0.1.0.db');

describe('upgrading a database', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // A local project at a temp folder whose database is a copy of `source`.
  function projectWith(source: string): { root: string; database: string } {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-upgrade-')));
    dirs.push(root);
    const database = databasePath(join(root, '.otea'));
    mkdirSync(join(root, '.otea'));
    copyFileSync(source, database);
    return { root, database };
  }

  const userVersion = (path: string) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return Number(db.prepare('PRAGMA user_version').get()?.user_version);
    } finally {
      db.close();
    }
  };

  it('opens the 0.1.0 database, migrates it and keeps every board, item, evidence and topic', () => {
    const { root, database } = projectWith(FIXTURE);
    // The schema version 0.1.0 shipped. A fixture regenerated from a later release would pass
    // without migrating anything, so the pin makes that a visible change.
    expect(userVersion(database)).toBe(41);

    const project = openProject(root, { OTEA_HOME: process.env.OTEA_HOME });
    try {
      expect(userVersion(database)).toBe(MIGRATIONS.length);

      const items = listItems(project);
      expect(items.map((item) => [item.id, item.title])).toEqual([
        ['TOD-1', 'First task'],
        ['TOD-2', 'Second task'],
      ]);

      const boards = project.db.prepare('SELECT collection FROM boards').all();
      expect(boards.map((row) => row.collection)).toContain('To-dos');

      const evidence = project.db
        .prepare('SELECT item_id, filename, content_type, caption FROM evidence')
        .all();
      expect(evidence).toEqual([
        {
          item_id: 'TOD-1',
          filename: 'px.png',
          content_type: 'image/png',
          caption: 'fixture pixel',
        },
      ]);

      const topics = listTopics(project, { all: true });
      expect(topics.map((topic) => [topic.id, topic.title])).toEqual([['TEM-1', 'Fixture topic']]);
      expect(JSON.stringify(topics[0])).toContain('Full fixture answer');
    } finally {
      project.db.close();
    }
  });

  it('refuses a database newer than this build and leaves it untouched', () => {
    // The fixture, marked as made by a later schema.
    const newer = projectWith(FIXTURE);
    const db = new DatabaseSync(newer.database);
    // Otea keeps its databases in WAL mode; switching a file to it rewrites its header, which would
    // read as a change below.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    const before = readFileSync(newer.database);

    expect(() => openProject(newer.root, { OTEA_HOME: process.env.OTEA_HOME })).toThrow(
      /newer Otea.*Update Otea/s,
    );

    expect(readFileSync(newer.database).equals(before)).toBe(true);
    expect(userVersion(newer.database)).toBe(MIGRATIONS.length + 1);
    // The refused open must not keep the file: Windows cannot delete a file a connection holds.
    expect(() => rmSync(newer.database)).not.toThrow();
  });

  it.each([
    ['registry.db', openRegistry],
    ['machine.db', openMachine],
  ])('refuses a newer %s and releases the file', (name, open) => {
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-home-')));
    dirs.push(home);
    const db = new DatabaseSync(join(home, name));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA user_version = 9999');
    db.close();

    expect(() => open({ OTEA_HOME: home })).toThrow(/newer Otea/);

    expect(() => rmSync(join(home, name))).not.toThrow();
  });
});
