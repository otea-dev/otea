import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { createServer } from '../server/server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from '../server/testing.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  SEED_TIMEOUT_MS,
  type SeededRepo,
  seededLocalRepo,
  type TempRepo,
} from './testing.ts';

// Pilot 1 (a1, a2): in a project whose repo has no remote an approved change never reached Done;
// the person had to run `git merge --ff-only` by hand. The whole path, as the CLI and the desk run
// it: a worker claims the change, works on its branch in `.otea/worktrees/<id>`, hands it off to
// review, the person approves over HTTP, and the Land step follows the text it is given.
describe('an approved change in a repo with no remote', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
  let otea: Cli;
  const BRANCH = 'cambio/1-regar';

  const gitAt =
    (dir: string) =>
    (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
  const git = (...args: string[]) => gitAt(repo.dir)(...args);
  const tree = () => join(repo.dir, '.otea', 'worktrees', 'CAM-1');
  // The worker's own shell, in its worktree.
  const atTree: Cli = (...argv) => cliAt(tree(), { OTEA_AGENT: 'quill' })(...argv);

  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const person = cliAt(dir);
      await person('init', '--local', '--template', 'none');
      expect((await person('board', 'add', 'Cambios', '--template', 'changes')).code).toBe(0);
      declareProfiles(dir, 'quill');
      writeFileSync(join(dir, 'bot.py'), 'print(1)\n');
      gitAt(dir)('add', 'bot.py');
      gitAt(dir)('commit', '-q', '-m', 'first');
      gitAt(dir)('branch', '-M', 'main');
    });
  }, SEED_TIMEOUT_MS);
  afterAll(() => seeded?.remove());

  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });
  afterEach(() => {
    try {
      git('worktree', 'remove', '--force', tree());
    } catch {}
    repo.remove();
  });

  // The worker's way, from the first claim to the handoff into the person's review.
  const handedToReview = async (): Promise<void> => {
    const created = await otea(
      'create',
      '--collection',
      'Cambios',
      '--title',
      'Regar',
      '--field',
      'Qué quiero=una función regar',
      '--json',
    );
    expect(created.code, created.err).toBe(0);
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    expect((await otea('update', 'CAM-1', '--field', 'Cómo lo valido=regar existe')).code).toBe(0);
    const clarified = await otea('handoff', 'CAM-1');
    expect(clarified.code, clarified.err).toBe(0);
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    git('worktree', 'add', '-q', join('.otea', 'worktrees', 'CAM-1'), '-b', BRANCH);
    expect((await otea('update', 'CAM-1', '--field', `Rama=${BRANCH}`)).code).toBe(0);
    writeFileSync(join(tree(), 'regar.py'), 'print("regar")\n');
    gitAt(tree())('add', 'regar.py');
    gitAt(tree())('commit', '-q', '-m', 'regar');
    mkdirSync(join(repo.dir, '.otea', 'tmp'), { recursive: true });
    const diff = join(repo.dir, '.otea', 'tmp', 'regar.diff');
    writeFileSync(diff, gitAt(tree())('diff', 'main...HEAD'));
    expect((await otea('attach', 'CAM-1', diff)).code).toBe(0);
    const handed = await atTree('handoff', 'CAM-1', '--note', 'regar added');
    expect(handed.code, handed.err).toBe(0);
  };

  // The person's yes, through the desk's HTTP API.
  const approve = async (): Promise<void> => {
    const project = openProject(repo.dir);
    try {
      const server = createServer(project, { token: TOKEN });
      const land = liveBoardOf(project, 'Cambios')?.def.steps.find(
        ({ name }) => name === 'Integrar',
      );
      if (!land) throw new Error('no Integrar');
      const response = await server.app.request(
        `/p/${project.identity.id}/api/items/CAM-1/move`,
        {
          method: 'POST',
          headers: {
            host: LOCAL_HOST,
            cookie: SESSION_COOKIE,
            origin: `http://${LOCAL_HOST}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ to: land.id }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      );
      expect(response.status, await response.clone().text()).toBe(200);
    } finally {
      project.db.close();
    }
  };

  const stateOfItem = async (): Promise<string> => {
    const shown = JSON.parse((await otea('show', 'CAM-1', '--json')).out);
    return String(shown.item?.stateName ?? shown.stateName);
  };

  // The Land step as its text asks of a worker with no remote: claim it, bring main into the branch
  // in its own worktree when main moved on, write the branch's tip as the commit, hand off. Never a
  // git command in the person's checkout.
  const land = async (): Promise<{ code: number; out: string; err: string }> => {
    expect((await atTree('claim', 'CAM-1')).code).toBe(0);
    const tip = gitAt(tree())('rev-parse', '--short', 'HEAD');
    expect((await atTree('update', 'CAM-1', '--field', `Commit en main=${tip}`)).code).toBe(0);
    return atTree('handoff', 'CAM-1');
  };
  const main = () => git('rev-parse', 'main');
  // A file of the person's folder (line endings aside: git may turn them on Windows).
  const textOf = (file: string) => readFileSync(join(repo.dir, file), 'utf8').trim();

  it('lands on the person’s main and reaches Done, with no git run by hand', async () => {
    await handedToReview();
    await approve();
    const approvedTip = gitAt(tree())('rev-parse', 'HEAD');

    const landed = await land();

    expect(landed.code, landed.err).toBe(0);
    expect(landed.out).toContain('CAM-1 is Done');
    expect(main()).toBe(approvedTip);
    expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(textOf('regar.py')).toBe('print("regar")');
    expect(await stateOfItem()).toBe('Done');
    // Nothing is left for the person's folder to catch up on.
    expect((await atTree('land', 'sync', 'CAM-1')).out).toContain('nothing to bring');
  });

  it('lands a branch that has main merged into it when main moved on meanwhile', async () => {
    await handedToReview();
    await approve();
    writeFileSync(join(repo.dir, 'riego.py'), 'print("riego")\n');
    git('add', 'riego.py');
    git('commit', '-q', '-m', 'riego');
    gitAt(tree())('merge', '-q', '--no-edit', 'main');

    const landed = await land();

    expect(landed.code, landed.err).toBe(0);
    expect(landed.out).toContain('CAM-1 is Done');
    expect(main()).toBe(gitAt(tree())('rev-parse', 'HEAD'));
    expect(textOf('regar.py')).toBe('print("regar")');
    expect(textOf('riego.py')).toBe('print("riego")');
    expect(await stateOfItem()).toBe('Done');
  });

  it('says why and keeps the item waiting while the person’s folder has changes, then lands once it is clean', async () => {
    await handedToReview();
    await approve();
    const before = main();
    writeFileSync(join(repo.dir, 'bot.py'), 'print(2)\n');

    const waiting = await land();

    expect(waiting.code).not.toBe(0);
    expect(waiting.err).toContain('changes');
    expect(waiting.err).toContain('left where it is');
    expect(main()).toBe(before);
    expect(textOf('bot.py')).toBe('print(2)');
    expect(await stateOfItem()).toBe('Integrar');

    git('checkout', '--', 'bot.py');
    const landed = await atTree('handoff', 'CAM-1');

    expect(landed.code, landed.err).toBe(0);
    expect(main()).toBe(gitAt(tree())('rev-parse', 'HEAD'));
    expect(await stateOfItem()).toBe('Done');
  });

  it('leaves a folder that is on another branch alone, naming it', async () => {
    await handedToReview();
    await approve();
    const before = main();
    git('switch', '-q', '-c', 'otra-rama');

    const waiting = await land();

    expect(waiting.code).not.toBe(0);
    expect(waiting.err).toContain('otra-rama');
    expect(main()).toBe(before);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('otra-rama');
    expect(await stateOfItem()).toBe('Integrar');
  });

  it('moves nothing when the branch holds a commit nobody reviewed', async () => {
    await handedToReview();
    await approve();
    const before = main();
    writeFileSync(join(tree(), 'colado.py'), 'print("sneaky")\n');
    gitAt(tree())('add', 'colado.py');
    gitAt(tree())('commit', '-q', '-m', 'after the approval');

    const refused = await land();

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('exactly what the person approved');
    expect(main()).toBe(before);
    expect(await stateOfItem()).toBe('Integrar');
  });
});
