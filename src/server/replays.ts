import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import type { Project } from '../app/project.ts';
import { OteaError } from '../core/errors.ts';
import { insertReplay, type Replay, selectReplay } from '../store/replays.ts';
import { clientKeyOf, keyScopeOf } from './writes.ts';

// A write of the person sent again under the same Idempotency-Key (a phone that never heard back, an
// offline queue): the first result comes back, flagged, and nothing is done twice. The same key with
// other content is refused, as the captures of the Bandeja and Hablar refuse it. A key is one
// client's, and one route's.

export const digestOf = (content: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(content ?? null))
    .digest('hex');

function route(c: Context): string {
  return `${c.req.method} ${new URL(c.req.url).pathname}`;
}

// What the key already answered for this route, if it did: undefined for a first send. Throws when
// the key answered something else.
export function replayOf(c: Context, project: Project, digest: string): Replay | undefined {
  const key = clientKeyOf(c);
  if (key === undefined) return undefined;
  const found = selectReplay(project.db, keyScopeOf(c), key, route(c));
  if (found === undefined) return undefined;
  if (found.digest !== digest) {
    throw new OteaError(
      'already_exists',
      'This Idempotency-Key already sent something else: send this one under a new key',
    );
  }
  return found;
}

// Keeps what a first send answered, when it came with a key.
export function keepReplay(
  c: Context,
  project: Project,
  digest: string,
  status: number,
  body: unknown,
): void {
  const key = clientKeyOf(c);
  if (key === undefined) return;
  insertReplay(
    project.db,
    keyScopeOf(c),
    key,
    route(c),
    { digest, status, body: JSON.stringify(body) },
    new Date().toISOString(),
  );
}

// Runs `run` (which does the write and answers with its result) once per key and content; a send
// again gets the first result, with 200 and `idempotent-replayed`.
export function replaying<T>(
  c: Context,
  project: Project,
  content: unknown,
  status: 200 | 201,
  run: () => T,
): Response {
  const digest = digestOf(content);
  const found = replayOf(c, project, digest);
  if (found !== undefined) {
    c.header('idempotent-replayed', 'true');
    return c.json(JSON.parse(found.body) as T, 200);
  }
  const result = run();
  keepReplay(c, project, digest, status, result);
  return c.json(result, status);
}
