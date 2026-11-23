import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject, type Project } from '../app/project.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from './testing.ts';

const SLOW = { timeout: 60_000 };

// P1-F1: on a board kept on main, commits that landed on main after the handoff passed without a
// word between the person's review and their Push; the review warned only on boards with a branch.
// The desk names them before the person approves.
describe('GET /api/items/:id/drift on a board kept on main', () => {
  let repo: TempRepo;
  let project: Project;
  let server: OteaServer;
  const gitAs = (name: string, ...args: string[]) =>
    execFileSync('git', ['-c', `user.name=${name}`, '-c', 'user.email=t@t', ...args], {
      cwd: repo.dir,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const git = (...args: string[]) => gitAs('t', ...args);
  const commit = (file: string, text: string, who = 't') => {
    writeFileSync(join(repo.dir, file), text);
    git('add', file);
    gitAs(who, 'commit', '-q', '-m', file);
    return git('rev-parse', '--short=7', 'HEAD');
  };
  const drift = async () => {
    const response = await server.app.request(
      `/p/${project.identity.id}/api/items/CAM-1/drift`,
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { drift: unknown }).drift;
  };

  // CAM-1 is claimed, committed on main and handed off; `more` runs before the desk opens.
  const reviewed = async (more: () => void = () => {}) => {
    repo = tempGitRepo();
    const agent = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Cambios', '--template', 'mainline');
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
      'Rama=main',
    );
    commit('a.txt', 'root\n');
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
    expect((await agent('claim', 'CAM-1')).code).toBe(0);
    commit('b.txt', 'regar\n');
    writeFileSync(join(repo.dir, 'regar.diff'), git('diff', 'HEAD~1..HEAD'));
    expect((await agent('attach', 'CAM-1', 'regar.diff')).code).toBe(0);
    const handed = await agent('handoff', 'CAM-1', '--note', 'listo');
    expect(handed.code, handed.err).toBe(0);
    more();
    project = openProject(repo.dir);
    server = createServer(project, { token: TOKEN });
  };

  afterEach(() => {
    server?.close();
    project?.db.close();
    repo?.remove();
  });

  it('says nothing while main is where the handoff left it', SLOW, async () => {
    await reviewed();
    expect(await drift()).toBeNull();
  });

  it(
    'names the commits that landed on main after the handoff, with who made them',
    SLOW,
    async () => {
      let extra = '';
      await reviewed(() => {
        git('commit', '-q', '--allow-empty', '-m', 'nothing');
        extra = commit('README.md', 'otra cosa\n', 'Diego');
      });
      const heard = (await drift()) as { branch: string; added: { commit: string }[] };
      expect(heard).toMatchObject({ branch: 'main', onBase: true });
      expect(heard.added).toContainEqual({ commit: extra, author: 'Diego' });
    },
  );
});
