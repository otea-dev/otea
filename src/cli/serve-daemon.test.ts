import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAlive } from '../app/presence.ts';
import { readServeFile, SERVE_FILE } from './serve-file.ts';
import { spawnCli, type TempRepo, tempGitRepo, until } from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

const home = () => process.env.OTEA_HOME ?? '';

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
    // The read of its output ends with 'close', once nothing holds the pipe.
    const returned = await new Promise<boolean>((resolve) => {
      child.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 40_000);
    });
    if (!returned) child.kill();

    expect(returned).toBe(true);
    const info = readServeFile(home());
    expect(processAlive(info?.pid ?? 0)).toBe(true);
  }, 60_000);

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
