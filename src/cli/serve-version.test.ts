import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliAt, removeOnceReleased, type TempRepo, tempGitRepo } from './testing.ts';
import { OTEA_VERSION } from './version.ts';

const home = () => process.env.OTEA_HOME ?? '';
const serveFile = () => join(home(), 'serve.json');
const recorded = () => JSON.parse(readFileSync(serveFile(), 'utf8')) as Record<string, unknown>;

// What each owner of a server is told to do about it: only a background server of otea serve start
// is ended with otea serve stop. The desktop app's server is the app's, and a foreground one is a
// terminal's.
const STOP_START = 'run otea serve stop, then otea serve start';
const APP = 'update the app, or quit it and open it again';

// A server keeps running after the package under it is upgraded: what a person is told about it.
describe('a server started by another version of Otea', () => {
  let repo: TempRepo;
  let interrupt: AbortController;

  const run = (...args: string[]) => cliAt(repo.dir, {}, interrupt.signal)(...args);

  // The server of this process, with serve.json as the Otea that started it wrote it: an older one
  // writes no version, and 0.4.0 no owner either.
  const serveAs = async (version: string | undefined, owner?: string) => {
    await run('serve', '--port', '0', '--no-open');
    writeFileSync(serveFile(), JSON.stringify({ ...recorded(), version, owner }));
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    interrupt = new AbortController();
    await run('init', '--local');
  });

  afterEach(async () => {
    interrupt.abort();
    await removeOnceReleased(repo.dir);
  });

  it('records the version and who started the server in serve.json', async () => {
    await run('serve', '--port', '0', '--no-open');

    expect(recorded()).toMatchObject({ version: OTEA_VERSION, owner: 'foreground' });
  });

  it('records the desktop app as the owner of the server it starts', async () => {
    await run('serve', '--port', '0', '--no-open', '--json', '--served-by', 'desktop');

    expect(recorded()).toMatchObject({ owner: 'desktop' });
  });

  it('refuses a --served-by that is not the desktop app, and one together with --daemon', async () => {
    const other = await run('serve', '--port', '0', '--no-open', '--served-by', 'someone');
    const both = await run('serve', '--port', '0', '--daemon', '--served-by', 'desktop');

    expect(other.code).toBe(2);
    expect(both.code).toBe(2);
  });

  it('says nothing to do when the server is the installed one', async () => {
    await serveAs(OTEA_VERSION, 'daemon');

    const status = await run('serve', 'status');
    const start = await run('serve', 'start', '--no-open');

    expect(status.out).toContain(`Otea ${OTEA_VERSION}`);
    expect(status.out).not.toContain('serve stop');
    expect(start.out).not.toContain('serve stop');
  });

  // 0.4.0 wrote neither a version nor an owner: it may be the desktop app's or a background server,
  // so both ways are said, and the exact words are the contract.
  it('says what to do for a server that recorded no version and no owner, as 0.4.0 does', async () => {
    await serveAs(undefined, undefined);

    const { code, out } = await run('serve', 'status');

    expect(code).toBe(0);
    const [running, notice, rest] = out.split('\n');
    expect(running).toMatch(/^otea serve is running at http:\/\/127\.0\.0\.1:\d+ \(pid \d+, port \d+\)$/);
    expect(notice).toBe(
      `The server running here (pid ${process.pid}) is an older Otea (it recorded no version), and ${OTEA_VERSION} is installed: if the Otea desktop app started it, ${APP}; if otea serve start did, ${STOP_START}`,
    );
    expect(rest).toBe('');
  });

  describe.each([
    ['an older version', '0.0.1', 'Otea 0.0.1'],
    ['no version', undefined, 'an older Otea'],
  ])('with %s', (_name, version, said) => {
    describe('of a background server', () => {
      it('serve status names the running version and the commands to run', async () => {
        await serveAs(version, 'daemon');

        const { code, out } = await run('serve', 'status');

        expect(code).toBe(0);
        expect(out).toContain(said);
        expect(out).toContain(`${OTEA_VERSION} is installed: to use the installed one, ${STOP_START}`);
      });

      it('serve status --json says a restart is needed', async () => {
        await serveAs(version, 'daemon');

        const { out } = await run('serve', 'status', '--json');

        expect(JSON.parse(out)).toMatchObject({ running: true, restart: true });
      });

      it('serve start says so instead of only that it already runs', async () => {
        await serveAs(version, 'daemon');

        const { code, out } = await run('serve', 'start', '--no-open');

        expect(code).toBe(0);
        expect(out).toContain('already runs');
        expect(out).toContain(said);
        expect(out).toContain(STOP_START);
      });

      it('start says so when it reuses the server', async () => {
        await serveAs(version, 'daemon');

        const { code, out } = await run('start', '--template', 'none', '--no-open');

        expect(code).toBe(0);
        expect(out).toContain(said);
        expect(out).toContain(STOP_START);
      });

      it('open says so when it reuses the server', async () => {
        await serveAs(version, 'daemon');

        const { code, out } = await cliAt(repo.dir, {}, interrupt.signal, async () => {})('open');

        expect(code).toBe(0);
        expect(out).toContain('Opened Otea at');
        expect(out).toContain(said);
        expect(out).toContain(STOP_START);
      });

      it('open --no-open says so too, after the link', async () => {
        await serveAs(version, 'daemon');

        const { out } = await run('open', '--no-open');

        expect(out).toContain('Sign a browser in at');
        expect(out).toContain(said);
        expect(out).toContain(STOP_START);
      });
    });

    // Telling the app's user to run otea serve stop would end the app's server under its window.
    describe('of the desktop app', () => {
      it.each([
        ['serve status', ['serve', 'status']],
        ['serve start', ['serve', 'start', '--no-open']],
        ['start', ['start', '--template', 'none', '--no-open']],
        ['open --no-open', ['open', '--no-open']],
      ])('%s says to update or reopen the app, never to stop the server', async (_c, args) => {
        await serveAs(version, 'desktop');

        const { code, out } = await run(...args);

        expect(code).toBe(0);
        expect(out).toContain(said);
        expect(out).toContain(
          `${OTEA_VERSION} is installed: it is the Otea desktop app's, so ${APP}`,
        );
        expect(out).not.toContain('serve stop');
      });
    });

    describe('of a foreground otea serve', () => {
      it.each([
        ['serve status', ['serve', 'status']],
        ['serve start', ['serve', 'start', '--no-open']],
        ['start', ['start', '--template', 'none', '--no-open']],
        ['open --no-open', ['open', '--no-open']],
      ])('%s says to stop that otea serve and run it again, never otea serve stop', async (_c, args) => {
        await serveAs(version, 'foreground');

        const { code, out } = await run(...args);

        expect(code).toBe(0);
        expect(out).toContain(said);
        expect(out).toContain(
          `${OTEA_VERSION} is installed: it is an otea serve running in a terminal, so stop it there (Ctrl+C) and run otea serve again`,
        );
        expect(out).not.toContain('serve stop');
      });
    });
  });

  it('serve stop refuses the desktop app\'s server without --force, and leaves it running', async () => {
    await serveAs(OTEA_VERSION, 'desktop');

    const { code, err } = await run('serve', 'stop');

    expect(code).toBe(7);
    expect(err).toContain("belongs to the Otea desktop app");
    expect(err).toContain('--force');
    expect(recorded()).toMatchObject({ pid: process.pid });
  });
});
