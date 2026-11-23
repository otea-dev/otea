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

  // A merge brings its own commits, named; the merge commit itself says nothing more.
  it('leaves merge commits aside and names the commits they bring', SLOW, async () => {
    let side = '';
    await reviewed(() => {
      git('checkout', '-q', '-b', 'side');
      side = commit('side.txt', 'lado\n');
      git('checkout', '-q', 'main');
      git('merge', '--no-ff', '-q', '-m', 'merge side', 'side');
    });
    expect(await drift()).toMatchObject({ added: [{ commit: side, author: 't' }] });
  });

  // The base rewritten since the handoff: the same change as a new commit (a rebase, a reworded
  // message) is nothing new, so the desk says only where main is now.
  it('says where main is now when it was rewritten with no new change', SLOW, async () => {
    let now = '';
    await reviewed(() => {
      const handed = git('rev-parse', 'HEAD');
      git('checkout', '-q', '-B', 'main', 'HEAD~1');
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'cherry-pick', handed], {
        cwd: repo.dir,
        stdio: 'pipe',
        env: { ...process.env, GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z' },
      });
      now = git('rev-parse', '--short=7', 'HEAD');
    });
    expect(await drift()).toMatchObject({ onBase: true, now, added: [] });
  });

  it('names the first twenty commits and counts the rest', SLOW, async () => {
    let first = '';
    await reviewed(() => {
      for (let at = 0; at < 22; at++) {
        const made = commit(`f${at}.txt`, `${at}\n`);
        if (at === 0) first = made;
      }
    });
    const heard = (await drift()) as { added: { commit: string }[]; more?: number };
    expect(heard.added).toHaveLength(20);
    expect(heard.added[0]?.commit).toBe(first);
    expect(heard.more).toBe(2);
  });

  // The page asks again on each look: the answer is kept for a few seconds, as the remote's is.
  it('keeps its answer for a few seconds', SLOW, async () => {
    let first = '';
    await reviewed(() => {
      first = commit('one.txt', '1\n');
    });
    expect(await drift()).toMatchObject({ added: [{ commit: first, author: 't' }] });
    commit('two.txt', '2\n');
    expect(await drift()).toMatchObject({ added: [{ commit: first, author: 't' }] });
  });
});
