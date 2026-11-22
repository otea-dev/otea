import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    expect((await otea('init', '--local', '--template', 'none')).code).toBe(0);
    expect((await otea('repos', 'list')).out).toContain('root:');
  });

  afterEach(() => repo.remove());

  it('still tells which repo this is, so the push gate does not refuse it', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const gate = await otea('check', '--gate', 'push', '--branch', 'feature', '--repo');

    expect(gate.err).not.toContain('refused');
    expect(gate.code).not.toBe(19);
  });

  it('keeps one repo when it is named again, instead of adding a second for the same checkout', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const named = await otea('repos', 'add', '--name', 'keys');
    const listed = (await otea('repos', 'list')).out.trim().split('\n');

    expect(named.code).toBe(0);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(/^keys {2}root:/);
  });
});
