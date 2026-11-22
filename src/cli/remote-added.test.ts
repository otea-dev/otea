import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject } from '../app/project.ts';
import { repoNameAt, UnknownRepo } from '../app/repos.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// A repo is known by its origin URL, or by its root commit while it has no origin. A remote added
// after `otea init` changes what the repo is known by. Its root commit is shared by every fork, so
// Otea never takes a checkout with an origin for a repo it only knew by that commit: the gate
// refuses it, naming the command that says it is that repo (persona P3).
describe('a remote added after init', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  let name: string;
  const run = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  const git = (...args: string[]) => run(repo.dir, ...args);
  const gate = () => otea('check', '--gate', 'push', '--branch', 'feature', '--repo');

  // The name the project gives the checkout at `dir`.
  const nameAt = (dir: string) => {
    const project = openProject(repo.dir);
    try {
      return repoNameAt(project, dir);
    } finally {
      project.db.close();
    }
  };

  // A copy of the repo's history under another origin: a fork.
  const fork = (origin: string | undefined) => {
    const copy = tempGitRepo();
    run(copy.dir, 'fetch', '--quiet', repo.dir, 'HEAD');
    run(copy.dir, 'checkout', '--quiet', '-B', 'main', 'FETCH_HEAD');
    if (origin) run(copy.dir, 'remote', 'add', 'origin', origin);
    return copy;
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    expect((await otea('init', '--local', '--template', 'none')).code).toBe(0);
    name = nameAt(repo.dir);
    expect((await otea('repos', 'list')).out).toContain(`${name}  root:`);
  });

  afterEach(() => repo.remove());

  it('is refused by the gate, with the command that says it is the same repo', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const refused = await gate();

    expect(refused.code).toBe(19);
    expect(refused.err).toContain(
      `If this is ${name}, run in ${repo.dir}: otea repos add --name ${name}`,
    );
    expect(() => nameAt(repo.dir)).toThrow(UnknownRepo);
  });

  it('is the same repo once that command ran: the repo then goes by its origin, and the push passes', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const adopted = await otea('repos', 'add', '--name', name);

    expect(adopted.code).toBe(0);
    expect(adopted.out.trim()).toBe(`${name}  remote:github.com/acme/keys`);
    expect((await otea('repos', 'list')).out.trim()).toBe(`${name}  remote:github.com/acme/keys`);
    expect(nameAt(repo.dir)).toBe(name);
    const passed = await gate();
    expect(passed.err).not.toContain('refused');
    expect(passed.code).not.toBe(19);
  });

  it('refuses a fork, whether it is looked at before or after the repo took its origin', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');
    const copy = fork('https://github.com/someone/keys.git');
    try {
      expect(() => nameAt(copy.dir)).toThrow(UnknownRepo);

      expect((await otea('repos', 'add', '--name', name)).code).toBe(0);

      expect(() => nameAt(copy.dir)).toThrow(UnknownRepo);
      expect(nameAt(repo.dir)).toBe(name);
    } finally {
      copy.remove();
    }
  });

  it('does not take a name that is another repo’s for a checkout that is not its first-commit twin', async () => {
    const other = tempGitRepo();
    try {
      run(other.dir, 'commit', '--quiet', '--allow-empty', '-m', 'unrelated');
      run(other.dir, 'remote', 'add', 'origin', 'https://github.com/acme/other.git');

      const refused = await otea('repos', 'add', other.dir, '--name', name);

      expect(refused.code).toBe(5);
      expect((await otea('repos', 'list')).out.trim()).toMatch(new RegExp(`^${name}  root:`));
    } finally {
      other.remove();
    }
  });

  it('still matches a checkout with no origin by the first commit, as before', () => {
    const copy = fork(undefined);
    try {
      expect(nameAt(copy.dir)).toBe(name);
    } finally {
      copy.remove();
    }
  });
});
