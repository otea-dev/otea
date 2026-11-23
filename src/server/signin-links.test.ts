import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../app/project.ts';
import { createServer, type OteaServer } from './server.ts';
import {
  issueSignInLink,
  redeemSignInLink,
  SIGNIN_DIR,
  SIGNIN_LINK_LIFETIME_MS,
} from './signin-links.ts';
import { memoryProject, request, TOKEN } from './testing.ts';

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

  it('is used up by the first of two that redeem it together', () => {
    const link = issueSignInLink(home);

    const results = [redeemSignInLink(home, link), redeemSignInLink(home, link)];

    expect(results.filter(Boolean)).toHaveLength(1);
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
