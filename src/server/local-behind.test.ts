import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateItem } from '../app/items.ts';
import { openProject, type Project } from '../app/project.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { DONE } from '../core/board/model.ts';
import { updateItemState } from '../store/queries.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, SESSION_COOKIE, TOKEN } from './testing.ts';

// Field study 3: «Done but my local main never moves, and nothing says so». The item page asks git
// whether what landed is on the remote's base and not on the local one.
describe('GET /api/items/:id/local-behind', () => {
  let repo: TempRepo;
  let origin: string;
  let tree: string;
  let project: Project;
  let server: OteaServer;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const behind = async () => {
    const response = await server.app.request(
      `/p/${project.identity.id}/api/items/CAM-1/local-behind`,
      { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { behind: unknown }).behind;
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    origin = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    tree = mkdtempSync(join(tmpdir(), 'otea-tree-'));
    execFileSync('git', ['init', '--quiet', '--bare', origin], { stdio: 'ignore' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Código', '--template', 'mainline');
    declareProfiles(repo.dir, 'quill');
    await cliAt(repo.dir, { OTEA_AGENT: 'quill' })(
      'create',
      '--collection',
      'Código',
      '--title',
      'Regar',
      '--field',
      'Qué quiero=x',
      '--field',
      'Rama=main',
    );
    writeFileSync(join(repo.dir, 'a.txt'), 'root\n');
    git(repo.dir, 'add', 'a.txt');
    git(repo.dir, 'commit', '-q', '-m', 'root');
    git(repo.dir, 'branch', '-M', 'main');
    git(repo.dir, 'remote', 'add', 'origin', origin);
    git(repo.dir, 'push', '-q', '-u', 'origin', 'main');
    rmSync(tree, { recursive: true, force: true });
    git(repo.dir, 'worktree', 'add', '-q', '--detach', tree);
    project = openProject(repo.dir);
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    project.db.close();
    try {
      git(repo.dir, 'worktree', 'remove', '--force', tree);
    } catch {}
    repo.remove();
    rmSync(origin, { recursive: true, force: true, maxRetries: 10 });
    rmSync(tree, { recursive: true, force: true, maxRetries: 10 });
  });

  // The agent's landing: a commit in a worktree, pushed to main from there; the item goes Done
  // with that commit in its Commit subido.
  const landed = () => {
    writeFileSync(join(tree, 'b.txt'), 'regar\n');
    git(tree, 'add', 'b.txt');
    git(tree, 'commit', '-q', '-m', 'regar');
    git(tree, 'push', '-q', 'origin', 'HEAD:main');
    const commit = git(tree, 'rev-parse', '--short', 'HEAD');
    updateItem(project, {
      id: 'CAM-1',
      fields: { 'Commit subido': commit },
      actor: { kind: 'human', name: 'lucia' },
    });
    updateItemState(project.db, 'CAM-1', DONE, '2026-11-19T10:00:00Z');
    return commit;
  };

  it('says nothing for an item that is not Done', async () => {
    expect(await behind()).toBeNull();
  });

  it('says what landed is on the remote and the local main is behind it', async () => {
    landed();

    expect(await behind()).toEqual({
      base: 'main',
      remote: 'origin/main',
      behind: 1,
      checkout: repo.dir,
      state: 'ready',
    });
  });

  it('says nothing once the local main has it', async () => {
    landed();
    git(repo.dir, 'pull', '-q', '--ff-only', 'origin', 'main');

    expect(await behind()).toBeNull();
  });
});
