import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceFile } from '../app/evidence.ts';
import { liveBoardOf } from '../app/next.ts';
import { openProject, type Project } from '../app/project.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { stateOf } from '../core/board/engine.ts';
import { selectEvents, selectEvidence, updateItemState } from '../store/queries.ts';
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
  const handOff = async (
    template: 'changes' | 'mainline',
    branch: string,
    diff: () => string,
    // What the item's work is: two files, unless the test says otherwise.
    work: () => void = () => {
      change('b.txt', 'regar\n');
      change('c.txt', 'regar\n');
    },
  ) => {
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
    work();
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
    ['a branch of the board', 'changes', 'cambio/1-regar', 'main...HEAD', 'main...HEAD'],
    ['main, on a board kept on main', 'mainline', 'main', 'HEAD~2..HEAD', 'HEAD~1..HEAD'],
  ] as const;

  describe.each(both)('on %s', (_name, template, branch, range, last) => {
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

    // D-492953 (critical): the review's diff is the branch's, which Otea computes at the handoff and
    // keeps as its own file of the item, the newest of its diffs; what the agent attached stays
    // beside it, as the agent's file, and is compared with it.
    it('keeps the branch diff Otea computed as its own file, whatever the agent attached', async () => {
      await handOff(template, branch, () => 'nothing really, invented\n');
      // Otea's own act, never the person's (D-eb906c: «you attached otea-branch-….diff»).
      const own = selectEvidence(project.db, 'CAM-1').filter(
        ({ actor }) => actor.kind === 'otea' && actor.name === 'otea',
      );
      expect(own).toHaveLength(1);
      const text = readFileSync(evidenceFile(project.dataDir, own[0]?.sha256 ?? ''), 'utf8');
      expect(text).toContain('+++ b/b.txt');
      expect(text).toContain('+regar');
      expect(own[0]?.kind).toBe('diff');
      // In the round of the handoff it was computed for: before the move into review.
      const handoff = selectEvents(project.db, 'CAM-1').findLast(
        ({ type }) => type === 'transitioned',
      );
      expect(Date.parse(own[0]?.createdAt ?? '')).toBeLessThan(Date.parse(handoff?.at ?? ''));
      // It is the last diff of the item: the one the review opens on.
      expect(selectEvidence(project.db, 'CAM-1').at(-1)?.id).toBe(own[0]?.id);
      // And the attached one is still compared with the branch, not with itself.
      expect(await mismatch()).toEqual({ diff: [], landed: ['b.txt', 'c.txt'] });
    });

    // D-492953: the attached diff named the right file and showed other lines (`+Make the buy
    // button red` for a change that wrote `button.buy { background: red }`): the names matched, so
    // the desk said nothing and the person approved a diff that is not what lands.
    it('warns when the diff names the files the work changes but shows other lines', async () => {
      await handOff(template, branch, () => git('diff', range).replaceAll('+regar', '+invented'));
      expect(await mismatch()).toEqual({
        diff: ['b.txt', 'c.txt'],
        landed: ['b.txt', 'c.txt'],
        lines: true,
      });
    });

    it('does not mind the context lines or the hunk headers around the same changes', async () => {
      await handOff(template, branch, () => git('diff', '-U8', range));
      expect(await mismatch()).toBeNull();
    });

    // The persona's case: an empty commit and an invented diff. Both lists are empty, which is
    // still no match for work that changes nothing.
    it('warns when the work changes no file, whatever the diff names', async () => {
      const empty = () => git('commit', '-q', '--allow-empty', '-m', 'nothing');
      await handOff(template, branch, () => 'nothing really, invented\n', empty);
      expect(await mismatch()).toEqual({ diff: [], landed: [] });
    });

    // git quotes a path with non-ASCII letters in the diff as octal bytes; the files git lists
    // are read as they are.
    it('matches a path with non-ASCII letters that the diff quotes', async () => {
      let made = '';
      await handOff(
        template,
        branch,
        () => {
          expect(made).toContain('\\303\\251');
          return made;
        },
        () => {
          change('café.txt', 'regar\n');
          made = git('diff', last);
        },
      );
      expect(await mismatch()).toBeNull();
    });

    // A path is kept as git gives it: only the end of the whole output is trimmed.
    it('keeps a leading space of a path', async () => {
      await handOff(
        template,
        branch,
        () => git('diff', last),
        () => change(' lead.txt', 'regar\n'),
      );
      expect(await mismatch()).toBeNull();
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

  // git quotes a path with non-ASCII letters (and a quote, a backslash, a tab) in C style, the
  // letters as octal bytes of their UTF-8.
  it('unquotes the octal bytes git writes for non-ASCII paths', () => {
    const text = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      'diff --git "a/di\\"re\\\\ct.txt" "b/di\\"re\\\\ct.txt"',
      'diff --git a/plain.txt b/plain.txt',
    ].join('\n');
    expect(diffFiles(text)).toEqual(['café.txt', 'di"re\\ct.txt', 'plain.txt']);
    expect(
      diffFiles('--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n'),
    ).toEqual(['café.txt']);
  });

  // An unquoted path never holds an escape, so a backslash in it is the path's own, and spaces
  // around a name are kept.
  it('keeps a path as written when git did not quote it', () => {
    expect(diffFiles('diff --git a/ x y.txt b/ x y.txt')).toEqual([' x y.txt']);
  });

  it('reads a plain unified diff by its +++ and --- lines, and a text with no file as none', () => {
    expect(diffFiles('--- a/x.txt\t2026\n+++ b/x.txt\t2026\n@@ -1 +1 @@\n-a\n+b\n')).toEqual([
      'x.txt',
    ]);
    expect(diffFiles('nothing really, invented')).toEqual([]);
  });
});
