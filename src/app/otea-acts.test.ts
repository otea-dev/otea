import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardDefinition } from '../core/board/model.ts';
import { selectEvents } from '../store/queries.ts';
import { requestAgentDraft } from './agent-draft.ts';
import { ensureRequestsBoard, getBoardRecord, saveDraft } from './boards.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf } from './testing.ts';

// What Otea does on its own is signed `otea`, never as the person (the owner's rule: what is shown
// must be true; s-real2 D-eb906c). The person is shown as «you» on every note, event and diff, so an
// act of Otea's own written as theirs reads as something they did.

let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 12, 9, 0, tick++)).toISOString();

describe('what Otea writes on its own is signed otea', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('signs the Pedido’s new title when its board is renamed, not as the person', () => {
    const root = mkdtempSync(join(tmpdir(), 'otea-acts-'));
    dirs.push(root);
    const ctx: Project = projectOf(root, memoryContext());
    ensureRequestsBoard(ctx, 'es', now);
    const { board, item } = requestAgentDraft(
      ctx,
      { name: 'Temporal', need: 'x', agent: 'kiln', lang: 'es' },
      now,
    );
    const definition = getBoardRecord(ctx, board.id).draft?.definition as BoardDefinition;
    saveDraft(
      ctx,
      board.id,
      { definition: { ...definition, name: 'Criaturas' }, baseVersion: null },
      now,
    );

    const retitle = selectEvents(ctx.db, item).find(
      ({ type, data }) => type === 'updated' && JSON.stringify(data).includes('Criaturas'),
    );
    expect(retitle?.actor).toEqual({ kind: 'otea', name: 'otea' });
  });

  // No place in Otea's own code names itself as a person. A structural guard: an actor literal that
  // is a human called otea (or an Otea acting as a human) never comes back.
  it('has no actor in the source that is a human named otea', () => {
    const src = join(import.meta.dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(src);
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .flatMap((line, i) =>
          /kind:\s*'human'[^}]*name:\s*'otea'|name:\s*'otea'[^}]*kind:\s*'human'/.test(line)
            ? [`${relative(src, file)}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
