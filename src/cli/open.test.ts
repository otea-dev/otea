import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen } from '../server/listen.ts';
import { createServer } from '../server/server.ts';
import { memoryProject } from '../server/testing.ts';
import { type Cli, cliAt, removeOnceReleased, type TempRepo, tempGitRepo } from './testing.ts';

// The first line; --no-open adds how to sign a browser in after it.
const URL_LINE = /^Otea running at (http:\/\/127\.0\.0\.1:(\d+))\/p\/([a-z0-9-]+)\/\n/;

const home = () => process.env.OTEA_HOME ?? '';

describe('open', () => {
  let repo: TempRepo;
  let interrupt: AbortController;
  let opened: string[];
  let otea: Cli;

  // One server per Otea home: its key and where it runs are in the home.
  const token = () => readFileSync(join(home(), 'ui-token'), 'utf8').trim();
  const serveFile = () => join(home(), 'serve.json');
  const serve = async (cwd = repo.dir) => {
    const { out } = await cliAt(cwd, {}, interrupt.signal)('serve', '--port', '0', '--no-open');
    const [, origin = '', port = '', id = ''] = URL_LINE.exec(out) ?? [];
    return { origin, port, id, page: `${origin}/p/${id}/` };
  };
  const signIn = (origin: string, next: string) =>
    `${origin}/auth?token=${token()}&next=${encodeURIComponent(next)}`;

  beforeEach(async () => {
    repo = tempGitRepo();
    interrupt = new AbortController();
    opened = [];
    otea = cliAt(repo.dir, {}, interrupt.signal, async (url) => {
      opened.push(url);
    });
    await otea('init', '--local');
  });

  afterEach(async () => {
    interrupt.abort();
    await removeOnceReleased(repo.dir);
  });

  it("opens this project's page signed in to the running server without printing the token", async () => {
    const { origin, id, page } = await serve();

    const { code, out, err } = await otea('open');

    expect(code).toBe(0);
    expect(out).toBe(`Opened Otea at ${page}\n`);
    expect(opened).toEqual([signIn(origin, `/p/${id}/`)]);
    expect(out + err).not.toContain(token());
  });

  // P8-F4: the signed-out page sends to otea open, which could only open a browser: headless and
  // remote work had no way to a fresh link.
  it('prints a fresh single-use sign-in link with --no-open, opening no browser, never the key', async () => {
    const { origin, id } = await serve();

    const first = await otea('open', '--no-open');
    const second = await otea('open', '--no-open');

    expect(first.code).toBe(0);
    expect(first.out).toMatch(
      new RegExp(
        `^Sign a browser in at (${origin}/auth\\?token=[A-Za-z0-9_-]{43}&next=${encodeURIComponent(`/p/${id}/`)}) \\(works once, within 10 minutes; run the command again for another\\)\\n$`,
      ),
    );
    expect(opened).toEqual([]);
    expect(first.out + first.err).not.toContain(token());
    const link = (text: string) => /at (\S+) \(/.exec(text)?.[1];
    expect(link(second.out)).not.toBe(link(first.out));
    const redeemed = await fetch(link(first.out) ?? '', { redirect: 'manual' });
    expect(redeemed.status).toBe(302);
    expect(redeemed.headers.get('set-cookie')).toContain('otea_session_');
  });

  // The link signs one browser in: used once, it signs no other in, and a second one still works.
  it('prints links that each sign in once', async () => {
    await serve();
    const link = (text: string) => /at (\S+) \(/.exec(text)?.[1] ?? '';
    const first = link((await otea('open', '--no-open')).out);
    const second = link((await otea('open', '--no-open')).out);

    const used = await fetch(first, { redirect: 'manual' });
    const again = await fetch(first, { redirect: 'manual' });
    const other = await fetch(second, { redirect: 'manual' });

    expect(used.headers.get('set-cookie')).toContain('otea_session_');
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(again.status).not.toBe(302);
    expect(other.headers.get('set-cookie')).toContain('otea_session_');
  });

  it('prints no link and no key with --no-open --json', async () => {
    const { page } = await serve();

    const { code, out, err } = await otea('open', '--no-open', '--json');

    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ url: page });
    expect(out + err).not.toContain('token=');
    expect(out + err).not.toContain('/auth');
    expect(out + err).not.toContain(token());
    expect(opened).toEqual([]);
  });

  it('says to run serve with --no-open when no server answers', async () => {
    const { port } = await serve();
    interrupt.abort();
    await vi.waitFor(() =>
      expect(otea('open', '--no-open', '--port', port)).resolves.toMatchObject({ code: 11 }),
    );

    const { err } = await otea('open', '--no-open', '--port', port);

    expect(err).toContain(`No Otea server answers on port ${port}; run "otea serve start"`);
  });

  // A server an older Otea started cannot redeem a single-use link: no link, and no success.
  it('fails with --no-open for a server that cannot redeem a single-use link', async () => {
    const { port } = await serve();
    const running = JSON.parse(readFileSync(serveFile(), 'utf8'));
    writeFileSync(serveFile(), JSON.stringify({ port: running.port, pid: running.pid }));

    const { code, out, err } = await otea('open', '--no-open', '--port', port);

    expect(code).toBe(11);
    expect(out).toBe('');
    expect(err).toContain('is from an older Otea and cannot take single-use links');
    expect(err).toContain('otea serve stop, then otea serve start');
    expect(err).not.toContain('signs a browser in meanwhile');
    expect(err).not.toContain(token());
    expect(opened).toEqual([]);
  });

  it('prints the url with --json', async () => {
    const { page } = await serve();

    expect(JSON.parse((await otea('open', '--json')).out)).toEqual({ url: page });
  });

  it('uses --port when serve.json is missing', async () => {
    const { origin, port, id } = await serve();
    rmSync(serveFile());

    const { code } = await otea('open', '--port', port);

    expect(code).toBe(0);
    expect(opened).toEqual([signIn(origin, `/p/${id}/`)]);
  });

  it('opens the home page of the server outside any project', async () => {
    const { origin } = await serve();
    const elsewhere = tempGitRepo();
    try {
      const outside = cliAt(elsewhere.dir, {}, interrupt.signal, async (url) => {
        opened.push(url);
      });
      const { code, out } = await outside('open');
      expect(code).toBe(0);
      expect(out).toBe(`Opened Otea at ${origin}/\n`);
      expect(opened).toEqual([signIn(origin, '/')]);
    } finally {
      elsewhere.remove();
    }
  });

  it('tells to run serve when the recorded server is gone', async () => {
    const { port } = await serve();
    interrupt.abort();
    await vi.waitFor(() =>
      expect(otea('open', '--port', port)).resolves.toMatchObject({ code: 11 }),
    );
    writeFileSync(serveFile(), JSON.stringify({ port: Number(port), pid: 1 }));

    const { code, err } = await otea('open');

    expect(code).toBe(11);
    expect(err).toContain(`No Otea server answers on port ${port}; run "otea serve start"`);
    expect(err).not.toContain(token());
    expect(opened).toEqual([]);
  });

  it('refuses a server that belongs to another Otea home', async () => {
    await serve();
    const project = memoryProject();
    const other = await listen(
      createServer(project, { token: 'another-home-0123456789abcdefghijklmnopq' }),
      0,
    );
    try {
      const { code, err } = await otea('open', '--port', String(other.port));

      expect(code).toBe(11);
      expect(err).toContain(`The Otea server on port ${other.port} is another Otea home's`);
      expect(opened).toEqual([]);
    } finally {
      await other.close();
      project.db.close();
    }
  });

  it('fails when no browser can be opened', async () => {
    await serve();
    const failing = cliAt(repo.dir, {}, interrupt.signal, () => Promise.reject(new Error('nope')));

    const { code, err } = await failing('open');

    expect(code).toBe(1);
    expect(err).toContain('Could not open a browser (nope)');
  });
});
