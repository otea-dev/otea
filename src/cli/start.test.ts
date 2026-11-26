import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rememberLanguage } from '../app/language.ts';
import { withMachine } from '../app/machine.ts';
import { processAlive } from '../app/presence.ts';
import { isListedKey } from '../core/board/templates.ts';
import { SERVE_LOG } from './daemon.ts';
import { readServeFile, SERVE_FILE } from './serve-file.ts';
import { cliAt, type Result, type TempRepo, tempGitRepo, until } from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

const home = () => process.env.OTEA_HOME ?? '';

// The person at a terminal: no agent name in the environment (spawnCli runs as an agent).
function person(cwd: string, ...argv: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const { OTEA_AGENT: _agent, ...env } = process.env;
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', MAIN, ...argv],
      { cwd, env },
    );
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

type Started = {
  project: { id: string; created: boolean };
  boards: { made: unknown[]; all: string[] };
  desk: { pid: number; started: boolean };
  prompt: string;
  mcp: { name: string; command: string };
};

const json = (result: Result) => JSON.parse(result.out) as Started;

// otea start leaves the server running on its own, so a test must end it, whatever it asserted.
async function stopWhatRuns(cwd: string) {
  const running = readServeFile(home());
  await person(cwd, 'serve', 'stop');
  if (running) await until(() => !processAlive(running.pid), 15_000);
}

describe('otea start', () => {
  let repo: TempRepo;
  const folders: string[] = [];

  beforeEach(() => {
    repo = tempGitRepo();
  });

  afterEach(async () => {
    await stopWhatRuns(repo.dir);
    rmSync(join(home(), SERVE_FILE), { force: true });
    // `otea serve stop` already waits for the server's pid to end (daemon.ts kill), and this test
    // waited for it again: it was gone. Yet on Windows the log stayed locked for 60 to 115 ms
    // after that in 4 of 16 teardowns measured on an idle machine (EBUSY here, EPERM on CI): the
    // system releases a dead process's handles a moment later. So the removal retries.
    rmSync(join(home(), SERVE_LOG), { force: true, maxRetries: 20, retryDelay: 250 });
    repo.remove();
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  const gitStatus = (dir: string) =>
    execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

  // The first minutes in one command: the project, a board from a template, the background desk and
  // what to paste into the agent. Run again it looks before it acts and reports what was there.
  it('does each step on a fresh repo, and a second run changes nothing and says so', async () => {
    const first = await person(
      repo.dir,
      'start',
      '--no-open',
      '--port',
      '0',
      '--template',
      'todos',
      '--json',
    );
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    const one = json(first);
    expect(one.project.created).toBe(true);
    expect(one.boards.made).toHaveLength(1);
    expect(one.desk.started).toBe(true);
    expect(processAlive(one.desk.pid)).toBe(true);
    expect(readServeFile(home())?.pid).toBe(one.desk.pid);
    // The prompt is the one `otea prompt` prints, and the MCP server is the one connect names.
    const printed = await person(repo.dir, 'prompt');
    expect(printed.out.trim()).toBe(one.prompt.trim());
    expect(one.mcp).toMatchObject({ name: 'otea', command: expect.any(String) });
    // The link carries the server's key: it is never in --json.
    expect(first.out).not.toContain('token=');

    const second = await person(repo.dir, 'start', '--no-open', '--template', 'todos', '--json');
    expect(second.code).toBe(0);
    const two = json(second);
    expect(two.project).toMatchObject({ id: one.project.id, created: false });
    expect(two.boards.made).toEqual([]);
    expect(two.boards.all).toEqual(one.boards.all);
    expect(two.desk).toMatchObject({ pid: one.desk.pid, started: false });
    expect(readServeFile(home())?.pid).toBe(one.desk.pid);

    const text = await person(repo.dir, 'start', '--no-open', '--template', 'todos');
    expect(text.out).toContain('is already set up');
    expect(text.out).toContain('Boards: already has');
    expect(text.out).toContain('was not added');
    expect(text.out).toContain('Desk: already running');
    // Hablar's conversation is the secretary's: start says where its text is (field study 3).
    expect(text.out).toContain('otea prompt --role secretary');
  }, 120_000);

  it('makes no board unless one is named, and leaves the boards to the agent', async () => {
    const started = await person(repo.dir, 'start', '--no-open', '--port', '0', '--json');
    expect(started.code).toBe(0);
    const data = json(started);
    expect(data.project.created).toBe(true);
    expect(data.boards).toEqual({ made: [], all: [] });
    // With no board of its own the agent gets the whole first contact.
    expect(data.prompt).toContain('otea board draft');
  }, 120_000);

  // The language is the person's to force: --lang decides the board and the text for the agent, and
  // the report says which it used, whatever this shell's locale says (P4-F5, P5-F4).
  it('makes the board and the text in the language --lang gives, and says which', async () => {
    const started = await person(
      repo.dir,
      'start',
      '--no-open',
      '--port',
      '0',
      '--template',
      'todos',
      '--lang',
      'es',
    );
    expect(started.code).toBe(0);
    expect(started.out).toContain('Boards: made "Pendientes"');
    expect(started.out).toContain(
      'Language: Spanish for the boards and the text below (--lang en makes them English)',
    );
    // With a board made, the agent's text is the one that joins it, in Spanish.
    expect(started.out).toContain('Empieza a trabajar en este proyecto');
  }, 120_000);

  // P8-F2: the second run, with the same arguments, said Spanish after the desk changed language. The
  // language is the project's, set when it was made; the desk's own does not move it.
  it('says the same language on a second run after the desk changed its own', async () => {
    const languageLine = (result: Result) =>
      result.out.split('\n').find((line) => line.startsWith('Language:'));
    try {
      withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
      const first = await person(
        repo.dir,
        'start',
        '--no-open',
        '--port',
        '0',
        '--template',
        'none',
      );
      withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));
      const second = await person(
        repo.dir,
        'start',
        '--no-open',
        '--port',
        '0',
        '--template',
        'none',
      );

      expect(languageLine(first)).toContain('Language: English');
      expect(languageLine(second)).toBe(languageLine(first));
    } finally {
      withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
    }
  }, 120_000);

  // With no one to ask, no board is made for the person: they leave with the way to one (an agent,
  // or the template command with its keys), and the init their agent runs next does not tell them
  // to start the desk that already runs.
  it('says how to get a board when none was made, and init does not say to start a running desk', async () => {
    const started = await person(repo.dir, 'start', '--no-open', '--port', '0');
    expect(started.code).toBe(0);
    // A choice in one line, by what the person does: the two templates a first session is likely to
    // want (a simple dev has no way to know which to pick), each a real key, or the agent's design.
    // P2-F8: one line per template, each the exact command and what the board is for, so a dev
    // with a code repo knows which to run without opening the help.
    const lines = started.out.split('\n');
    const at = lines.findIndex((line) => line.startsWith('Boards:'));
    expect(lines[at]).toContain('none yet');
    const hint = lines.slice(at, at + 5).join('\n');
    expect(hint).toMatch(/otea start --template changes\s+code: .*branch/);
    expect(hint).toMatch(/otea start --template todos\s+anything that is not code/);
    expect(hint).toContain('your agent designs the boards with you');
    expect(isListedKey('changes') && isListedKey('todos')).toBe(true);

    const init = await person(repo.dir, 'init');
    expect(init.out).toContain('the desk already runs at');
    expect(init.out).not.toContain('run otea serve');
  }, 120_000);

  it('never runs for an agent, which connects and never starts the desk', async () => {
    const refused = await cliAt(repo.dir, { OTEA_AGENT: 'claude' })('start', '--no-open');

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('otea start is for the person');
    expect(readServeFile(home())).toBeUndefined();
    // Nothing was made: no project exists here yet.
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
  });

  it('refuses an agent that names itself with --as, before it makes anything', async () => {
    const refused = await cliAt(repo.dir)('start', '--as', 'claude', '--no-open');

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('otea start is for the person');
    expect(readServeFile(home())).toBeUndefined();
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
  });

  it('fails on a template it does not know before it makes anything', async () => {
    const result = await cliAt(repo.dir)('start', '--no-open', '--template', 'nope');

    expect(result.code).not.toBe(0);
    expect(result.err).toContain('There is no template nope');
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
    expect(readServeFile(home())).toBeUndefined();
  });

  // What is typed at the prompt is checked like the option: a typo leaves no project behind.
  it('fails on a template typed at the prompt before the project is made', async () => {
    const asked: string[] = [];
    const typo = cliAt(repo.dir, {}, undefined, undefined, async (question) => {
      asked.push(question);
      return 'nope';
    });

    const result = await typo('start', '--no-open', '--port', '0');

    expect(asked).toHaveLength(1);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('There is no template nope');
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
    expect(readServeFile(home())).toBeUndefined();
  });

  // The project lives in the Otea home: the repo is the person's, and start writes nothing in it.
  it('leaves the repository untouched: no AGENTS.md, no hook, no .otea, a clean status', async () => {
    repo.write('README.md', '# shop\n');
    execFileSync('git', ['add', '.'], { cwd: repo.dir });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'first'],
      { cwd: repo.dir },
    );
    const before = readdirSync(repo.dir).sort();

    const started = await person(
      repo.dir,
      'start',
      '--no-open',
      '--port',
      '0',
      '--template',
      'todos',
    );

    expect(started.code).toBe(0);
    expect(readdirSync(repo.dir).sort()).toEqual(before);
    expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(repo.dir, '.otea'))).toBe(false);
    expect(existsSync(join(repo.dir, '.git', 'hooks', 'pre-push'))).toBe(false);
    expect(gitStatus(repo.dir)).toBe('');
  }, 120_000);

  it('starts a folder that is no git repository, with a first contact that speaks of no git', async () => {
    const folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-folder-')));
    folders.push(folder);

    const started = await person(folder, 'start', '--no-open', '--port', '0', '--json');

    expect(started.code).toBe(0);
    const data = json(started);
    expect(data.project.created).toBe(true);
    expect(data.prompt).toContain('otea board draft');
    expect(data.prompt).not.toMatch(/\bgit\b/i);
    expect(existsSync(join(folder, '.git'))).toBe(false);
  }, 120_000);

  // A person who left the boards to their agent is not asked again on the next run.
  it('asks about a first board once, when the project is made, and never on a second run', async () => {
    const asked: string[] = [];
    const answer = async (question: string) => {
      asked.push(question);
      return 'none';
    };
    const terminal = () => cliAt(repo.dir, {}, undefined, undefined, answer);

    const first = await terminal()('start', '--no-open', '--port', '0');
    expect(first.code).toBe(0);
    expect(asked).toHaveLength(1);
    expect(first.out).toContain('Boards: none yet');

    const second = await terminal()('start', '--no-open', '--json');
    expect(second.code).toBe(0);
    expect(asked).toHaveLength(1);
    expect(json(second).project.created).toBe(false);

    // And with no terminal at all (a pipe) it never asks: it makes no board and moves on.
    const piped = await person(repo.dir, 'start', '--no-open', '--json');
    expect(piped.code).toBe(0);
    expect(json(piped).boards.all).toEqual([]);
  }, 120_000);

  // P2-F8: at a terminal the person sees a short numbered choice of the boards that fit, with the
  // default marked, and nothing is made until they choose. Enter takes the default they just saw.
  describe('the first board, chosen at a terminal', () => {
    const typing = (...answers: string[]) => {
      const asked: string[] = [];
      const ask = async (question: string) => {
        asked.push(question);
        return answers[asked.length - 1] ?? '';
      };
      return { asked, cli: (cwd = repo.dir) => cliAt(cwd, {}, undefined, undefined, ask) };
    };
    // The boards the report says it made (the text: --json is for scripts, which are never asked).
    const made = (result: Result) => {
      if (result.out.startsWith('{')) return json(result).boards.all;
      const line = result.out.split('\n').find((text) => text.startsWith('Boards:')) ?? '';
      return line.startsWith('Boards: made')
        ? [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1])
        : [];
    };

    it('shows the choices with one plain line each and the default marked, then makes the picked board', async () => {
      const { asked, cli } = typing('2');

      const started = await cli()('start', '--no-open', '--port', '0');

      expect(started.code).toBe(0);
      expect(asked).toHaveLength(1);
      const question = asked[0] ?? '';
      expect(question).toMatch(/1\) changes\s+code: /);
      expect(question).toMatch(/2\) todos\s+anything that is not code/);
      expect(question).toMatch(/3\) agent\s+no board now: your agent designs/);
      expect(question).toMatch(/none/);
      // A code repo: the default is the code board, said before the person answers.
      expect(question).toMatch(/1\) changes.*\(default\)/);
      expect(made(started)).toEqual(['To-dos']);
    }, 120_000);

    it('takes the default on Enter, only after it was shown: changes in a git repo, to-dos elsewhere', async () => {
      const inRepo = typing('');
      const started = await inRepo.cli()('start', '--no-open', '--port', '0');
      expect(started.code).toBe(0);
      expect(inRepo.asked[0]).toContain('(default)');
      expect(made(started)).toEqual(['Changes']);

      const folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-folder-')));
      folders.push(folder);
      const outside = typing('');
      const plain = await outside.cli(folder)('start', '--no-open');
      expect(plain.code).toBe(0);
      expect(outside.asked[0]).toMatch(/2\) todos.*\(default\)/);
      expect(made(plain)).toEqual(['To-dos']);
    }, 120_000);

    it.each(['none', 'None', '3', 'agent'])(
      'makes no board on %s',
      async (answer) => {
        const { cli } = typing(answer);

        const started = await cli()('start', '--no-open', '--port', '0');

        expect(started.code).toBe(0);
        expect(started.out).toContain('Project: set up');
        expect(made(started)).toEqual([]);
      },
      120_000,
    );

    it('leaves nothing behind on Ctrl+C: no project, no board, no desk', async () => {
      const interrupted = cliAt(repo.dir, {}, undefined, undefined, async () => {
        throw new DOMException('The operation was aborted', 'AbortError');
      });

      const result = await interrupted('start', '--no-open', '--port', '0');

      expect(result.code).toBe(130);
      expect(result.err).toContain('nothing was made');
      expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
      expect(readServeFile(home())).toBeUndefined();
    });

    // A script, a pipe or an agent never waits on a question.
    it.each([
      ['--json', ['--json'], []],
      ['--no-board', ['--no-board'], []],
      ['--template', ['--template', 'todos'], ['To-dos']],
      ['--yes', ['--yes'], ['Changes']],
    ])(
      'never asks with %s',
      async (_name, extra, boards) => {
        const { asked, cli } = typing('1');

        const started = await cli()('start', '--no-open', '--port', '0', ...extra);

        expect(started.code).toBe(0);
        expect(asked).toEqual([]);
        expect(made(started)).toEqual(boards);
      },
      120_000,
    );

    // --yes is yes to the default the question shows: changes in a git repo, to-dos in a folder.
    it('takes the default board with --yes in a plain folder, and --no-board never mixes with it', async () => {
      const folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-folder-')));
      folders.push(folder);
      const { asked, cli } = typing('1');

      const started = await cli(folder)('start', '--no-open', '--port', '0', '--yes');
      expect(started.code).toBe(0);
      expect(made(started)).toEqual(['To-dos']);

      for (const clash of [['--yes'], ['--template', 'todos']]) {
        const refused = await cli()('start', '--no-open', '--no-board', ...clash);
        expect(refused.code).toBe(2);
        expect(refused.err).toContain('--no-board');
      }
      expect(asked).toEqual([]);
      expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
    }, 120_000);

    it('never asks an agent, which is refused before anything', async () => {
      const asked: string[] = [];
      const agent = cliAt(
        repo.dir,
        { OTEA_AGENT: 'claude' },
        undefined,
        undefined,
        async (question) => {
          asked.push(question);
          return '1';
        },
      );

      const refused = await agent('start', '--no-open');

      expect(refused.code).not.toBe(0);
      expect(asked).toEqual([]);
    });
  });

  // The sign-in link holds this computer's key: it must not travel with the agent's text.
  it('prints the sign-in link in a block of its own, apart from the text for the agent', async () => {
    const started = await person(repo.dir, 'start', '--no-open', '--port', '0');

    const lines = started.out.split('\n');
    const link = lines.findIndex((line) => line.includes('/auth?token='));
    const paste = lines.findIndex((line) => line.startsWith('Next, paste this'));
    expect(link).toBeGreaterThan(-1);
    expect(paste).toBeGreaterThan(link);
    // On its own line, a blank line between it and the agent's text, and nothing after it but that.
    expect(lines[link]?.trim()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\?token=/);
    expect(lines.slice(link + 1, paste).every((line) => line === '')).toBe(true);
    expect(lines.slice(paste).join('\n')).not.toContain('token=');
  }, 120_000);
});
