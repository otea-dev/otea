import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveItem, liveBoardOf, sendBackItem } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { approvedTipOf } from '../app/tips.ts';
import { stateOf } from '../core/board/engine.ts';
import { createServer } from '../server/server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from '../server/testing.ts';
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

const SLOW = { timeout: 90_000 };

// An approved item bounced by a landing conflict was reviewed again whole, for a conflict the person
// had nothing to decide in but its resolution (field study: a trivial append-append conflict cost a
// repeat review; one item took five rounds). When all the new round does is merge main into the
// approved work, the handoff and show say so and show what the merge itself changed; any other
// change in the round has the whole of it reviewed. Approving binds the commit handed off, as ever.
// What the review is told is worked out by Otea from the remote's own base and from commits, never
// from a ref the agent can move.
describe('a round that only merges main into the work the person approved', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
  let origin: string;
  let otea: Cli;
  const gitAt =
    (dir: string) =>
    (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
  const changeAt = (dir: string) => (file: string, text: string) => {
    writeFileSync(join(dir, file), text);
    gitAt(dir)('add', file);
    gitAt(dir)('commit', '-q', '-m', file);
  };
  const git = (...args: string[]) => gitAt(repo.dir)(...args);
  const change = (file: string, text: string) => changeAt(repo.dir)(file, text);
  const BRANCH = 'cambio/1-regar';
  const person = { kind: 'human' as const, name: 'fede' };

  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const agent = cliAt(dir, { OTEA_AGENT: 'quill' });
      const git = gitAt(dir);
      const change = changeAt(dir);
      await cliAt(dir)('init', '--local', '--template', 'none');
      await cliAt(dir)('board', 'add', 'Cambios', '--template', 'changes');
      declareProfiles(dir, 'quill');
      await agent(
        'create',
        '--collection',
        'Cambios',
        '--title',
        'Regar',
        '--field',
        'Qué quiero=x',
        '--field',
        `Rama=${BRANCH}`,
      );
      change('shared.txt', 'base\n');
      git('branch', '-M', 'main');
      git('checkout', '-q', '-b', BRANCH);
      change('shared.txt', 'regar\n');
      const project = openProject(dir);
      try {
        const doit = liveBoardOf(project, 'Cambios')?.def.steps.find(
          ({ name }) => name === 'Hacerlo',
        );
        if (!doit) throw new Error('no Hacerlo');
        updateItemState(
          project.db,
          'CAM-1',
          stateOf({ step: doit.id, phase: 'doing' }),
          '2026-11-19T10:00:00Z',
        );
      } finally {
        project.db.close();
      }
      writeFileSync(join(dir, 'r1.diff'), 'diff --git a/shared.txt b/shared.txt\n+regar\n');
      expect((await agent('claim', 'CAM-1')).code).toBe(0);
      expect((await agent('attach', 'CAM-1', 'r1.diff')).code).toBe(0);
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => seeded.remove());

  // The repo has a real remote, a bare repository, as the base the review trusts is the remote's.
  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    origin = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { stdio: 'ignore' });
    git('remote', 'add', 'origin', origin);
    git('push', '-q', 'origin', 'main', BRANCH);
  });

  afterEach(() => {
    repo.remove();
    rmSync(origin, { recursive: true, force: true, maxRetries: 10 });
  });

  // Round 1 handed off and approved; main then moved on and its change conflicts, so the agent
  // took the item back to Hacerlo; it merges main into the branch and conflicts there.
  const bounced = async () => {
    expect((await otea('handoff', 'CAM-1', '--note', 'ronda 1')).code).toBe(0);
    const project = openProject(repo.dir);
    try {
      approveItem(project, { id: 'CAM-1', actor: person, channel: 'ui' });
    } finally {
      project.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    git('checkout', '-q', 'main');
    change('shared.txt', 'main\n');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', BRANCH);
    const back = await otea('handoff', 'CAM-1', '--way', 'Hacerlo', '--reason', 'conflict');
    expect(back.code, back.err).toBe(0);
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    expect(() => git('merge', '--no-edit', 'main')).toThrow();
  };

  // The agent resolves the merge (`inMerge` adds to the merge commit itself, `after` is another
  // commit), pushes and hands the round off.
  const resolveAndHandOff = async (
    steps: { inMerge?: () => void; after?: () => void; forge?: boolean } = {},
  ) => {
    writeFileSync(join(repo.dir, 'shared.txt'), 'regar and main\n');
    git('add', 'shared.txt');
    steps.inMerge?.();
    git('commit', '-q', '--no-edit');
    steps.after?.();
    git('push', '-q', 'origin', BRANCH);
    // A ref of this checkout the agent moves: the base made to look like its own tip.
    if (steps.forge) git('update-ref', 'refs/remotes/origin/main', git('rev-parse', BRANCH));
    writeFileSync(join(repo.dir, 'r2.diff'), 'diff --git a/shared.txt b/shared.txt\n+merged\n');
    expect((await otea('attach', 'CAM-1', 'r2.diff')).code).toBe(0);
    const handed = await otea('handoff', 'CAM-1', '--note', 'ronda 2');
    expect(handed.code, handed.err).toBe(0);
    return handed;
  };

  const mergeOnlyOf = async () =>
    JSON.parse((await otea('show', 'CAM-1', '--json')).out).mergeOnly as
      | { branch: string; files: string[]; diff: string }
      | undefined;

  it('is said at the handoff, in show and on the desk, with the resolution', SLOW, async () => {
    await bounced();
    const approved = git('rev-parse', '--short', `refs/remotes/origin/${BRANCH}`);

    const handed = await resolveAndHandOff();
    const merged = git('rev-parse', '--short', BRANCH);
    expect(handed.out).toContain(
      `Note: CAM-1: since the commit the person approved (${approved}) this round only merges main into it; the merge itself changed shared.txt, and all of that is new and not reviewed yet, including any file that did not conflict.`,
    );
    expect(handed.out).toContain(`Approving takes ${merged} as it is`);

    expect((await otea('show', 'CAM-1')).out).toContain('the merge itself changed shared.txt');
    const mergeOnly = await mergeOnlyOf();
    expect(mergeOnly).toMatchObject({ branch: BRANCH, files: ['shared.txt'] });
    expect(mergeOnly?.diff).toContain('+regar and main');
    // The main side's own change is not in what is shown: it landed through its own review.
    expect(mergeOnly?.diff).not.toContain('+main');

    // The desk reads the same.
    const project = openProject(repo.dir);
    const server = createServer(project, { token: TOKEN });
    try {
      const response = await server.app.request(
        `/p/${project.identity.id}/api/items/CAM-1/merge-only`,
        { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { merge: unknown }).merge).toMatchObject({
        branch: BRANCH,
        files: ['shared.txt'],
      });
    } finally {
      server.close();
      project.db.close();
    }
  });

  it('binds the approval to the commit handed off, the merge included', SLOW, async () => {
    await bounced();
    await resolveAndHandOff();

    const project = openProject(repo.dir);
    try {
      expect(approvedTipOf(project, 'CAM-1', BRANCH)?.commit).toBe(git('rev-parse', BRANCH));
    } finally {
      project.db.close();
    }
  });

  // The merge commit can carry anything. A change in a file that never conflicted is in the diff,
  // named, and the copy says all of it is unreviewed.
  it('shows code an evil merge adds to a file that did not conflict', SLOW, async () => {
    await bounced();
    const handed = await resolveAndHandOff({
      inMerge: () => {
        writeFileSync(join(repo.dir, 'evil.txt'), 'rm -rf everything\n');
        git('add', 'evil.txt');
      },
    });

    const mergeOnly = await mergeOnlyOf();
    expect(mergeOnly?.files).toEqual(['evil.txt', 'shared.txt']);
    expect(mergeOnly?.diff).toContain('+rm -rf everything');
    expect(handed.out).toContain('the merge itself changed evil.txt, shared.txt');
  });

  it('is reviewed whole when the round also commits something of its own', SLOW, async () => {
    await bounced();
    await resolveAndHandOff({ after: () => change('extra.txt', 'new work\n') });

    expect(await mergeOnlyOf()).toBeUndefined();
  });

  // The base is the remote's own tip. The agent moving the remote-tracking ref of main to its tip,
  // so its own commits look like the base's, makes the review no smaller.
  it('is reviewed whole when the agent forges the ref of the base', SLOW, async () => {
    await bounced();
    await resolveAndHandOff({ after: () => change('extra.txt', 'new work\n'), forge: true });

    expect(await mergeOnlyOf()).toBeUndefined();
  });

  it('is reviewed whole when the repo has no remote to ask for the base', SLOW, async () => {
    await bounced();
    git('remote', 'remove', 'origin');
    writeFileSync(join(repo.dir, 'shared.txt'), 'regar and main\n');
    git('add', 'shared.txt');
    git('commit', '-q', '--no-edit');
    writeFileSync(join(repo.dir, 'r2.diff'), 'diff --git a/shared.txt b/shared.txt\n+merged\n');
    expect((await otea('attach', 'CAM-1', 'r2.diff')).code).toBe(0);
    const handed = await otea('handoff', 'CAM-1', '--note', 'ronda 2');
    expect(handed.code, handed.err).toBe(0);

    expect(await mergeOnlyOf()).toBeUndefined();
  });

  // More than a person reads whole, a binary file: shown cut or as nothing, they would under-show.
  it.each([
    ['more text than the review shows', () => 'x\n'.repeat(60_000)],
    ['a binary file', () => Buffer.from([0, 1, 2, 3, 0, 255])],
  ] as const)('is reviewed whole when the merge adds %s', SLOW, async (_name, content) => {
    await bounced();
    await resolveAndHandOff({
      inMerge: () => {
        writeFileSync(join(repo.dir, 'big.bin'), content());
        git('add', 'big.bin');
      },
    });

    expect(await mergeOnlyOf()).toBeUndefined();
  });

  it('says nothing for a round the person sent back, not a landing conflict', SLOW, async () => {
    expect((await otea('handoff', 'CAM-1', '--note', 'ronda 1')).code).toBe(0);
    const project = openProject(repo.dir);
    try {
      sendBackItem(project, { id: 'CAM-1', actor: person, channel: 'ui', reason: 'otra cosa' });
    } finally {
      project.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    git('checkout', '-q', 'main');
    change('shared.txt', 'main\n');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', BRANCH);
    expect(() => git('merge', '--no-edit', 'main')).toThrow();
    await resolveAndHandOff();

    expect(await mergeOnlyOf()).toBeUndefined();
  });
});
