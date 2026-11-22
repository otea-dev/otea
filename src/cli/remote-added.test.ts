import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject } from '../app/project.ts';
import { repoNameAt, UnknownRepo } from '../app/repos.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// A repo is known by its origin URL, or by its root commit while it has no origin. A remote added
// after `otea init` changes what the repo is known by, and the pre-push gate must not turn into a
// wall that names no way out (persona P3).
describe('a remote added after init', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo.dir,
      stdio: 'pipe',
      encoding: 'utf8',
    });

  // The name the project gives the checkout at `dir`.
  const nameAt = (dir: string) => {
    const project = openProject(repo.dir);
    try {
      return repoNameAt(project, dir);
    } finally {
      project.db.close();
    }
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    expect((await otea('init', '--local', '--template', 'none')).code).toBe(0);
    expect((await otea('repos', 'list')).out).toContain('root:');
  });

  afterEach(() => repo.remove());

  it('still tells which repo this is, so the push gate does not refuse it', async () => {
    const name = nameAt(repo.dir);
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const gate = await otea('check', '--gate', 'push', '--branch', 'feature', '--repo');

    expect(gate.err).not.toContain('refused');
    expect(gate.code).not.toBe(19);
    expect(nameAt(repo.dir)).toBe(name);
  });

  it('keeps one repo when it is named again, and the repo then goes by its origin', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const named = await otea('repos', 'add', '--name', 'keys');
    const listed = (await otea('repos', 'list')).out.trim().split('\n');

    expect(named.code).toBe(0);
    expect(listed).toEqual(['keys  remote:github.com/acme/keys']);
    expect(nameAt(repo.dir)).toBe('keys');
  });

  it('refuses a fork: the same root commits under another origin is another repo', async () => {
    const name = nameAt(repo.dir);
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');
    const fork = tempGitRepo();
    try {
      execFileSync('git', ['fetch', '--quiet', repo.dir, 'HEAD'], { cwd: fork.dir, stdio: 'pipe' });
      execFileSync('git', ['checkout', '--quiet', '-B', 'main', 'FETCH_HEAD'], {
        cwd: fork.dir,
        stdio: 'pipe',
      });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/someone/keys.git'], {
        cwd: fork.dir,
        stdio: 'pipe',
      });
      // The first match by root commit gives the repo its origin.
      expect(nameAt(repo.dir)).toBe(name);

      expect(() => nameAt(fork.dir)).toThrow(UnknownRepo);
      expect(nameAt(repo.dir)).toBe(name);
      expect((await otea('repos', 'list')).out.trim()).toBe(`${name}  remote:github.com/acme/keys`);
    } finally {
      fork.remove();
    }
  });
});
