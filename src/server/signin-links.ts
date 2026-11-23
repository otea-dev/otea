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
const USED_SUFFIX = '.used';

const fileOf = (home: string, link: string) =>
  join(home, SIGNIN_DIR, createHash('sha256').update(link).digest('hex'));

// A link another process is writing right now (the file exists a moment before its end time is in
// it) is no ended link: an empty or unparsable file that young is left alone.
const WRITING_MS = 5_000;

// Links that ended are cleared as a new one is issued.
function sweep(home: string, now: number): void {
  const dir = join(home, SIGNIN_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      const endsAt = Number(readFileSync(path, 'utf8'));
      if (Number.isFinite(endsAt) && endsAt > 0) {
        if (endsAt <= now) rmSync(path, { force: true });
      } else if (Date.now() - statSync(path).mtimeMs >= WRITING_MS) {
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
// Using it up is creating a file beside the link's own that must not exist yet (the 'wx' flag): the
// file system lets exactly one caller create it, whatever the others read or remove meanwhile. Reading
// the link's file and then removing it, or renaming it, is no such thing: on Windows several
// processes can hold the same file open, and each one's remove or rename then goes through. The
// winner removes the link's file; the mark stays (and holds when the link ends, so it is swept with
// it) in case that removing fails.
export function redeemSignInLink(home: string, given: string, now = Date.now()): boolean {
  if (!LINK_PATTERN.test(given)) return false;
  const path = fileOf(home, given);
  let endsAt: number;
  try {
    endsAt = Number(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
  try {
    writeFileSync(`${path}${USED_SUFFIX}`, `${endsAt}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    return false;
  }
  rmSync(path, { force: true });
  return endsAt > now;
}
