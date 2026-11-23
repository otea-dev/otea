import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A sign-in link a command prints for a person (or the agent that relays it) when it does not open a
// browser itself: it works once, for ten minutes, and is worth nothing after that. The long-lived
// key (ui-token) stays in the Otea home; it is never what a transcript or a log keeps.
//
// The command and the server are two processes of one Otea home, so a link is a file there: named by
// the hash of its token (a stolen directory listing is no link), holding when it ends.
export const SIGNIN_DIR = 'signin-links';
export const SIGNIN_LINK_LIFETIME_MS = 10 * 60 * 1000;

const LINK_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const fileOf = (home: string, link: string) =>
  join(home, SIGNIN_DIR, createHash('sha256').update(link).digest('hex'));

// Links that ended, or that nobody redeemed for a day, are cleared as a new one is issued.
function sweep(home: string, now: number): void {
  const dir = join(home, SIGNIN_DIR);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      const endsAt = Number(readFileSync(path, 'utf8'));
      if (!(endsAt > now) || statSync(path).mtimeMs < now - 24 * 60 * 60 * 1000) {
        rmSync(path, { force: true });
      }
    } catch {
      // Redeemed or swept by another process in between.
    }
  }
}

export function issueSignInLink(home: string, now = Date.now()): string {
  mkdirSync(join(home, SIGNIN_DIR), { recursive: true, mode: 0o700 });
  sweep(home, now);
  const link = randomBytes(32).toString('base64url');
  writeFileSync(fileOf(home, link), `${now + SIGNIN_LINK_LIFETIME_MS}\n`, { mode: 0o600 });
  return link;
}

// Whether `given` is a link that was issued, has not ended and was not used: it is used up by this.
// Two requests with the same link race on removing its file, and only the one that removes it wins.
export function redeemSignInLink(home: string, given: string, now = Date.now()): boolean {
  if (!LINK_PATTERN.test(given)) return false;
  const path = fileOf(home, given);
  let endsAt: number;
  try {
    endsAt = Number(readFileSync(path, 'utf8'));
    rmSync(path);
  } catch {
    return false;
  }
  return endsAt > now;
}
