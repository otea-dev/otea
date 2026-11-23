import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertBoard, insertVersion, setLiveVersion } from '../store/boards.ts';
import { openDatabase } from '../store/database.ts';
import { migrate } from '../store/migrations.ts';
import { insertProjectIdentity, selectProjectLang, updateProjectLang } from '../store/queries.ts';
import { settleProjectLang, storedProjectLang } from './project-language.ts';

// A project's language is settled once, when it has none: from its Pedidos board, else today's rule.
describe('the language of a project', () => {
  const handles: DatabaseSync[] = [];
  let folder: string;

  const open = (path = ':memory:') => {
    const db = openDatabase(path);
    handles.push(db);
    return db;
  };

  const project = (db: DatabaseSync) => {
    migrate(db);
    insertProjectIdentity(db, { id: 'p-1', name: 'p' });
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'otea-project-lang-'));
  });

  afterEach(() => {
    for (const db of handles.splice(0)) db.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
  });

  // Two processes opening one project at once both find it with no language: the first to settle it
  // wins, and the second keeps what it finds instead of overwriting it.
  it('keeps the language the first of two handles on one file settled', () => {
    const path = join(folder, 'otea.db');
    const first = open(path);
    project(first);
    const second = open(path);
    expect(selectProjectLang(first)).toBeNull();
    expect(selectProjectLang(second)).toBeNull();

    updateProjectLang(first, 'es', true);
    updateProjectLang(second, 'en', true);

    expect(selectProjectLang(second)).toBe('es');
    expect(selectProjectLang(first)).toBe('es');
    // Choosing another language is not settling: it does change it.
    updateProjectLang(second, 'en');
    expect(selectProjectLang(first)).toBe('en');
  });

  it('reads a Pedidos board that cannot be read as saying nothing, so the project still opens', () => {
    const db = open();
    project(db);
    insertBoard(db, { id: 'b-1', createdAt: '2026-01-01T00:00:00.000Z', builtin: true });
    insertVersion(db, {
      boardId: 'b-1',
      version: 1,
      definition: '{ this is not json',
      publishedAt: '2026-01-01T00:00:00.000Z',
      publishedBy: 'otea',
    });
    setLiveVersion(db, 'b-1', 1);

    const lang = settleProjectLang(db, { LC_ALL: 'es_ES.UTF-8', OTEA_HOME: join(folder, 'home') });

    // Today's rule: no desk has spoken in this home, so the computer's language.
    expect(lang).toBe('es');
    expect(storedProjectLang(db)).toBe('es');
  });
});
