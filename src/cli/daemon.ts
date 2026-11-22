import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restrictToOwner } from '../app/owner-only.ts';
import { processAlive } from '../app/presence.ts';
import { readUiToken } from '../server/token.ts';
import { probeSignIn } from './probe.ts';
import { readServeFile, removeServeFile, type ServeInfo } from './serve-file.ts';

// What the background server prints (its stdout and stderr), kept in the Otea home beside serve.json.
export const SERVE_LOG = 'serve.log';

// Held while one `serve start` looks for a server and starts one, so two starts never start two.
const START_LOCK = 'serve.lock';

export type ServerState =
  // Alive, and it answers with this Otea home's key.
  | { kind: 'running'; pid: number; port: number; url: string; token: string }
  // serve.json names a process that ended, or one that is no server of this home (a process id
  // another program took, or a server of another home or another program on that port): nothing
  // to stop.
  | { kind: 'stale'; info: ServeInfo; ended: boolean }
  // The process lives but its port did not answer in time, several times over: it may be a busy
  // server of this home. The record stays; nothing here proves it stale.
  | { kind: 'unresponsive'; info: ServeInfo }
  | { kind: 'none' };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE_TRIES = 3;

// Whether this Otea home's server runs, from the record it keeps in the home (serve.json) and a
// sign-in probe: a process id alone proves nothing, one that ended may belong to anything by now.
// Only a definite no makes a record stale: the process gone, the port refusing or answering as
// something else. A probe that times out is retried, then reported as unresponsive.
export async function inspectServer(home: string): Promise<ServerState> {
  const info = readServeFile(home);
  if (!info) return { kind: 'none' };
  const token = readUiToken(home);
  if (!processAlive(info.pid)) return { kind: 'stale', info, ended: true };
  if (!token) return { kind: 'stale', info, ended: false };
  const url = `http://127.0.0.1:${info.port}`;
  for (let attempt = 1; ; attempt++) {
    const probe = await probeSignIn(`${url}/auth?token=${encodeURIComponent(token)}`);
    if (probe === 'ours') return { kind: 'running', pid: info.pid, port: info.port, url, token };
    if (probe !== 'slow') return { kind: 'stale', info, ended: false };
    if (attempt >= PROBE_TRIES) return { kind: 'unresponsive', info };
    await pause(300);
  }
}

// Forgets the record of a server that is gone, as the server itself does when it ends.
export function forgetStale(home: string, state: ServerState): void {
  if (state.kind === 'stale') removeServeFile(home, state.info.pid);
}

// The command line of a process, when the system says (ps; on Windows, WMI through PowerShell).
export function processCommand(pid: number): string | undefined {
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').CommandLine`,
            ],
            {
              encoding: 'utf8',
              timeout: 15_000,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'ignore'],
            },
          )
        : execFileSync('ps', ['-o', 'command=', '-p', String(Math.trunc(pid))], {
            encoding: 'utf8',
            timeout: 5_000,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Whether a command line is an otea serve: a node (or Electron, or otea) running `serve`.
export function isServeCommand(line: string): boolean {
  return /\bserve\b/.test(line) && /node|electron|otea/i.test(line);
}

// How the background server starts: Node (or the desktop app's Electron) on Otea's own main.
export type Launch = {
  command: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
};

export type StartOptions = {
  port: number;
  launch: Launch;
  // Where a notice goes (the start fell back to another way to start the server).
  warn: (message: string) => void;
};

const POLL_MS = 100;
// A cold start on Windows takes several seconds before the server answers.
const START_TIMEOUT_MS = 30_000;

// What the log keeps a person from reading by accident: a sign-in link or a pairing code.
function redact(text: string): string {
  return text
    .replace(/token=[^&\s)]+/g, 'token=<redacted>')
    .replace(/pairing code \S+/gi, 'pairing code <redacted>');
}

function logTail(home: string): string {
  try {
    const lines = readFileSync(join(home, SERVE_LOG), 'utf8').trim().split(/\r?\n/);
    return redact(lines.slice(-5).join('\n'));
  } catch {
    return '';
  }
}

const LOG_KEPT_BYTES = 256 * 1024;

// The log is appended to, kept to its owner as the UI key is, and emptied once it grows.
function prepareLog(home: string): string {
  const path = join(home, SERVE_LOG);
  const fresh = !existsSync(path) || statSync(path).size > LOG_KEPT_BYTES;
  if (fresh) {
    writeFileSync(path, '', { mode: 0o600 });
    restrictToOwner(path);
  }
  return path;
}

// The process that starts the server, as far as the start can tell whether it is still coming up.
type Starting = {
  failed: () => Error | undefined;
  ended: () => boolean;
  kill: () => void;
};

// A new session on Linux and macOS, with the output in the log. Only the three standard streams
// reach it: the shell's own pipes are closed in the child, so a command that captures this one's
// output sees it end as soon as this ends.
function detach(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
): Starting {
  const log = openSync(logPath, 'a');
  let ended = false;
  let failed: Error | undefined;
  const child = spawn(command, args as string[], {
    // Never from a project's folder: it would stay busy for as long as the server runs.
    cwd: tmpdir(),
    env,
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  closeSync(log);
  child.on('error', (error) => {
    failed = error;
  });
  child.on('exit', () => {
    ended = true;
  });
  child.unref();
  return {
    failed: () => failed,
    ended: () => ended,
    kill: () => {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    },
  };
}

const HELPER_TIMEOUT_MS = 30_000;

// A reason PowerShell could not start the server, which is no reason to give the start up: the
// server can still start the plain way.
class HelperUnavailable extends Error {}

// On Windows a child inherits every inheritable handle of its parent, whatever it is given as its
// streams: started the usual way, the server would hold the pipe a harness reads this command's
// output from, and that read would not end for as long as the server runs. A process the shell
// starts (ShellExecute, through PowerShell's Start-Process) inherits none, so PowerShell starts
// cmd, which runs the server with its output in the log. `-PassThru` names cmd, which lives as long
// as the server does. What cmd runs is read from the environment (%OTEA_DAEMON_n%), which cmd
// expands once: a path with a % or a & in it reaches the server as it is.
async function detachOnWindows(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
): Promise<Starting> {
  const words = [command, ...args];
  const named = Object.fromEntries(words.map((word, index) => [`OTEA_DAEMON_${index}`, word]));
  const quoted = words.map((_, index) => `"%OTEA_DAEMON_${index}%"`).join(' ');
  // cmd /s drops the outer pair of quotes and keeps the rest as typed.
  const line = `/d /s /c "${quoted} >>"%OTEA_DAEMON_LOG%" 2>&1"`;
  const script = [
    `$p = Start-Process -FilePath cmd.exe -ArgumentList '${line}' -WindowStyle Hidden -PassThru`,
    '[Console]::Out.Write($p.Id)',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const wrapper = await new Promise<number>((resolve, reject) => {
    const helper = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        cwd: tmpdir(),
        env: { ...env, ...named, OTEA_DAEMON_LOG: logPath },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let printed = '';
    let said = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      helper.kill();
    }, HELPER_TIMEOUT_MS);
    helper.stdout.on('data', (chunk) => {
      printed += String(chunk);
    });
    helper.stderr.on('data', (chunk) => {
      said += String(chunk);
    });
    helper.on('error', (error) => {
      clearTimeout(timer);
      reject(new HelperUnavailable(error.message));
    });
    helper.on('close', (code) => {
      clearTimeout(timer);
      const pid = Number(printed.trim());
      if (Number.isInteger(pid) && pid > 0) resolve(pid);
      else if (timedOut) {
        reject(new Error(`PowerShell did not start otea serve in ${HELPER_TIMEOUT_MS / 1000} s`));
      } else {
        const why = said.trim().split(/\r?\n/)[0] ?? '';
        reject(new HelperUnavailable(`PowerShell exited ${code}${why ? `: ${why}` : ''}`));
      }
    });
  });
  return {
    failed: () => undefined,
    ended: () => !processAlive(wrapper),
    kill: () => {
      spawnSync('taskkill', ['/PID', String(wrapper), '/T', '/F'], { windowsHide: true });
    },
  };
}

// Starts otea serve on its own, detached from the shell that ran this (a new session on
// Linux and macOS, a process of its own without a window on Windows), and resolves once it answers.
// It watches no owner, prints no sign-in link and opens no local network access (--daemon), and
// keeps serving after the terminal or the agent's session that started it is gone, until
// `stopServer`. Its output goes to the log in the home. Fails with the log's last lines when it
// ends before it answers.
async function startServer(
  home: string,
  { port, launch, warn }: StartOptions,
): Promise<Extract<ServerState, { kind: 'running' }>> {
  const args = [
    ...launch.args,
    'serve',
    '--no-owner',
    '--no-open',
    '--daemon',
    '--port',
    String(port),
  ];
  const env = { ...process.env, ...launch.env, OTEA_HOME: home };
  const logPath = prepareLog(home);
  let child: Starting;
  if (process.platform === 'win32') {
    try {
      child = await detachOnWindows(launch.command, args, env, logPath);
    } catch (error) {
      if (!(error instanceof HelperUnavailable)) {
        throw new Error(`Could not start otea serve: ${(error as Error).message}`);
      }
      warn(
        `${error.message}; started otea serve directly instead: a program reading this command's output may wait until the server ends`,
      );
      child = detach(launch.command, args, env, logPath);
    }
  } else {
    child = detach(launch.command, args, env, logPath);
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const state = await inspectServer(home);
    if (state.kind === 'running') return state;
    const failed = child.failed();
    if (failed) throw new Error(`Could not start otea serve: ${failed.message}`);
    // Ended without serving: it failed (the log says why).
    if (child.ended()) {
      await pause(POLL_MS);
      const other = await inspectServer(home);
      if (other.kind === 'running') return other;
      const said = logTail(home);
      throw new Error(`otea serve ended before it answered${said ? `:\n${said}` : ''}`);
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(
        `otea serve did not answer in ${START_TIMEOUT_MS / 1000} s; its log is ${join(home, SERVE_LOG)}`,
      );
    }
    await pause(POLL_MS);
  }
}

const LOCK_WAIT_MS = 90_000;
const LOCK_STALE_MS = 120_000;

// Runs `work` as the only start in this home: the lock file is made exclusively (wx), and one left
// by a process that ended, or by a start that took longer than any start can, is cleared.
async function withStartLock<T>(home: string, work: () => Promise<T>): Promise<T> {
  mkdirSync(home, { recursive: true });
  const path = join(home, START_LOCK);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(path, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let holder = 0;
      let age = 0;
      try {
        holder = Number.parseInt(readFileSync(path, 'utf8'), 10);
        age = Date.now() - statSync(path).mtimeMs;
      } catch {
        continue; // Released between the two reads.
      }
      if (!(holder > 0 && processAlive(holder)) || age > LOCK_STALE_MS) {
        rmSync(path, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Another otea serve start holds ${path}`);
      await pause(POLL_MS);
    }
  }
  try {
    return await work();
  } finally {
    rmSync(path, { force: true });
  }
}

// This home's server, started in the background when none runs. Two starts at once start one.
export async function ensureServer(
  home: string,
  options: StartOptions,
): Promise<{ state: Extract<ServerState, { kind: 'running' }>; started: boolean }> {
  return withStartLock(home, async () => {
    const state = await inspectServer(home);
    if (state.kind === 'running') return { state, started: false };
    if (state.kind === 'unresponsive') {
      throw new Error(
        `otea serve (pid ${state.info.pid}, port ${state.info.port}) is running but did not answer in time; wait, or end it with otea serve stop`,
      );
    }
    forgetStale(home, state);
    return { state: await startServer(home, options), started: true };
  });
}

const STOP_TIMEOUT_MS = 10_000;

async function kill(pid: number, home: string): Promise<void> {
  process.kill(pid);
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (processAlive(pid) && Date.now() < deadline) await pause(POLL_MS);
  if (processAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // It ended in between.
    }
    while (processAlive(pid) && Date.now() < deadline + STOP_TIMEOUT_MS) await pause(POLL_MS);
  }
  if (processAlive(pid)) throw new Error(`otea serve (pid ${pid}) did not end`);
  removeServeFile(home, pid);
}

// Ends the server by its process id once it is known to be this home's, and forgets its record (a
// killed server cannot: Windows ends it outright). A record of a process that is no server of this
// home is only forgotten: that process may be anything now, and is not touched. A process that is
// alive but did not answer is ended only when its command line is an otea serve; when the system
// cannot say, the record stays and nothing is ended.
export async function stopServer(
  home: string,
): Promise<{ stopped: ServeInfo } | { stale: ServeInfo } | undefined> {
  const state = await inspectServer(home);
  if (state.kind === 'none') return undefined;
  if (state.kind === 'stale') {
    forgetStale(home, state);
    return { stale: state.info };
  }
  if (state.kind === 'unresponsive') {
    const { info } = state;
    const line = processCommand(info.pid);
    if (line === undefined) {
      throw new Error(
        `otea serve (pid ${info.pid}) did not answer and the system did not say what that process is: nothing was ended and its record is kept; end it yourself if it is the server`,
      );
    }
    if (!isServeCommand(line)) {
      removeServeFile(home, info.pid);
      return { stale: info };
    }
    await kill(info.pid, home);
    return { stopped: info };
  }
  await kill(state.pid, home);
  return { stopped: { pid: state.pid, port: state.port } };
}
