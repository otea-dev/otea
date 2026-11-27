import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ownerGone, processAlive } from '../app/presence.ts';
import { STARTED_BY } from './started-by.ts';

// `command`: the command line, when the system says it (Windows does): npm and npx are node
// programs there, told from the harness only by it.
export type ProcessRow = {
  pid: number;
  parent: number;
  name: string;
  path?: string;
  command?: string;
};

// The programs that only run a command for someone else: a harness runs `otea` through them (its
// shell, npm's sh or cmd shim), and on Windows they outlive the harness that started them.
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish', 'cmd', 'powershell', 'pwsh']);

const isShell = (name: string) =>
  SHELLS.has(
    basename(name.replaceAll('\\', '/'))
      .toLowerCase()
      .replace(/\.exe$/, ''),
  );

// The processes a command started by `parent` belongs to: the parent, and while it is a shell the
// one that started it, up to the first that is none (the harness). Claude Code on Windows runs a
// command through bash and npm's sh shim; ending its session leaves both running, so watching the
// parent alone would never see the session end. `complete`: each parent in `rows` is the real one,
// so a shell whose parent is not listed outlived it (a session that ended before the listing), and
// that parent joins the chain as gone; otherwise a missing parent may be a shell's ended fork.
export function ownerChain(
  rows: readonly ProcessRow[],
  parent: number,
  complete = false,
): number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const chain = [parent];
  let row = byPid.get(parent);
  while (row && isShell(row.name)) {
    const next = byPid.get(row.parent);
    if (!next && complete && row.parent > 0 && !chain.includes(row.parent)) chain.push(row.parent);
    if (!next || chain.includes(next.pid)) break;
    chain.push(next.pid);
    row = next;
  }
  return chain;
}

// The programs that run another one for a moment and end with it (`timeout 600 otea wait`, `nohup`,
// npm's launcher): never the session, however far up they stand.
const WRAPPERS = new Set([
  'timeout',
  'nohup',
  'env',
  'time',
  'setsid',
  'stdbuf',
  'nice',
  'ionice',
  'sudo',
  'doas',
  'xargs',
  'npx',
  'npm',
  'pnpm',
  'yarn',
  'winpty',
]);

// The program a process runs, by its name: `npm exec otea` (a process title) is npm.
const programOf = (name: string) =>
  basename(name.replaceAll('\\', '/'))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '')
    .split(/\s+/)[0] as string;

// npm, npx, pnpm and yarn are node programs: node running their script is a wrapper too, however
// the system names the process.
const PACKAGE_RUNNER =
  /(?:^|[\\/\s"'])(?:npm-cli|npx-cli|npm|npx|pnpm|pnpm\.cjs|yarn)(?:\.c?js)?(?:["'\s]|$)/i;

function isWrapper(row: ProcessRow): boolean {
  const program = programOf(row.name);
  if (WRAPPERS.has(program)) return true;
  return program === 'node' && row.command !== undefined && PACKAGE_RUNNER.test(row.command);
}

// The harness session a command started by `start` runs under: the first process above it that is
// no shell and no wrapper, and so lasts as long as the session does. Undefined when the table does
// not reach one (a parent it does not list).
export function harnessOf(rows: readonly ProcessRow[], start: number): number | undefined {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  let row = byPid.get(start);
  while (row && !seen.has(row.pid)) {
    seen.add(row.pid);
    if (!SHELLS.has(programOf(row.name)) && !isWrapper(row)) return row.pid;
    row = byPid.get(row.parent);
  }
  return undefined;
}

// The agent harnesses Otea knows by name: a process that is one (or node running one) is the
// session itself, never an intermediary that ends with its command (bwrap, docker exec, ssh,
// wsl.exe, script). Its first find is trusted at once; an unknown process needs two waits.
const KNOWN_HARNESS = /^(claude|opencode|codex|agy|gemini|antigravity)(-[a-z]+)?$/;

const harnessWord = (token: string) =>
  KNOWN_HARNESS.test(
    basename(token.replaceAll('\\', '/'))
      .replace(/\.(exe|c?js|mjs|cmd)$/i, '')
      .toLowerCase(),
  );

// Whether the command line runs a known harness: its program (a bin called claude), or the script
// it runs (node .../claude-code/cli.js), never a word further on (`ssh host claude` is ssh). Some
// systems name a process by its thread, whatever it runs, so the name alone cannot say it.
function commandRunsHarness(command: string): boolean {
  const text = command.trim();
  const quoted = text.startsWith('"') ? text.indexOf('"', 1) : -1;
  const split = quoted > 0 ? quoted + 1 : text.search(/\s/);
  const program = (
    quoted > 0 ? text.slice(1, quoted) : text.slice(0, split < 0 ? undefined : split)
  ).trim();
  const args = split < 0 ? [] : text.slice(split).trim().split(/\s+/);
  let script: string | undefined;
  for (const arg of args) {
    // An inline script is no file to name a harness by.
    if (/^(-e|-p|-c|--eval|--print)$/.test(arg)) break;
    if (arg.startsWith('-')) continue;
    script = arg.replace(/^["']|["']$/g, '');
    break;
  }
  return harnessWord(program) || (script?.split(/[\\/]/).some(harnessWord) ?? false);
}

export function isKnownHarness(rows: readonly ProcessRow[], pid: number): boolean {
  const row = rows.find((each) => each.pid === pid);
  if (!row) return false;
  if (KNOWN_HARNESS.test(programOf(row.name))) return true;
  return row.command !== undefined && commandRunsHarness(row.command);
}

// Lines of "pid parent name", as both listings below print them; on Windows a tab and the program's
// file follow, when Windows says it.
export function readProcessTable(text: string): ProcessRow[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([^\t]+?)\s*(?:\t([^\t]*)(?:\t(.*?))?)?\s*$/.exec(line);
    if (!match) return [];
    const [, pid, parent, name, path, command] = match;
    const row: ProcessRow = { pid: Number(pid), parent: Number(parent), name: name as string };
    return [
      {
        ...row,
        ...(path?.trim() ? { path: path.trim() } : {}),
        ...(command?.trim() ? { command: command.trim() } : {}),
      },
    ];
  });
}

// The rows with the command line of each, from lines of "pid command line" (ps -o pid=,args=).
export function withCommands(rows: readonly ProcessRow[], text: string): ProcessRow[] {
  const commands = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) commands.set(Number(match[1]), match[2] as string);
  }
  return rows.map((row) => {
    const command = commands.get(row.pid);
    return command === undefined ? row : { ...row, command };
  });
}

// A process as Git Bash's MSYS lists it (its ps): its MSYS id, its MSYS parent's, and its Windows id.
export type PosixRow = { pid: number; parent: number; winpid: number };

export function readPosixTable(text: string): PosixRow[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+\d+\s+(\d+)\s/.exec(line);
    if (!match) return [];
    const [, pid, parent, winpid] = match;
    return [{ pid: Number(pid), parent: Number(parent), winpid: Number(winpid) }];
  });
}

// The Windows rows with each parent as MSYS knows it. Git Bash runs a command in a fork of itself
// that becomes the command and ends, so Windows names as parent a process long gone, while MSYS
// still links the command to the bash that forked it. A program that is no MSYS one (node) runs
// from MSYS with the shell left as its stub: Windows lists the stub as its parent, MSYS lists the
// program under the stub's id, so the stub's parent is the program's MSYS parent.
export function withPosixParents(
  rows: readonly ProcessRow[],
  posix: readonly PosixRow[],
): ProcessRow[] {
  const byPid = new Map(posix.map((row) => [row.pid, row]));
  const listed = new Set(posix.map((row) => row.winpid));
  const parents = new Map<number, number>();
  for (const row of posix) {
    const parent = row.parent > 1 ? byPid.get(row.parent) : undefined;
    if (parent) parents.set(row.winpid, parent.winpid);
  }
  for (const row of rows) {
    const parent = parents.get(row.pid);
    if (parent !== undefined && !listed.has(row.parent) && !parents.has(row.parent)) {
      parents.set(row.parent, parent);
    }
  }
  return rows.map((row) => {
    const parent = parents.get(row.pid);
    return parent === undefined || parent === row.parent ? row : { ...row, parent };
  });
}

const WINDOWS_LISTING =
  "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)`t$($_.ExecutablePath)`t$(($_.CommandLine -replace '[\\t\\r\\n]+', ' '))\" }";

// The busy Windows runner answered WMI after 20 s; the owner check waits for it in the background.
const LISTING_TIMEOUT_MS = 60_000;

// A listing with the command line of every process runs past execFile's default 1 MB on a busy
// Windows machine.
const LISTING_MAX_BYTES = 16 * 1024 * 1024;

// What a program prints, or undefined when it cannot be read; `warn` is told why, once (an aborted
// listing, one nobody waits for any more, is no trouble).
export function readListing(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  warn: (line: string) => void = warnListing,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      args as string[],
      // From the temp folder: on Windows a process holds the folder it runs in, and the listing
      // may outlive this command for a moment; it must never keep the project's folder busy.
      {
        cwd: tmpdir(),
        encoding: 'utf8',
        timeout: LISTING_TIMEOUT_MS,
        windowsHide: true,
        signal,
        maxBuffer: LISTING_MAX_BYTES,
      },
      (error, stdout) => {
        if (error && !signal.aborted) {
          warn(
            `Otea could not read the process table (${basename(command)}: ${error.message.split('\n')[0]}): it cannot tell when this agent's session ends`,
          );
        }
        resolve(error ? undefined : stdout);
      },
    );
  });
}

const warnListing = (line: string) => process.stderr.write(`${line}\n`);

const run = readListing;

// The ps of the MSYS that runs `start` (Git Bash's usr/bin, next to its sh.exe), if it is one.
function posixLister(rows: readonly ProcessRow[], start: number): string | undefined {
  const path = rows.find((row) => row.pid === start)?.path;
  if (!path || !isShell(path)) return undefined;
  const ps = join(dirname(path), 'ps.exe');
  return existsSync(ps) ? ps : undefined;
}

// The processes, and whether each parent there is the real one (ownerChain's `complete`).
export type ProcessTable = { rows: ProcessRow[]; complete: boolean };

// Every process on this computer with its parent, or undefined when the system does not say. On
// Windows, a command `start` runs through Git Bash gets its parents from MSYS (withPosixParents);
// without MSYS's table, a parent Windows names may be a shell's fork that ended.
export async function listProcesses(
  signal: AbortSignal,
  start: number = STARTED_BY,
): Promise<ProcessTable | undefined> {
  if (process.platform !== 'win32') {
    const out = await run('ps', ['-A', '-o', 'pid=,ppid=,comm='], signal);
    if (out === undefined) return undefined;
    // The program alone says `node` for Claude Code: its command line, from a second listing,
    // tells it from any node (isKnownHarness). Without it the rows are still good.
    const commands = await run('ps', ['-A', '-o', 'pid=,args='], signal, () => {});
    const rows = readProcessTable(out);
    return { rows: commands === undefined ? rows : withCommands(rows, commands), complete: true };
  }
  const out = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LISTING],
    signal,
  );
  if (out === undefined) return undefined;
  const rows = readProcessTable(out);
  const ps = posixLister(rows, start);
  const posix = ps === undefined ? undefined : await run(ps, [], signal);
  return posix === undefined
    ? { rows, complete: false }
    : { rows: withPosixParents(rows, readPosixTable(posix)), complete: true };
}

// How often a long-running command checks that the processes that started it still run.
const OWNER_CHECK_MS = 5_000;

// `started`: the process that started this one, which the watch stops it with.
export type OwnerWatch = {
  signal: AbortSignal;
  orphaned: () => boolean;
  stop: () => void;
  started: number;
  // The harness session it runs under (harnessOf), once the processes were listed; undefined when
  // they could not be, or the watch stopped first.
  harness: Promise<number | undefined>;
  // Whether that process is a harness known by name (isKnownHarness); false while unknown.
  harnessKnown: Promise<boolean>;
  // Ends an early listing still running (a watch started with `early` leaves it to its caller).
  release: () => void;
};

// Aborts `signal` once the session that started this process is gone (ownerGone), on `parent` (the
// command's interrupt): left running, a wait would keep its agent shown as listening until its
// timeout, and a server would keep serving no one. The shells above it are read on the first
// check, so a command that ends at once never lists the processes.
export function watchOwner(
  parent: AbortSignal,
  {
    list = listProcesses,
    alive = processAlive,
    everyMs = OWNER_CHECK_MS,
    early = false,
  }: {
    list?: (signal: AbortSignal) => Promise<ProcessTable | undefined>;
    alive?: (pid: number) => boolean;
    everyMs?: number;
    // List the processes at once, not on the first check: for a command that must know its
    // session soon (the secretary's wait), at the cost of one listing even when it ends at once.
    early?: boolean;
  } = {},
): OwnerWatch {
  // The parent the process started under, not the one it has when this runs: a shell that ended
  // while the command loaded has left the system's own process in its place.
  const start = STARTED_BY;
  const controller = new AbortController();
  const listing = new AbortController();
  let chain = [start];
  let listed = false;
  let orphaned = false;
  const onAbort = () => controller.abort();
  parent.addEventListener('abort', onAbort, { once: true });
  const harness = Promise.withResolvers<number | undefined>();
  const known = Promise.withResolvers<boolean>();
  const look = () => {
    if (listed) return;
    listed = true;
    void list(listing.signal).then((table) => {
      if (table) chain = ownerChain(table.rows, start, table.complete);
      const pid = table ? harnessOf(table.rows, start) : undefined;
      harness.resolve(pid);
      known.resolve(table !== undefined && pid !== undefined && isKnownHarness(table.rows, pid));
    });
  };
  const timer = setInterval(() => {
    if (ownerGone(start, process.ppid, alive, chain)) {
      orphaned = true;
      controller.abort();
      return;
    }
    look();
  }, everyMs);
  timer.unref();
  // Lets the listing go: nothing waits for the harness any more.
  const release = () => {
    listing.abort();
    harness.resolve(undefined);
    known.resolve(false);
  };
  const stop = () => {
    clearInterval(timer);
    parent.removeEventListener('abort', onAbort);
    // A listing started early outlives the watch until its caller has what it needs (release).
    if (!early || listed === false) release();
  };
  // Once stopped for any reason it lists nothing more, so a listing never keeps the process alive.
  controller.signal.addEventListener('abort', stop, { once: true });
  if (early) look();
  return {
    signal: controller.signal,
    orphaned: () => orphaned,
    stop,
    started: start,
    harness: harness.promise,
    harnessKnown: known.promise,
    release,
  };
}
