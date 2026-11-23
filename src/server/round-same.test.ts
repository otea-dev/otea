import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { liveBoardOf, sendBackItem } from '../app/next.ts';
import { openProject, type Project } from '../app/project.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from './testing.ts';

const SLOW = { timeout: 60_000 };

// P5-F2: in the second round an agent handed off an empty commit and the old diff; the review said
// nothing and the person could approve a change that never happened (only the landing refused it,
// later). A handoff whose work holds the same files as the round it answers is said, to the agent
// at the handoff and to the person in the review; neither refuses it, since an answer to a
// question may change no file.
describe('a round that changes nothing over the one it answers', () => {
  let repo: TempRepo;
  let project: Project;
  let server: OteaServer;
  const BRANCH = 'cambio/1-regar';
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
  const same = async () => {
    const response = await server.app.request(
      `/p/${project.identity.id}/api/items/CAM-1/round-same`,
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { same: unknown }).same;
  };
  const otea = () => cliAt(repo.dir, { OTEA_AGENT: 'quill' });

  // Round 1 handed off and sent back by the person; the agent is on the branch again.
  const secondRound = async () => {
    repo = tempGitRepo();
    const agent = otea();
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Cambios', '--template', 'changes');
    declareProfiles(repo.dir, 'quill');
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
      expect((await agent('claim', 'CAM-1')).code).toBe(0);
      git('checkout', '-q', '-b', BRANCH);
      change('b.txt', 'regar\n');
      writeFileSync(join(repo.dir, 'r1.diff'), git('diff', 'main...HEAD'));
      expect((await agent('attach', 'CAM-1', 'r1.diff')).code).toBe(0);
      const first = await agent('handoff', 'CAM-1', '--note', 'ronda 1');
      expect(first.code, first.err).toBe(0);
      sendBackItem(opened, {
        id: 'CAM-1',
        actor: { kind: 'human', name: 'fede' },
        channel: 'ui',
        reason: 'más grueso',
      });
    } finally {
      opened.db.close();
    }
    expect((await agent('claim', 'CAM-1')).code).toBe(0);
  };

  // Round 2 as the agent does it: its work (or none), a diff, the handoff.
  const handOff = async (work: () => void) => {
    work();
    writeFileSync(join(repo.dir, 'r2.diff'), `${git('diff', 'main...HEAD')}\nronda 2\n`);
    expect((await otea()('attach', 'CAM-1', 'r2.diff')).code).toBe(0);
    const handed = await otea()('handoff', 'CAM-1', '--note', 'ronda 2');
    expect(handed.code, handed.err).toBe(0);
    project = openProject(repo.dir);
    server = createServer(project, { token: TOKEN });
    return handed;
  };

  afterEach(() => {
    server?.close();
    project?.db.close();
    repo?.remove();
  });

  it('warns the agent at the handoff and the review names the round it repeats', SLOW, async () => {
    await secondRound();
    const handed = await handOff(() => git('commit', '-q', '--allow-empty', '-m', 'nothing'));
    expect(handed.out).toMatch(/same files as round 1/);
    expect(await same()).toMatchObject({ branch: BRANCH, round: 1 });
  });

  it('says nothing when the round changes a file', SLOW, async () => {
    await secondRound();
    const handed = await handOff(() => change('b.txt', 'regar mas\n'));
    expect(handed.out).not.toMatch(/same files/);
    expect(await same()).toBeNull();
  });
});
