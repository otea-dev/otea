import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.ts';
import { migrate } from '../store/migrations.ts';
import { listConsultations } from './conversation.ts';
import { openProject, type Project } from './project.ts';
import { listTopics } from './topics.ts';

const ENV = { OTEA_HOME: process.env.OTEA_HOME };

// 0.7 had run this many migrations (topics exist, the conversation does not).
const VERSION_07 = 42;

describe('topics of a 0.7 project', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function oldProject(): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-topics-up-')));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, '.otea'));
    const db = openDatabase(join(dir, '.otea', 'otea.db'));
    migrate(db, VERSION_07);
    db.exec(`
      INSERT INTO collections (name, prefix, next_seq) VALUES ('Tareas', 'TAR', 2);
      INSERT INTO items (id, collection, seq, title, state, created_at, updated_at, created_by_kind, created_by_name)
        VALUES ('TAR-1', 'Tareas', 1, 'Fix the cache', 'open', '2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z', 'human', 'fede');
      INSERT INTO topics_switch (id, enabled) VALUES (1, 1);
      INSERT INTO topics (id, seq, title, state, agent, created_at, updated_at, created_by_kind, created_by_name)
        VALUES ('TOP-1', 1, 'Why is the build slow?', 'answered', 'quill', '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z', 'human', 'fede'),
               ('TOP-2', 2, 'Which port does the desk use?', 'open', 'quill', '2026-11-02T10:00:00.000Z', '2026-11-02T10:00:00.000Z', 'human', 'fede');
      INSERT INTO topic_turns (topic_id, kind, text, full, source, actor_kind, actor_name, at) VALUES
        ('TOP-1', 'question', 'Why is the build slow?', NULL, NULL, 'human', 'fede', '2026-11-01T10:00:00.000Z'),
        ('TOP-1', 'answer', 'Cold cache.', 'The cache is cold on every CI run, so everything builds.', 'agent', 'agent', 'quill', '2026-11-01T10:05:00.000Z'),
        ('TOP-1', 'event', 'The task was deleted.', NULL, NULL, 'human', 'fede', '2026-11-01T10:06:00.000Z'),
        ('TOP-2', 'question', 'Which port does the desk use?', NULL, NULL, 'human', 'fede', '2026-11-02T10:00:00.000Z');
      INSERT INTO topic_links (topic_id, item_id, via, at) VALUES ('TOP-1', 'TAR-1', 'confirmed', '2026-11-01T10:07:00.000Z');
    `);
    db.close();
    return dir;
  }

  function open(dir: string): Project {
    const project = openProject(dir, ENV);
    cleanups.push(() => project.db.close());
    return project;
  }

  it('shows as consultations with their question, answer and items, and stay readable as topics', () => {
    const project = open(oldProject());

    const { messages } = listConsultations(project);

    const build = messages.filter((message) => message.topic === 'TOP-1');
    expect(build.map((message) => [message.author, message.text])).toEqual([
      ['person', 'Why is the build slow?'],
      ['agent', 'The cache is cold on every CI run, so everything builds.'],
    ]);
    expect(build.every((message) => message.kind === 'consultation')).toBe(true);
    expect(build[0]?.links).toEqual(['TAR-1']);
    expect(messages.filter((message) => message.topic === 'TOP-2').map((m) => m.text)).toEqual([
      'Which port does the desk use?',
    ]);
    expect(
      listTopics(project)
        .map((topic) => topic.id)
        .sort(),
    ).toEqual(['TOP-1', 'TOP-2']);
  });

  it('is done once: opening again adds nothing', () => {
    const dir = oldProject();
    const count = (project: Project) =>
      project.db.prepare('SELECT COUNT(*) AS n FROM conversation_messages').get()?.n;
    const kept = count(open(dir));

    expect(kept).toBe(3);
    expect(count(open(dir))).toBe(kept);
  });
});
