import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliAt, removeOnceReleased, type TempRepo, tempGitRepo } from './testing.ts';
import { OTEA_VERSION } from './version.ts';

const home = () => process.env.OTEA_HOME ?? '';
const serveFile = () => join(home(), 'serve.json');

// A server keeps running after the package under it is upgraded: what a person is told about it.
describe('a server started by another version of Otea', () => {
  let repo: TempRepo;
  let interrupt: AbortController;

  const run = (...args: string[]) => cliAt(repo.dir, {}, interrupt.signal)(...args);

  // The server of this process, with serve.json as the version that started it wrote it.
  const serveAs = async (version: string | undefined) => {
    await run('serve', '--port', '0', '--no-open');
    const written = JSON.parse(readFileSync(serveFile(), 'utf8')) as Record<string, unknown>;
    writeFileSync(serveFile(), JSON.stringify({ ...written, version }));
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

  it('records the version that runs in serve.json', async () => {
    await run('serve', '--port', '0', '--no-open');

    expect(JSON.parse(readFileSync(serveFile(), 'utf8')).version).toBe(OTEA_VERSION);
  });

  it('says nothing of a version when the server is the installed one', async () => {
    await serveAs(OTEA_VERSION);

    const status = await run('serve', 'status');
    const start = await run('serve', 'start', '--no-open');

    expect(status.out).toContain(`Otea ${OTEA_VERSION}`);
    expect(status.out).not.toContain('serve stop');
    expect(start.out).not.toContain('serve stop');
  });

  describe.each([
    ['an older version', '0.0.1', 'Otea 0.0.1'],
    ['no version (0.4.0 wrote none)', undefined, 'an older Otea'],
  ])('with %s', (_name, version, said) => {
    const fix = `run otea serve stop, then otea serve start`;

    it('serve status names the running version and the commands to run', async () => {
      await serveAs(version);

      const { code, out } = await run('serve', 'status');

      expect(code).toBe(0);
      expect(out).toContain(said);
      expect(out).toContain(`${OTEA_VERSION} is installed`);
      expect(out).toContain(fix);
    });

    it('serve status --json says a restart is needed', async () => {
      await serveAs(version);

      const { out } = await run('serve', 'status', '--json');

      expect(JSON.parse(out)).toMatchObject({ running: true, restart: true });
    });

    it('serve start says so instead of only that it already runs', async () => {
      await serveAs(version);

      const { code, out } = await run('serve', 'start', '--no-open');

      expect(code).toBe(0);
      expect(out).toContain('already runs');
      expect(out).toContain(said);
      expect(out).toContain(fix);
    });

    it('start says so when it reuses the server', async () => {
      await serveAs(version);

      const { code, out } = await run('start', '--template', 'none', '--no-open');

      expect(code).toBe(0);
      expect(out).toContain(said);
      expect(out).toContain(fix);
    });

    it('open says so when it reuses the server', async () => {
      await serveAs(version);

      const { code, out } = await cliAt(repo.dir, {}, interrupt.signal, async () => {})('open');

      expect(code).toBe(0);
      expect(out).toContain('Opened Otea at');
      expect(out).toContain(said);
      expect(out).toContain(fix);
    });
  });
});
