import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAlive } from '../app/presence.ts';
import { ensureUiToken } from '../server/token.ts';
import { SERVE_LOG } from './daemon.ts';
import { readServeFile, SERVE_FILE } from './serve-file.ts';
import { spawnCli, type TempRepo, tempGitRepo, until } from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

const home = () => process.env.OTEA_HOME ?? '';

// A process that accepts connections and never answers, with `words` after its script on its
// command line (where a real server has its entry point and subcommand).
function hungServer(words: readonly string[]) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('node:net').createServer(() => {}).listen(0, '127.0.0.1', function () { console.log(this.address().port); })",
      ...words,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const port = new Promise<number>((resolve) =>
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim()))),
  );
  return { child, port };
}

// otea serve start runs the server on its own, so a test that fails halfway must still end it.
async function stopWhatRuns(cwd: string) {
  const running = readServeFile(home());
  await spawnCli(cwd, 'serve', 'stop');
  if (running) await until(() => !processAlive(running.pid), 15_000);
}

describe('serve start, status and stop', () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = tempGitRepo();
    expect((await spawnCli(repo.dir, 'init', '--local')).code).toBe(0);
  });

  afterEach(async () => {
    await stopWhatRuns(repo.dir);
    rmSync(join(home(), SERVE_FILE), { force: true });
    repo.remove();
  });

  // The agent's shell ends right after the command (here: the process that ran it has ended and
  // its pipes are closed, as spawnCli's resolving shows), and the server must outlive it, past
  // the checks that stop a server whose starter is gone (every 5 s).
  it('starts a server that outlives the command that started it, then stops it by its pid', async () => {
    const started = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    expect(started.err).toBe('');
    expect(started.code).toBe(0);
    expect(started.out).toMatch(
      /^Otea running in the background at http:\/\/127\.0\.0\.1:\d+\/p\//,
    );
    const info = readServeFile(home());
    if (!info) throw new Error('serve start left no serve.json');

    await new Promise((resolve) => setTimeout(resolve, 8_000));

    expect(processAlive(info.pid)).toBe(true);
    const status = await spawnCli(repo.dir, 'serve', 'status');
    expect(status.code).toBe(0);
    expect(status.out).toContain(`pid ${info.pid}`);

    const stopped = await spawnCli(repo.dir, 'serve', 'stop');
    expect(stopped.out).toBe(`Stopped otea serve (pid ${info.pid}, port ${info.port})\n`);
    expect(processAlive(info.pid)).toBe(false);
    expect(existsSync(join(home(), SERVE_FILE))).toBe(false);
    const after = await spawnCli(repo.dir, 'serve', 'status');
    expect(after.code).toBe(11);
  }, 60_000);

  // A harness reads a command's output through a pipe until the pipe closes. A server that held it
  // open (Windows lets a child inherit every handle of its parent) kept that read, and the agent's
  // call with it, running for as long as the server did.
  it('returns to a shell that reads its output through a pipe, with the server still running', async () => {
    const node = `"${process.execPath}" --disable-warning=ExperimentalWarning "${MAIN}" serve start --no-open --port 0`;
    const [shell, ...args] =
      process.platform === 'win32'
        ? ['powershell.exe', '-NoProfile', '-Command', `& ${node}`]
        : ['sh', '-c', node];
    const child = spawn(shell as string, args, {
      cwd: repo.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The read of its output ends with 'close', once nothing holds the pipe. The wait is long: a
    // Windows runner takes half a minute over a start (PowerShell, then cmd, then the server) when
    // it is busy, and a server that does hold the pipe never lets go, however long this waits.
    const returned = await new Promise<boolean>((resolve) => {
      child.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 100_000);
    });
    if (!returned) child.kill();

    expect(returned).toBe(true);
    const info = readServeFile(home());
    expect(processAlive(info?.pid ?? 0)).toBe(true);
  }, 120_000);

  it('keeps the sign-in key out of its log, which only its owner reads', async () => {
    const started = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    expect(started.code).toBe(0);
    // The command prints the link for the person or agent that ran it; the server does not.
    const token = ensureUiToken(home());
    expect(started.out).toContain(token);

    const log = readFileSync(join(home(), SERVE_LOG), 'utf8');
    expect(log).toContain('Otea running at');
    expect(log).not.toContain(token);
    expect(log).not.toMatch(/token=|pairing/i);
    if (process.platform !== 'win32') {
      expect(statSync(join(home(), SERVE_LOG)).mode & 0o777).toBe(0o600);
    }
  }, 60_000);

  it('refuses --lan: no listener on the network runs unattended', async () => {
    const refused = await spawnCli(repo.dir, 'serve', 'start', '--lan');

    expect(refused.code).toBe(2);
    expect(refused.err).toContain('otea serve --lan');
    expect(readServeFile(home())).toBeUndefined();
  }, 60_000);

  it('starts one server when two starts run at once, and both report it', async () => {
    const [one, two] = await Promise.all([
      spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0'),
      spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0'),
    ]);

    const info = readServeFile(home());
    expect([one.code, two.code]).toEqual([0, 0]);
    expect(one.err + two.err).toBe('');
    expect(one.out).toContain(`pid ${info?.pid}`);
    expect(two.out).toContain(`pid ${info?.pid}`);
    // One of them started it, the other found it running.
    expect([one.out, two.out].filter((out) => out.includes('in the background'))).toHaveLength(1);
  }, 120_000);

  // A busy server may not answer a probe in time; a record of a live process is not stale for that.
  it('keeps the record of a live server that does not answer in time, and ends it only on stop', async () => {
    ensureUiToken(home());
    // Accepts connections and never answers; its command line is this install's background server.
    const hung = hungServer([MAIN, 'serve', '--no-owner', '--no-open', '--daemon']);
    try {
      const port = await hung.port;
      const pid = hung.child.pid ?? 0;
      writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port, pid }));

      const status = await spawnCli(repo.dir, 'serve', 'status');
      expect(status.code).toBe(13);
      expect(status.err).toContain('did not answer in time');
      expect(readServeFile(home())).toEqual({ port, pid });
      expect(processAlive(pid)).toBe(true);

      const again = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
      expect(again.code).not.toBe(0);
      expect(readServeFile(home())).toEqual({ port, pid });

      const stopped = await spawnCli(repo.dir, 'serve', 'stop');
      expect(stopped.out).toBe(`Stopped otea serve (pid ${pid}, port ${port})\n`);
      await until(() => !processAlive(pid), 10_000);
      expect(readServeFile(home())).toBeUndefined();
    } finally {
      hung.child.kill();
    }
  }, 120_000);

  // What stop kills must be this install's background server: a `node … serve` of another program
  // (vite serve, npx serve) that holds a recorded pid is not.
  it('does not end a live process that only looks like a serve, when it cannot be confirmed', async () => {
    ensureUiToken(home());
    const other = hungServer(['serve', '--port', '5173']);
    const lookalike = hungServer([MAIN, 'serve']); // otea's own serve, but not the daemon
    try {
      for (const bystander of [other, lookalike]) {
        const port = await bystander.port;
        const pid = bystander.child.pid ?? 0;
        writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port, pid }));

        const stopped = await spawnCli(repo.dir, 'serve', 'stop');

        expect(stopped.code).toBe(0);
        expect(stopped.out).toContain(`removed the record of ${pid}`);
        expect(processAlive(pid)).toBe(true);
        expect(readServeFile(home())).toBeUndefined();
      }
    } finally {
      other.child.kill();
      lookalike.child.kill();
    }
  }, 120_000);

  // Without its key nothing can ask the process anything; that is no proof it is not a server.
  it('keeps the record of a live process when the key to ask it with is missing', async () => {
    const hung = hungServer([MAIN, 'serve', '--no-owner', '--no-open', '--daemon']);
    try {
      const port = await hung.port;
      const pid = hung.child.pid ?? 0;
      rmSync(join(home(), 'ui-token'), { force: true });
      writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port, pid }));

      const status = await spawnCli(repo.dir, 'serve', 'status');

      expect(status.code).toBe(13);
      expect(status.err).toContain('ui-token');
      expect(readServeFile(home())).toEqual({ port, pid });
      expect(processAlive(pid)).toBe(true);
    } finally {
      hung.child.kill();
      rmSync(join(home(), SERVE_FILE), { force: true });
    }
  }, 120_000);

  // The lock file is made before its owner's id is written into it: an empty one is a start under
  // way, not one left behind.
  it('waits for a start whose lock is not written yet', async () => {
    const lock = join(home(), 'serve.lock');
    writeFileSync(lock, '');

    const start = spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const early = readServeFile(home());
    rmSync(lock, { force: true });
    const started = await start;

    expect(early).toBeUndefined();
    expect(started.code).toBe(0);
    expect(readServeFile(home())).toBeDefined();
  }, 120_000);

  it('runs one server per home: a second start reports the one running', async () => {
    await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    const first = readServeFile(home());

    const again = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');

    expect(again.code).toBe(0);
    expect(again.out).toContain(`Otea already runs on this computer (pid ${first?.pid})`);
    expect(readServeFile(home())).toEqual(first);
  }, 60_000);

  it('cleans up the record of a server that ended, and starts anew over it', async () => {
    const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    mkdirSync(home(), { recursive: true });
    writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port: 1, pid: Number(gone.stdout) }));

    const status = await spawnCli(repo.dir, 'serve', 'status');
    expect(status.code).toBe(11);
    expect(existsSync(join(home(), SERVE_FILE))).toBe(false);

    writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port: 1, pid: Number(gone.stdout) }));
    const started = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    expect(started.code).toBe(0);
    expect(readServeFile(home())?.pid).not.toBe(Number(gone.stdout));
  }, 60_000);

  it('never ends a live process on the recorded port that answers something else', async () => {
    ensureUiToken(home());
    // Another program that took the process id and the port: a web server of its own.
    const other = spawn(
      process.execPath,
      [
        '-e',
        "require('node:http').createServer((q, r) => r.end('not otea')).listen(0, '127.0.0.1', function () { console.log(this.address().port); })",
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    try {
      const port = await new Promise<number>((resolve) =>
        other.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim()))),
      );
      const pid = other.pid ?? 0;
      writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port, pid }));

      const stopped = await spawnCli(repo.dir, 'serve', 'stop');

      expect(stopped.code).toBe(0);
      expect(stopped.out).toContain(`removed the record of ${pid}`);
      expect(processAlive(pid)).toBe(true);
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('not otea');
      expect(existsSync(join(home(), SERVE_FILE))).toBe(false);
    } finally {
      other.kill();
    }
  }, 60_000);

  it('never ends a process its record names that is no server of this home', async () => {
    // A process another program took the id of: alive, and it answers nothing.
    const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
      stdio: 'ignore',
    });
    try {
      const pid = bystander.pid ?? 0;
      writeFileSync(join(home(), SERVE_FILE), JSON.stringify({ port: 1, pid }));

      const stopped = await spawnCli(repo.dir, 'serve', 'stop');

      expect(stopped.code).toBe(0);
      expect(stopped.out).toContain(`removed the record of ${pid}`);
      expect(processAlive(pid)).toBe(true);
      expect(existsSync(join(home(), SERVE_FILE))).toBe(false);
    } finally {
      bystander.kill();
    }
  }, 60_000);
});
