import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { type Cli, cliAt, declareProfiles, tempGitRepo } from './testing.ts';

// Field study 3: an agent landed with `git push origin HEAD:main` from a worktree, the item went
// Done, and the person's local main never moved, with nothing to say so ("npm start in my checkout
// would not have the fixes"). Landing says plainly where the work is and that the local main is
// behind.
describe('an item that landed while the local main stayed behind', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let origin: string;
  let otea: Cli;
  let tree: string;
  // The remote the agent pushes to: origin, unless a test renames it.
  let remote = 'origin';

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();

  // An item of Código being done in Subir.
  const landing = async (title: string): Promise<string> => {
    const created = await otea(
      'create',
      '--collection',
      'Código',
      '--title',
      title,
      '--field',
      'Qué quiero=x',
      '--field',
      'Rama=main',
      '--json',
    );
    const id: string = JSON.parse(created.out).id;
    const project = openProject(repo.dir);
    try {
      const step = liveBoardOf(project, 'Código')?.def.steps.find(({ name }) => name === 'Subir');
      if (!step) throw new Error('no Subir');
      updateItemState(
        project.db,
        id,
        stateOf({ step: step.id, phase: 'doing' }),
        '2026-11-19T10:00:00Z',
      );
    } finally {
      project.db.close();
    }
    return id;
  };

  // The agent's way of landing: a commit in a worktree, pushed to main from there.
  const landFromWorktree = (file: string): string => {
    writeFileSync(join(tree, file), `${file}\n`);
    git(tree, 'add', file);
    git(tree, 'commit', '-q', '-m', file);
    git(tree, 'push', '-q', remote, 'HEAD:main');
    return git(tree, 'rev-parse', '--short', 'HEAD');
  };

  beforeEach(async () => {
    remote = 'origin';
    repo = tempGitRepo();
    origin = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    tree = mkdtempSync(join(tmpdir(), 'otea-tree-'));
    execFileSync('git', ['init', '--quiet', '--bare', origin], { stdio: 'ignore' });
    otea = cliAt(repo.dir, { OTEA_AGENT: 'lu' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    expect((await person('board', 'add', 'Código', '--template', 'mainline')).code).toBe(0);
    declareProfiles(repo.dir, 'lu');
    writeFileSync(join(repo.dir, 'bot.py'), 'print(1)\n');
    git(repo.dir, 'add', 'bot.py');
    git(repo.dir, 'commit', '-q', '-m', 'first');
    git(repo.dir, 'branch', '-M', 'main');
    git(repo.dir, 'remote', 'add', 'origin', origin);
    git(repo.dir, 'push', '-q', '-u', 'origin', 'main');
    rmSync(tree, { recursive: true, force: true });
    git(repo.dir, 'worktree', 'add', '-q', '--detach', tree);
  });

  afterEach(() => {
    try {
      git(repo.dir, 'worktree', 'remove', '--force', tree);
    } catch {}
    repo.remove();
    rmSync(origin, { recursive: true, force: true, maxRetries: 10 });
    rmSync(tree, { recursive: true, force: true, maxRetries: 10 });
  });

  it('says it landed on the remote and that the local main is behind, and how to catch up', async () => {
    const id = await landing('Regar');
    expect((await otea('claim', id)).code).toBe(0);
    const commit = landFromWorktree('regar.py');
    expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);

    const done = await otea('handoff', id);

    expect(done.code, done.err).toBe(0);
    expect(done.out).toContain(`${id} is Done`);
    expect(done.out).toContain('landed on origin/main');
    expect(done.out).toContain('your local main');
    expect(done.out).toContain('1 commit behind');
    expect(done.out).toContain('git pull');
  });

  it('gives a program the same fact as data', async () => {
    const id = await landing('Regar');
    expect((await otea('claim', id)).code).toBe(0);
    const commit = landFromWorktree('regar.py');
    expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);

    const done = await otea('handoff', id, '--json');

    expect(done.code, done.err).toBe(0);
    const { localBehind } = JSON.parse(done.out);
    expect(localBehind).toMatchObject({
      base: 'main',
      remote: 'origin/main',
      behind: 1,
      checkout: repo.dir,
      state: 'ready',
    });
  });

  it('says nothing when the local main already holds what landed', async () => {
    const id = await landing('Regar');
    expect((await otea('claim', id)).code).toBe(0);
    const commit = landFromWorktree('regar.py');
    git(repo.dir, 'pull', '-q', '--ff-only', 'origin', 'main');
    expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);

    const done = await otea('handoff', id);

    expect(done.code, done.err).toBe(0);
    expect(done.out).toContain(`${id} is Done`);
    expect(done.out).not.toContain('behind');
  });

  it('leaves a main checkout with changes, or on another branch, alone and says so', async () => {
    const id = await landing('Regar');
    expect((await otea('claim', id)).code).toBe(0);
    const commit = landFromWorktree('regar.py');
    writeFileSync(join(repo.dir, 'bot.py'), 'print(2)\n');
    expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);

    const done = await otea('handoff', id);

    expect(done.code, done.err).toBe(0);
    expect(done.out).toContain('1 commit behind');
    expect(done.out).toContain('changes');
    expect(done.out).toContain('left alone');
  });

  // The step that brings the person's main up to date is Otea's, enforced in code: it never
  // touches a checkout that is on another branch or has changes of the person's.
  describe('otea land sync', () => {
    // An item landed from the worktree, Done, the local main one commit behind.
    const landed = async (): Promise<string> => {
      const id = await landing('Regar');
      expect((await otea('claim', id)).code).toBe(0);
      const commit = landFromWorktree('regar.py');
      expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);
      expect((await otea('handoff', id)).code).toBe(0);
      return id;
    };
    const heads = () => ({
      local: git(repo.dir, 'rev-parse', 'main'),
      remote: git(repo.dir, 'rev-parse', `${remote}/main`),
    });

    it('fast-forwards the main checkout when it is on the base with no changes', async () => {
      const id = await landed();
      expect(heads().local).not.toBe(heads().remote);

      const synced = await otea('land', 'sync', id);

      expect(synced.code, synced.err).toBe(0);
      expect(synced.out).toContain('up to date');
      expect(heads().local).toBe(heads().remote);
      // Nothing left to do: a second run says so.
      expect((await otea('land', 'sync', id)).out).toContain('nothing to bring');
    });

    it('leaves a checkout with changes of the person alone, and says so', async () => {
      const id = await landed();
      const before = heads().local;
      writeFileSync(join(repo.dir, 'bot.py'), 'print(2)\n');

      const synced = await otea('land', 'sync', id);

      expect(synced.code, synced.err).toBe(0);
      expect(synced.out).toContain('left alone');
      expect(heads().local).toBe(before);
    });

    it('leaves a checkout on another branch alone', async () => {
      const id = await landed();
      const before = heads().local;
      git(repo.dir, 'switch', '-q', '-c', 'otra-rama');

      const synced = await otea('land', 'sync', id);

      expect(synced.code, synced.err).toBe(0);
      expect(synced.out).toContain('otra-rama');
      expect(synced.out).toContain('left alone');
      expect(git(repo.dir, 'rev-parse', 'main')).toBe(before);
    });

    it('takes the remote the base is pushed to, not a fixed origin/main', async () => {
      git(repo.dir, 'remote', 'rename', 'origin', 'upstream');
      remote = 'upstream';
      const id = await landed();

      const synced = await otea('land', 'sync', id);

      expect(synced.code, synced.err).toBe(0);
      expect(synced.out).toContain('upstream/main');
      expect(git(repo.dir, 'rev-parse', 'main')).toBe(git(repo.dir, 'rev-parse', 'upstream/main'));
    });

    it('asks nothing of an item that is not Done', async () => {
      const id = await landing('Regar');

      const synced = await otea('land', 'sync', id);

      expect(synced.code).not.toBe(0);
      expect(synced.err).toContain('not Done');
    });
  });
});
