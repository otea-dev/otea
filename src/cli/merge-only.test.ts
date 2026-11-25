import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveItem, liveBoardOf } from '../app/next.ts';
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
// approved work, the handoff and show say so and name what the merge changed by hand; any other
// change in the round has the whole of it reviewed. Approving binds the commit handed off, as ever.
describe('a round that only merges main into the work the person approved', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
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
      git('update-ref', 'refs/remotes/origin/main', 'main');
      git('checkout', '-q', '-b', BRANCH);
      change('shared.txt', 'regar\n');
      git('update-ref', `refs/remotes/origin/${BRANCH}`, BRANCH);
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

  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

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
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('checkout', '-q', BRANCH);
    const back = await otea('handoff', 'CAM-1', '--way', 'Hacerlo', '--reason', 'conflict');
    expect(back.code, back.err).toBe(0);
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    expect(() => git('merge', '--no-edit', 'main')).toThrow();
  };

  // The agent resolves the merge and hands the round off.
  const resolveAndHandOff = async (extra?: () => void) => {
    writeFileSync(join(repo.dir, 'shared.txt'), 'regar and main\n');
    git('add', 'shared.txt');
    git('commit', '-q', '--no-edit');
    extra?.();
    git('update-ref', `refs/remotes/origin/${BRANCH}`, BRANCH);
    writeFileSync(join(repo.dir, 'r2.diff'), 'diff --git a/shared.txt b/shared.txt\n+merged\n');
    expect((await otea('attach', 'CAM-1', 'r2.diff')).code).toBe(0);
    const handed = await otea('handoff', 'CAM-1', '--note', 'ronda 2');
    expect(handed.code, handed.err).toBe(0);
    return handed;
  };

  it('is said at the handoff, in show and on the desk, with the resolution', SLOW, async () => {
    await bounced();
    const approved = git('rev-parse', '--short', `refs/remotes/origin/${BRANCH}`);

    const handed = await resolveAndHandOff();
    const merged = git('rev-parse', '--short', BRANCH);
    expect(handed.out).toContain(
      `Note: CAM-1: since the commit the person approved (${approved}) this round only merges main into it, and the merge changed by hand shared.txt, so the review shows that alone. Approving takes ${merged} as it is`,
    );

    const shown = await otea('show', 'CAM-1');
    expect(shown.out).toContain(`the merge changed by hand shared.txt`);
    const { mergeOnly } = JSON.parse((await otea('show', 'CAM-1', '--json')).out);
    expect(mergeOnly).toMatchObject({ branch: BRANCH, files: ['shared.txt'] });
    expect(mergeOnly.diff).toContain('+regar and main');
    // The main side's own change is not in what is shown: it landed through its own review.
    expect(mergeOnly.diff).not.toContain('+main');

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

  it('says nothing when the round also changes something besides the merge', SLOW, async () => {
    await bounced();
    await resolveAndHandOff(() => change('extra.txt', 'new work\n'));

    const { mergeOnly } = JSON.parse((await otea('show', 'CAM-1', '--json')).out);
    expect(mergeOnly).toBeUndefined();
  });

  it('says nothing for a round the person sent back, not a landing conflict', SLOW, async () => {
    expect((await otea('handoff', 'CAM-1', '--note', 'ronda 1')).code).toBe(0);
    const project = openProject(repo.dir);
    try {
      const { sendBackItem } = await import('../app/next.ts');
      sendBackItem(project, { id: 'CAM-1', actor: person, channel: 'ui', reason: 'otra cosa' });
    } finally {
      project.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
    git('checkout', '-q', 'main');
    change('shared.txt', 'main\n');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('checkout', '-q', BRANCH);
    expect(() => git('merge', '--no-edit', 'main')).toThrow();
    await resolveAndHandOff();

    const { mergeOnly } = JSON.parse((await otea('show', 'CAM-1', '--json')).out);
    expect(mergeOnly).toBeUndefined();
  });
});
