import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processAlive } from '../app/presence.ts';
import { readUiToken } from '../server/token.ts';
import { probeSignIn } from './probe.ts';
import { readServeFile, removeServeFile, type ServeInfo } from './serve-file.ts';

// What the background server prints (its stdout and stderr), kept in the Otea home beside serve.json.
export const SERVE_LOG = 'serve.log';

export type ServerState =
  // Alive, and it answers with this Otea home's key.
  | { kind: 'running'; pid: number; port: number; url: string; token: string }
  // serve.json names a process that ended, or one that is no server of this home (a process id
  // another program took, or a server of another home on that port): nothing to stop.
  | { kind: 'stale'; info: ServeInfo; ended: boolean }
  | { kind: 'none' };

// Whether this Otea home's server runs, from the record it keeps in the home (serve.json) and a
// sign-in probe: a process id alone proves nothing, one that ended may belong to anything by now.
export async function inspectServer(home: string): Promise<ServerState> {
  const info = readServeFile(home);
  if (!info) return { kind: 'none' };
  const token = readUiToken(home);
  if (!processAlive(info.pid)) return { kind: 'stale', info, ended: true };
  if (!token) return { kind: 'stale', info, ended: false };
  const url = `http://127.0.0.1:${info.port}`;
  const probe = await probeSignIn(`${url}/auth?token=${encodeURIComponent(token)}`);
  if (probe !== 'ours') return { kind: 'stale', info, ended: false };
  return { kind: 'running', pid: info.pid, port: info.port, url, token };
}

// Forgets the record of a server that is gone, as the server itself does when it ends.
export function forgetStale(home: string, state: ServerState): void {
  if (state.kind === 'stale') removeServeFile(home, state.info.pid);
}

// How the background server starts: Node (or the desktop app's Electron) on Otea's own main.
export type Launch = {
  command: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
};

export type StartOptions = { port: number; lan: boolean; launch: Launch };

const POLL_MS = 100;
// A cold start on Windows takes several seconds before the server answers.
const START_TIMEOUT_MS = 30_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function logTail(home: string): string {
  try {
    return readFileSync(join(home, SERVE_LOG), 'utf8').trim().split(/\r?\n/).slice(-5).join('\n');
  } catch {
    return '';
  }
}

// Starts otea serve on its own, detached from the shell that ran this (a new session on
// Linux and macOS, a process of its own without a window on Windows), and resolves once it answers.
// It watches no owner: it keeps serving after the terminal or the agent's session that started it
// is gone, until `stopServer`. Its output goes to the log in the home. Fails with the log's last
// lines when it ends before it answers.
export async function startServer(
  home: string,
  { port, lan, launch }: StartOptions,
): Promise<Extract<ServerState, { kind: 'running' }>> {
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, SERVE_LOG), 'w');
  const args = [
    ...launch.args,
    'serve',
    '--no-owner',
    '--no-open',
    '--port',
    String(port),
    ...(lan ? ['--lan'] : []),
  ];
  let ended: number | null | undefined;
  let failed: Error | undefined;
  const child = spawn(launch.command, args, {
    // Never from a project's folder: Windows would keep it busy for as long as the server runs.
    cwd: tmpdir(),
    env: { ...process.env, ...launch.env, OTEA_HOME: home },
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  closeSync(log);
  child.on('error', (error) => {
    failed = error;
  });
  child.on('exit', (code) => {
    ended = code;
  });
  child.unref();
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const state = await inspectServer(home);
    if (state.kind === 'running') return state;
    if (failed) throw new Error(`Could not start otea serve: ${failed.message}`);
    // Ended without serving: another start may have won (it answers by now), or it failed.
    if (ended !== undefined) {
      await pause(POLL_MS);
      const other = await inspectServer(home);
      if (other.kind === 'running') return other;
      const said = logTail(home);
      throw new Error(
        `otea serve ended before it answered (exit ${ended})${said ? `:\n${said}` : ''}`,
      );
    }
    if (Date.now() > deadline) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
      throw new Error(
        `otea serve did not answer in ${START_TIMEOUT_MS / 1000} s; its log is ${join(home, SERVE_LOG)}`,
      );
    }
    await pause(POLL_MS);
  }
}

const STOP_TIMEOUT_MS = 10_000;

// Ends the server by its process id once it is known to be this home's, and forgets its record (a
// killed server cannot: Windows ends it outright). A record of a process that is no server of this
// home is only forgotten: that process may be anything now, and is not touched.
export async function stopServer(
  home: string,
): Promise<{ stopped: ServeInfo } | { stale: ServeInfo } | undefined> {
  const state = await inspectServer(home);
  if (state.kind === 'none') return undefined;
  if (state.kind === 'stale') {
    forgetStale(home, state);
    return { stale: state.info };
  }
  const { pid, port } = state;
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
  return { stopped: { pid, port } };
}
