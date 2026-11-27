import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  SEED_TIMEOUT_MS,
  type SeededRepo,
  seededLocalRepo,
  type TempRepo,
} from './testing.ts';

// Field study 3: an agent landed with `git push origin HEAD:main` from a worktree, the item went
// Done, and the person's local main never moved, with nothing to say so ("npm start in my checkout
// would not have the fixes"). Landing says plainly where the work is and that the local main is
// behind.
describe('an item that landed while the local main stayed behind', () => {
  let repo: TempRepo;
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

  // The checkout and its bare origin are made once (a local project with the board, the profile, a
  // first commit pushed: a dozen spawns); each test gets a copy of both, origin pointing at its own,
  // and its own worktree (a worktree records absolute paths, so it cannot be copied).
  let seeded: SeededRepo;
  let originTemplate: string;
  beforeAll(async () => {
    originTemplate = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    execFileSync('git', ['init', '--quiet', '--bare', originTemplate], { stdio: 'ignore' });
    seeded = await seededLocalRepo(async (dir) => {
      const person = cliAt(dir);
      await person('init', '--local', '--template', 'none');
      expect((await person('board', 'add', 'Código', '--template', 'mainline')).code).toBe(0);
      declareProfiles(dir, 'lu');
      writeFileSync(join(dir, 'bot.py'), 'print(1)\n');
      git(dir, 'add', 'bot.py');
      git(dir, 'commit', '-q', '-m', 'first');
      git(dir, 'branch', '-M', 'main');
      git(dir, 'remote', 'add', 'origin', originTemplate);
      git(dir, 'push', '-q', '-u', 'origin', 'main');
    });
  }, SEED_TIMEOUT_MS);
  afterAll(() => {
    seeded?.remove();
    rmSync(originTemplate, { recursive: true, force: true, maxRetries: 10 });
  });

  beforeEach(() => {
    remote = 'origin';
    repo = seeded.fresh();
    origin = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    cpSync(originTemplate, origin, { recursive: true });
    git(repo.dir, 'remote', 'set-url', 'origin', origin);
    tree = mkdtempSync(join(tmpdir(), 'otea-tree-'));
    otea = cliAt(repo.dir, { OTEA_AGENT: 'lu' });
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

    // Cold review G2: a local main with commits of its own was "ready", and the reply sent the
    // person to run the command that had just failed.
    it('says plainly that a local main with commits of its own has diverged, with no command that cannot work', async () => {
      const id = await landed();
      writeFileSync(join(repo.dir, 'mine.txt'), 'mine\n');
      git(repo.dir, 'add', 'mine.txt');
      git(repo.dir, 'commit', '-q', '-m', 'mine');
      const before = heads().local;

      const synced = await otea('land', 'sync', id, '--json');

      expect(synced.code, synced.err).toBe(0);
      const data = JSON.parse(synced.out);
      expect(data.synced).toBe(false);
      expect(data.localBehind.state).toBe('diverged');
      expect(data.text ?? '').not.toContain('land sync');
      const plain = await otea('land', 'sync', id);
      expect(plain.out).toContain('diverged');
      expect(plain.out).toContain('left alone');
      expect(plain.out).not.toMatch(/otea land sync|git pull/);
      expect(heads().local).toBe(before);
    });

    // A tracked file arriving where the person keeps a git-ignored one (an .env) would overwrite it:
    // git replaces ignored files silently.
    it('leaves the checkout alone when an incoming file would overwrite an ignored local one', async () => {
      writeFileSync(join(repo.dir, '.gitignore'), 'local.cfg\n');
      writeFileSync(join(repo.dir, 'local.cfg'), 'mine, never in git\n');
      const id = await landing('Regar');
      expect((await otea('claim', id)).code).toBe(0);
      const commit = landFromWorktree('local.cfg');
      expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);
      expect((await otea('handoff', id)).code).toBe(0);
      const before = heads().local;

      const synced = await otea('land', 'sync', id);

      expect(synced.code, synced.err).toBe(0);
      expect(synced.out).toContain('local.cfg');
      expect(synced.out).toContain('left alone');
      expect(readFileSync(join(repo.dir, 'local.cfg'), 'utf8')).toBe('mine, never in git\n');
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

// Field study 5, V7: a repo with no remote at all. The work landed in a worktree's branch and the
// item is Done; nothing was pushed, so the person's own base is behind the landed commit. `otea
// land sync` brings it up to date with the same checks as with a remote, and says plainly when it
// cannot, so no worker ever asks the person whether to update their folder.
describe('otea land sync in a repo with no remote', () => {
  let repo: TempRepo;
  let tree: string;
  let otea: Cli;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();

  // An item of Código, Done, whose Commit subido names a commit made in the worktree.
  const landed = async (file: string): Promise<string> => {
    const created = await otea(
      'create',
      '--collection',
      'Código',
      '--title',
      'Regar',
      '--field',
      'Qué quiero=x',
      '--field',
      'Rama=main',
      '--json',
    );
    const id: string = JSON.parse(created.out).id;
    writeFileSync(join(tree, file), `${file}\n`);
    git(tree, 'add', '-f', file);
    git(tree, 'commit', '-q', '-m', file);
    const commit = git(tree, 'rev-parse', '--short', 'HEAD');
    expect((await otea('update', id, '--field', `Commit subido=${commit}`)).code).toBe(0);
    const project = openProject(repo.dir);
    try {
      updateItemState(project.db, id, 'done', '2026-11-19T10:00:00Z');
    } finally {
      project.db.close();
    }
    return id;
  };

  // The checkout is made once (a local project with the board, the profile, a first commit); each
  // test gets a copy and its own worktree (a worktree records absolute paths, so it is not copied).
  let seeded: SeededRepo;
  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const person = cliAt(dir);
      await person('init', '--local', '--template', 'none');
      expect((await person('board', 'add', 'Código', '--template', 'mainline')).code).toBe(0);
      declareProfiles(dir, 'lu');
      writeFileSync(join(dir, 'bot.py'), 'print(1)\n');
      git(dir, 'add', 'bot.py');
      git(dir, 'commit', '-q', '-m', 'first');
      git(dir, 'branch', '-M', 'main');
    });
  }, SEED_TIMEOUT_MS);
  afterAll(() => seeded?.remove());

  beforeEach(() => {
    repo = seeded.fresh();
    tree = mkdtempSync(join(tmpdir(), 'otea-tree-'));
    otea = cliAt(repo.dir, { OTEA_AGENT: 'lu' });
    rmSync(tree, { recursive: true, force: true });
    git(repo.dir, 'worktree', 'add', '-q', '--detach', tree);
  });

  afterEach(() => {
    try {
      git(repo.dir, 'worktree', 'remove', '--force', tree);
    } catch {}
    repo.remove();
    rmSync(tree, { recursive: true, force: true, maxRetries: 10 });
  });

  const main = () => git(repo.dir, 'rev-parse', 'main');

  it('fast-forwards the person’s main to the landed commit when it is on main with no changes', async () => {
    const id = await landed('regar.py');
    expect(main()).not.toBe(git(tree, 'rev-parse', 'HEAD'));

    const synced = await otea('land', 'sync', id);

    expect(synced.code, synced.err).toBe(0);
    expect(synced.out).toContain('up to date');
    expect(main()).toBe(git(tree, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(repo.dir, 'regar.py'), 'utf8').trim()).toBe('regar.py');
    // Nothing left to do: a second run says so.
    expect((await otea('land', 'sync', id)).out).toContain('nothing to bring');
  });

  it('leaves a checkout with changes of the person alone, and says why', async () => {
    const id = await landed('regar.py');
    const before = main();
    writeFileSync(join(repo.dir, 'bot.py'), 'print(2)\n');

    const synced = await otea('land', 'sync', id);

    expect(synced.code, synced.err).toBe(0);
    expect(synced.out).toContain('left alone');
    expect(synced.out).toContain('changes');
    expect(main()).toBe(before);
    expect(readFileSync(join(repo.dir, 'bot.py'), 'utf8')).toBe('print(2)\n');
  });

  it('leaves a checkout on another branch alone, naming it', async () => {
    const id = await landed('regar.py');
    const before = main();
    git(repo.dir, 'switch', '-q', '-c', 'otra-rama');

    const synced = await otea('land', 'sync', id);

    expect(synced.out).toContain('otra-rama');
    expect(synced.out).toContain('left alone');
    expect(main()).toBe(before);
  });

  it('says a main with commits of its own has diverged, and moves nothing', async () => {
    const id = await landed('regar.py');
    writeFileSync(join(repo.dir, 'mine.txt'), 'mine\n');
    git(repo.dir, 'add', 'mine.txt');
    git(repo.dir, 'commit', '-q', '-m', 'mine');
    const before = main();

    const synced = await otea('land', 'sync', id, '--json');

    const data = JSON.parse(synced.out);
    expect(data.synced).toBe(false);
    expect(data.localBehind.state).toBe('diverged');
    expect(main()).toBe(before);
  });

  it('leaves the checkout alone when an incoming file would overwrite an ignored local one', async () => {
    writeFileSync(join(repo.dir, '.gitignore'), 'local.cfg\n');
    writeFileSync(join(repo.dir, 'local.cfg'), 'mine, never in git\n');
    git(repo.dir, 'add', '.gitignore');
    git(repo.dir, 'commit', '-q', '-m', 'ignore');
    git(tree, 'checkout', '-q', '--detach', 'main');
    const id = await landed('local.cfg');
    const before = main();

    const synced = await otea('land', 'sync', id);

    expect(synced.out).toContain('local.cfg');
    expect(synced.out).toContain('left alone');
    expect(readFileSync(join(repo.dir, 'local.cfg'), 'utf8')).toBe('mine, never in git\n');
    expect(main()).toBe(before);
  });
});
