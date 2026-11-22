import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAlive } from '../app/presence.ts';
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

  beforeEach(() => {
    repo = tempGitRepo();
  });

  afterEach(async () => {
    await stopWhatRuns(repo.dir);
    rmSync(join(home(), SERVE_FILE), { force: true });
    rmSync(join(home(), SERVE_LOG), { force: true });
    repo.remove();
  });

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

  it('never runs for an agent, which connects and never starts the desk', async () => {
    const refused = await cliAt(repo.dir, { OTEA_AGENT: 'claude' })('start', '--no-open');

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('otea start is for the person');
    expect(readServeFile(home())).toBeUndefined();
    // Nothing was made: no project exists here yet.
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
  });

  it('fails on a template it does not know before it makes anything', async () => {
    const result = await cliAt(repo.dir)('start', '--no-open', '--template', 'nope');

    expect(result.code).not.toBe(0);
    expect(result.err).toContain('There is no template nope');
    expect((await cliAt(repo.dir)('projects', 'current')).code).not.toBe(0);
    expect(readServeFile(home())).toBeUndefined();
  });
});
