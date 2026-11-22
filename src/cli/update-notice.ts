import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The one line otea prints when npm has a newer @otea/cli, at most once a day. It never gets in the
// way: it is asked of the registry while the command runs, waits no longer than the timeout below
// for the answer, and says nothing when it cannot get one (offline, a slow network, a registry
// that answers oddly).

export const UPDATE_OFF_ENV = 'OTEA_NO_UPDATE_CHECK';

const REGISTRY_URL = 'https://registry.npmjs.org/@otea%2Fcli/latest';
const CACHE_FILE = 'update-check.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// How long the registry has to answer; the command itself never waits longer for it.
export const UPDATE_TIMEOUT_MS = 1200;

// Commands that run for a long time, or that a hook, an agent's server or a follower reads: never a
// place for a notice.
const QUIET_COMMANDS = new Set(['mcp', 'check', 'serve', 'wait', 'events', 'uninstall']);

type Cache = { checkedAt: number; latest?: string };

export type UpdateCheck = {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  // The version running now.
  version: string;
  fetch: typeof fetch;
  now?: () => number;
  // The command's name (`serve start`), or none for help and errors.
  command?: string | undefined;
  json: boolean;
  // Whether a person reads the output at a terminal.
  terminal: boolean;
  // Whether an agent runs the command (--as, or OTEA_AGENT / OTEA_AS in its environment): a model
  // reads an agent's output, which an update line has no business in.
  agent?: boolean;
};

function readCache(home: string): Cache | undefined {
  try {
    const cache: unknown = JSON.parse(readFileSync(join(home, CACHE_FILE), 'utf8'));
    if (cache === null || typeof cache !== 'object') return undefined;
    const { checkedAt, latest } = cache as Record<string, unknown>;
    if (typeof checkedAt !== 'number') return undefined;
    return typeof latest === 'string' ? { checkedAt, latest } : { checkedAt };
  } catch {
    return undefined;
  }
}

// Never makes the Otea home: a computer that has none (or whose home an uninstall just deleted) is
// left without one.
function writeCache(home: string, cache: Cache): void {
  try {
    if (!existsSync(home)) return;
    writeFileSync(join(home, CACHE_FILE), `${JSON.stringify(cache)}\n`);
  } catch {
    // A home that cannot be written only means the check runs again next time.
  }
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

// Whether `latest` is a later release than `current`; false when either is not a plain x.y.z.
export function isNewer(latest: string, current: string): boolean {
  const a = VERSION.exec(latest);
  const b = VERSION.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (x !== y) return x > y;
  }
  return false;
}

// Whether this run may look at all: a person at a terminal, not CI, not --json, not turned off, not
// the desktop app (it updates itself), and a command that is no server or hook.
function allowed({ env, json, terminal, command, agent }: UpdateCheck): boolean {
  if (agent || env.OTEA_AGENT || env.OTEA_AS) return false;
  const off = env[UPDATE_OFF_ENV];
  if (off !== undefined && off !== '' && off !== '0') return false;
  if (env.CI !== undefined && env.CI !== '' && env.CI !== '0' && env.CI !== 'false') return false;
  if (json || !terminal) return false;
  if (process.versions.electron !== undefined) return false;
  const first = command?.split(' ')[0];
  return first !== undefined && !QUIET_COMMANDS.has(first);
}

// Starts the check when it is due, and resolves with the line to print, or nothing: never rejects.
// A check that is not due (a day has not passed) costs nothing and says nothing.
export function startUpdateCheck(check: UpdateCheck): Promise<string | undefined> {
  if (!allowed(check)) return Promise.resolve(undefined);
  const now = (check.now ?? Date.now)();
  const cached = readCache(check.home);
  if (cached !== undefined && now - cached.checkedAt < DAY_MS) return Promise.resolve(undefined);
  return ask(check, now, cached?.latest).catch(() => undefined);
}

async function ask(check: UpdateCheck, now: number, before: string | undefined) {
  // A try that fails (offline, too slow) is tried again in an hour, not at every command.
  const failed = { checkedAt: now - DAY_MS + HOUR_MS, ...(before ? { latest: before } : {}) };
  try {
    const response = await check.fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      writeCache(check.home, failed);
      return undefined;
    }
    const body: unknown = await response.json();
    const latest = (body as { version?: unknown } | null)?.version;
    if (typeof latest !== 'string' || !VERSION.test(latest)) {
      writeCache(check.home, failed);
      return undefined;
    }
    writeCache(check.home, { checkedAt: now, latest });
    if (!isNewer(latest, check.version)) return undefined;
    return `otea ${latest} is available (you have ${check.version}): npm i -g @otea/cli, or update the desktop app. Set ${UPDATE_OFF_ENV}=1 to stop this check.`;
  } catch {
    writeCache(check.home, failed);
    return undefined;
  }
}

// Waits for the line, no longer than the check itself is allowed.
export async function updateLine(
  pending: Promise<string | undefined>,
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), UPDATE_TIMEOUT_MS + 100);
    timer.unref();
  });
  try {
    return await Promise.race([pending, wait]);
  } finally {
    clearTimeout(timer);
  }
}
