import { type ChildProcess, spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../app/project.ts';
import { createServer, type OteaServer } from './server.ts';
import {
  issueSignInLink,
  redeemSignInLink,
  SIGNIN_DIR,
  SIGNIN_LINK_LIFETIME_MS,
} from './signin-links.ts';
import { memoryProject, request, TOKEN } from './testing.ts';

// Wraps rmSync so a test can make one remove fail the way Windows does (EBUSY); it runs as the real
// one otherwise.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

// P3-F5: what a command prints for a person to open by hand is worth one sign-in, not the key.
describe('single-use sign-in links', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'otea-signin-'));
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('works once', () => {
    const link = issueSignInLink(home);

    expect(link).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redeemSignInLink(home, link)).toBe(true);
    expect(redeemSignInLink(home, link)).toBe(false);
  });

  it('signs in the winner, and burns the link, when removing the link file is refused', () => {
    const link = issueSignInLink(home);
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    });

    expect(redeemSignInLink(home, link)).toBe(true);
    expect(redeemSignInLink(home, link)).toBe(false);
  });

  it('works within its lifetime and not after it', () => {
    const now = Date.now();
    const link = issueSignInLink(home, now);

    expect(redeemSignInLink(home, link, now + SIGNIN_LINK_LIFETIME_MS + 1)).toBe(false);
    const fresh = issueSignInLink(home, now);
    expect(redeemSignInLink(home, fresh, now + SIGNIN_LINK_LIFETIME_MS - 1000)).toBe(true);
  });

  it('is no link when it was never issued, or is not a token', () => {
    issueSignInLink(home);

    expect(redeemSignInLink(home, 'x'.repeat(43))).toBe(false);
    expect(redeemSignInLink(home, '../../ui-token')).toBe(false);
    expect(redeemSignInLink(home, '')).toBe(false);
  });

  it('keeps only a hash of the link on disk, and clears the ones that ended', () => {
    const now = Date.now();
    const old = issueSignInLink(home, now);
    const link = issueSignInLink(home, now + 2 * SIGNIN_LINK_LIFETIME_MS);

    const names = readdirSync(join(home, SIGNIN_DIR));
    expect(names).toHaveLength(1);
    expect(names).not.toContain(old);
    expect(names).not.toContain(link);
    expect(readFileSync(join(home, SIGNIN_DIR, names[0] ?? ''), 'utf8')).not.toContain(link);
  });

  // Real processes, released together: the files of two redeems race, and one wins.
  it('is used up by exactly one of several processes that redeem it at the same moment', async () => {
    const link = issueSignInLink(home);
    const go = join(home, 'go');
    const script = [
      "const fs = require('node:fs');",
      'const [module, home, link, go] = process.argv.slice(1);',
      'const until = Date.now() + 20000;',
      'while (!fs.existsSync(go) && Date.now() < until) {}',
      'import(module).then((m) => console.log(m.redeemSignInLink(home, link)));',
    ].join(' ');
    const children = Array.from({ length: 6 }, () => {
      const child = spawn(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '-e',
          script,
          new URL('./signin-links.ts', import.meta.url).href,
          home,
          link,
          go,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += String(chunk);
      });
      return new Promise<string>((resolve) => child.on('close', () => resolve(out.trim())));
    });
    // Every child is up and spinning; then they go.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    writeFileSync(go, '');

    const results = await Promise.all(children);

    expect(results.filter((result) => result === 'true')).toHaveLength(1);
    expect(results.filter((result) => result === 'false')).toHaveLength(5);
  }, 60_000);

  // The one-moment test above passes by luck on most runs: two processes have to read before either
  // removes. The same race, run round after round by processes that stay up, shows it every time.
  it('is used up by exactly one process in every one of many rounds of simultaneous redeems', async () => {
    const rounds = 150;
    const processes = 4;
    const links = Array.from({ length: rounds }, () => issueSignInLink(home));
    writeFileSync(join(home, 'links'), links.join('\n'));
    const script = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const [module, home, go] = process.argv.slice(1);',
      "const links = fs.readFileSync(path.join(home, 'links'), 'utf8').split('\\n');",
      'import(module).then((m) => {',
      "  console.log('ready');",
      '  links.forEach((link, round) => {',
      // A short sleep between looks: a busy loop starves the parent on a runner with two cores.
      '    while (!fs.existsSync(path.join(go, String(round))))',
      '      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);',
      '    console.log(m.redeemSignInLink(home, link));',
      '  });',
      '});',
    ].join(' ');
    const go = join(home, 'rounds');
    mkdirSync(go);
    const lines: string[][] = [];
    const crashed: string[] = [];
    const spawned: ChildProcess[] = [];
    const children = Array.from({ length: processes }, (_, index) => {
      lines[index] = [];
      const child = spawn(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '-e',
          script,
          new URL('./signin-links.ts', import.meta.url).href,
          home,
          go,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      spawned.push(child);
      let pending = '';
      child.stdout.on('data', (chunk) => {
        const parts = (pending + String(chunk)).split('\n');
        pending = parts.pop() ?? '';
        lines[index]?.push(...parts.map((part) => part.trim()));
      });
      return new Promise<void>((resolve) =>
        child.on('close', (code) => {
          if (lines[index]?.length !== rounds + 1) crashed.push(`child ${index} exited (${code})`);
          resolve();
        }),
      );
    });
    const everyone = (count: number) => lines.every((own) => own.length >= count);
    // Waits for a round to be answered, and fails at once when a child died before its last round
    // instead of waiting out the cap.
    const until = async (done: () => boolean) => {
      const limit = Date.now() + 45_000;
      while (!done() && Date.now() < limit) {
        if (crashed.length > 0) throw new Error(crashed.join('; '));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    try {
      await until(() => everyone(1));
      for (let round = 0; round < rounds; round += 1) {
        writeFileSync(join(go, String(round)), '');
        await until(() => everyone(round + 2));
      }
    } catch (error) {
      for (const child of spawned) child.kill();
      throw error;
    }
    await Promise.all(children);

    const wins = Array.from(
      { length: rounds },
      (_, round) => lines.filter((own) => own[round + 1] === 'true').length,
    );
    expect(wins.filter((count) => count !== 1)).toEqual([]);
  }, 90_000);

  it('does not clear a link another process is still writing, and survives a missing folder', () => {
    // issuing the first link finds no folder yet, and no error comes of sweeping it.
    expect(() => issueSignInLink(home)).not.toThrow();
    const folder = join(home, SIGNIN_DIR);
    writeFileSync(join(folder, 'writing'), '');
    issueSignInLink(home);
    expect(readdirSync(folder)).toContain('writing');
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(folder, 'writing'), old, old);
    issueSignInLink(home);
    expect(readdirSync(folder)).not.toContain('writing');
  });

  describe('as GET /auth takes it', () => {
    let project: Project;
    let server: OteaServer;

    beforeEach(() => {
      project = memoryProject();
      server = createServer(project, {
        token: TOKEN,
        redeemSignInLink: (given) => redeemSignInLink(home, given),
      });
    });

    afterEach(() => {
      server.close();
      project.db.close();
    });

    it('signs in once, with the same session the key gives, and never again', async () => {
      const link = issueSignInLink(home);

      const first = await request(server, `/auth?token=${link}`);
      expect(first.status).toBe(302);
      expect(first.headers.get('set-cookie')).toBe(
        `otea_session_4400=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
      );
      const second = await request(server, `/auth?token=${link}`);
      expect(second.status).toBe(401);
      expect(second.headers.get('set-cookie')).toBeNull();
    });

    it('still takes the key, which is what otea open and the desktop app use', async () => {
      expect((await request(server, `/auth?token=${TOKEN}`)).status).toBe(302);
      expect((await request(server, `/auth?token=${TOKEN}`)).status).toBe(302);
    });
  });
});
