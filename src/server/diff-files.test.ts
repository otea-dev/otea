import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject, type Project } from '../app/project.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { diffFiles } from './diff-files.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from './testing.ts';

// P1-F2, P1-S2: an invented diff and an empty commit passed every check, and the person approved a
// review whose attached diff had nothing to do with the work. The desk says so, naming the files
// of both, before the person approves; approving stays theirs (a warning, not a refusal).
describe('GET /api/items/:id/diff-files', () => {
  let repo: TempRepo;
  let project: Project;
  let server: OteaServer;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo.dir,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const change = (file: string, text: string) => {
    writeFileSync(join(repo.dir, file), text);
    git('add', file);
    git('commit', '-q', '-m', file);
  };
  const mismatch = async () => {
    const response = await server.app.request(
      `/p/${project.identity.id}/api/items/CAM-1/diff-files`,
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { mismatch: unknown }).mismatch;
  };

  // `template`: the board; `branch`: its Rama, main for a board kept on main. The item is put in
  // its first step, claimed (which records where main stood), worked on, and handed off.
  const handOff = async (template: 'changes' | 'mainline', branch: string, diff: () => string) => {
    repo = tempGitRepo();
    const otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Cambios', '--template', template);
    declareProfiles(repo.dir, 'quill');
    await otea(
      'create',
      '--collection',
      'Cambios',
      '--title',
      'Regar',
      '--field',
      'Qué quiero=x',
      '--field',
      `Rama=${branch}`,
    );
    change('a.txt', 'root\n');
    git('branch', '-M', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    const opened = openProject(repo.dir);
    try {
      const doit = liveBoardOf(opened, 'Cambios')?.def.steps.find(({ name }) => name === 'Hacerlo');
      if (!doit) throw new Error('no Hacerlo');
      updateItemState(
        opened.db,
        'CAM-1',
        stateOf({ step: doit.id, phase: 'doing' }),
        '2026-11-19T10:00:00Z',
      );
    } finally {
      opened.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    if (branch !== 'main') git('checkout', '-q', '-b', branch);
    change('b.txt', 'regar\n');
    change('c.txt', 'regar\n');
    writeFileSync(join(repo.dir, 'regar.diff'), diff());
    expect((await otea('attach', 'CAM-1', 'regar.diff')).code).toBe(0);
    const handed = await otea('handoff', 'CAM-1', '--note', 'regar');
    expect(handed.code, handed.err).toBe(0);
    project = openProject(repo.dir);
    server = createServer(project, { token: TOKEN });
  };

  afterEach(() => {
    server?.close();
    project?.db.close();
    repo?.remove();
  });

  const both = [
    ['a branch of the board', 'changes', 'cambio/1-regar', 'main...HEAD'],
    ['main, on a board kept on main', 'mainline', 'main', 'HEAD~2..HEAD'],
  ] as const;

  describe.each(both)('on %s', (_name, template, branch, range) => {
    it('says nothing when the diff names the files the work changes', async () => {
      await handOff(template, branch, () => git('diff', range));
      expect(await mismatch()).toBeNull();
    });

    it('names both lists when the diff is invented and names no file', async () => {
      await handOff(template, branch, () => 'nothing really, invented\n');
      expect(await mismatch()).toEqual({ diff: [], landed: ['b.txt', 'c.txt'] });
    });

    it('names both lists when the diff covers other files than the work', async () => {
      await handOff(template, branch, () => git('diff', range).replaceAll('c.txt', 'z.txt'));
      expect(await mismatch()).toEqual({ diff: ['b.txt', 'z.txt'], landed: ['b.txt', 'c.txt'] });
    });
  });
});

describe('the files a diff names', () => {
  it('reads a git diff, a renamed file and a deleted one by every path they touch', () => {
    const text = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 90%',
      'rename from old name.ts',
      'rename to new name.ts',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
    ].join('\n');
    expect(diffFiles(text)).toEqual(['gone.ts', 'new name.ts', 'old name.ts', 'src/a.ts']);
  });

  it('reads a plain unified diff by its +++ and --- lines, and a text with no file as none', () => {
    expect(diffFiles('--- a/x.txt\t2026\n+++ b/x.txt\t2026\n@@ -1 +1 @@\n-a\n+b\n')).toEqual([
      'x.txt',
    ]);
    expect(diffFiles('nothing really, invented')).toEqual([]);
  });
});
