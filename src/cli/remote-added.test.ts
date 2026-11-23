import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject } from '../app/project.ts';
import { repoNameAt, UnknownRepo } from '../app/repos.ts';
import { type Cli, cliAt, declareProfiles, tempGitRepo } from './testing.ts';

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
    // P10-F1, P3-F3: what happened, and the one command, with no "repo knows repo" when the
    // folder and the project share a name.
    expect(refused.err).toContain('a remote was added after Otea first saw it');
    expect(refused.err).toContain(
      `If it is, run once in ${repo.dir}: otea repos add --name ${name}, then push again`,
    );
    expect(refused.err).not.toMatch(/knows .* only by its first commit/);
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

// The agent hears of it before the push is refused: next and claim say it, with the one command and
// that the person's word comes first (persona P3, round 6).
describe('a remote added after init, said before the push', () => {
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
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    const person = cliAt(repo.dir);
    expect((await person('init', '--local', '--template', 'none')).code).toBe(0);
    expect(
      (await person('board', 'add', 'Tasks', '--template', 'todos', '--lang', 'en')).code,
    ).toBe(0);
    declareProfiles(repo.dir, 'quill');
    const made = await otea(
      'create',
      '--collection',
      'Tasks',
      '--title',
      'Water',
      '--field',
      'What is needed=water the plants',
    );
    expect(made.err).toBe('');
    expect(made.code).toBe(0);
  });

  afterEach(() => repo.remove());

  it('says nothing while the repo has no remote or was never changed', async () => {
    const next = await otea('next');

    expect(next.out).not.toContain('repos add');
  });

  it('tells next and claim which command to run, and that the person says first', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');
    const name = (await otea('repos', 'list')).out.trim().split(/\s+/)[0] ?? '';

    const next = await otea('next');
    const claim = await otea('claim', 'TOD-1');

    for (const said of [next.out, claim.out]) {
      expect(said).toContain('remote was added');
      expect(said).toContain(`otea repos add --name "${name}"`);
      expect(said).toContain('ask the person');
    }
    // The push is still refused until then: the notice changes nothing.
    expect((await otea('repos', 'list')).out).toContain(`${name}  root:`);
  });

  it('keeps it in the data a program reads, not only in the text', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');

    const claim = JSON.parse((await otea('claim', 'TOD-1', '--json')).out);

    expect(claim.text).toContain('remote was added');
    expect(claim.text).toContain('otea repos add --name');
    expect(claim.id).toBe('TOD-1');
  });

  it('stops saying it once the repo went by its origin', async () => {
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');
    const name = (await otea('repos', 'list')).out.trim().split(/\s+/)[0] ?? '';
    expect((await otea('repos', 'add', '--name', name)).code).toBe(0);

    const next = await otea('next');

    expect(next.out).not.toContain('remote was added');
  });
});

// A repo that had its remote when Otea first saw it is known by it: nothing to say.
describe('a repo that always had a remote', () => {
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
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    git('remote', 'add', 'origin', 'https://github.com/acme/keys.git');
    const person = cliAt(repo.dir);
    expect((await person('init', '--local', '--template', 'none')).code).toBe(0);
    expect(
      (await person('board', 'add', 'Tasks', '--template', 'todos', '--lang', 'en')).code,
    ).toBe(0);
    declareProfiles(repo.dir, 'quill');
    const made = await otea(
      'create',
      '--collection',
      'Tasks',
      '--title',
      'Water',
      '--field',
      'What is needed=water the plants',
    );
    expect(made.code).toBe(0);
  });

  afterEach(() => repo.remove());

  it('is silent on next and claim, in text and in data', async () => {
    const next = await otea('next');
    const claim = await otea('claim', 'TOD-1', '--json');

    expect(next.out).not.toContain('remote was added');
    expect(next.out).not.toContain('repos add');
    expect(JSON.parse(claim.out).text ?? '').not.toContain('remote was added');
    expect(claim.out).not.toContain('repos add');
  });
});
