import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.ts';
import { isNewer, UPDATE_OFF_ENV } from './update-notice.ts';
import { OTEA_VERSION } from './version.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('the notice of a newer otea', () => {
  let home: string;
  let calls: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'otea-notice-'));
    calls = [];
  });

  afterEach(() => rmSync(home, { recursive: true, force: true, maxRetries: 10 }));

  const registry =
    (answer: () => Promise<Response>): typeof fetch =>
    async (url) => {
      calls.push(String(url));
      return answer();
    };
  const latest = (version: string) => async () => Response.json({ version });

  // Runs `otea --version` as a person at a terminal would, with a registry stand-in.
  async function runOtea(
    fetcher: typeof fetch | undefined,
    { env = {}, terminal = true, argv = ['projects', 'list'] } = {},
  ) {
    let out = '';
    let err = '';
    const code = await run(argv, {
      cwd: home,
      env: { OTEA_HOME: home, ...env },
      signal: new AbortController().signal,
      openUrl: async () => {},
      stdout: { write: (chunk: string) => (out += chunk), isTTY: terminal },
      stderr: { write: (chunk: string) => (err += chunk) },
      ...(fetcher ? { fetch: fetcher } : {}),
    });
    return { code, out, err };
  }

  const cached = () => JSON.parse(readFileSync(join(home, 'update-check.json'), 'utf8'));

  it('prints one line when the registry has a newer version, and keeps the answer in the Otea home', async () => {
    const result = await runOtea(registry(latest('99.0.0')));

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      `otea: otea 99.0.0 is available (you have ${OTEA_VERSION}): npm i -g @otea/cli, or update the desktop app. Set ${UPDATE_OFF_ENV}=1 to stop this check.\n`,
    );
    expect(calls).toEqual(['https://registry.npmjs.org/@otea%2Fcli/latest']);
    expect(cached().latest).toBe('99.0.0');
  });

  it('says nothing when this is the latest, or newer', async () => {
    expect((await runOtea(registry(latest(OTEA_VERSION)))).err).toBe('');
    rmSync(join(home, 'update-check.json'));
    expect((await runOtea(registry(latest('0.0.1')))).err).toBe('');
  });

  it('asks the registry once a day, whatever the commands in between', async () => {
    await runOtea(registry(latest('99.0.0')));
    const again = await runOtea(registry(latest('99.0.0')));

    expect(calls).toHaveLength(1);
    expect(again.err).toBe('');

    writeFileSync(
      join(home, 'update-check.json'),
      JSON.stringify({ checkedAt: Date.now() - DAY - 1000, latest: '1.0.0' }),
    );
    const next = await runOtea(registry(latest('99.0.0')));
    expect(calls).toHaveLength(2);
    expect(next.err).toContain('99.0.0 is available');
  });

  it('is silent offline, and the command is unaffected', async () => {
    const offline = registry(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await runOtea(offline);

    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    // A failed try is tried again in an hour, not at every command.
    const retry = Date.now() - DAY + 60 * 60 * 1000;
    expect(Math.abs(cached().checkedAt - retry)).toBeLessThan(10_000);
  });

  it('does not wait for a registry that never answers', async () => {
    const hung = registry(
      () =>
        new Promise<Response>(() => {
          // Never settles: only the timeout the command waits for ends the wait.
        }),
    );
    const started = Date.now();

    const result = await runOtea(hung);

    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('ignores an answer that is not a version', async () => {
    expect((await runOtea(registry(async () => Response.json({ version: 'latest' })))).err).toBe(
      '',
    );
    rmSync(join(home, 'update-check.json'));
    expect((await runOtea(registry(async () => new Response('no', { status: 500 })))).err).toBe('');
  });

  it.each([
    ['turned off', { env: { [UPDATE_OFF_ENV]: '1' } }],
    ['in CI', { env: { CI: 'true' } }],
    ['under --json', { argv: ['projects', 'list', '--json'] }],
    ['with no terminal (a pipe, an agent, a hook)', { terminal: false }],
    ['for the MCP server', { argv: ['mcp', '--help'] }],
    ['for uninstall', { argv: ['uninstall', '--dry-run'] }],
    ['for an agent that gave --as', { argv: ['projects', 'list', '--as', 'bob'] }],
    ['for an agent named in OTEA_AGENT', { env: { OTEA_AGENT: 'bob' } }],
    ['for an agent named in OTEA_AS', { env: { OTEA_AS: 'bob' } }],
  ])('never asks the registry %s', async (_, options) => {
    const result = await runOtea(registry(latest('99.0.0')), options);

    expect(result.err).not.toContain('is available');
    expect(calls).toEqual([]);
    expect(existsSync(join(home, 'update-check.json'))).toBe(false);
  });

  it('never makes an Otea home that is not there', async () => {
    const missing = join(home, 'not-made');

    const result = await runOtea(registry(latest('99.0.0')), { env: { OTEA_HOME: missing } });

    expect(result.err).toContain('99.0.0 is available');
    expect(existsSync(missing)).toBe(false);
  });

  it('never asks where no fetch is given, as in every other test', async () => {
    expect((await runOtea(undefined)).err).toBe('');
    expect(existsSync(join(home, 'update-check.json'))).toBe(false);
  });

  it('compares plain versions only', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
    expect(isNewer('1.0.0-rc.1', '0.1.1')).toBe(false);
  });
});
