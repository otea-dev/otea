import type { DatabaseSync } from 'node:sqlite';
import { selectListenerProcesses } from '../store/queries.ts';
import { processAlive } from './presence.ts';

// An agent name is a claim, not a proof (field study 4, U8: `otea say "..." --as <the secretary>`
// from any process spoke as it). What ties a name to a session is the harness process noted for it
// (presence.ts noteHarness: its claim or its waits), which stays for as long as the session lives.
//
// `bound`: the command runs under that harness. `other`: the harness noted for the name runs, and
// this command is under another. `unverified`: Otea cannot tell, because nothing trusted is noted
// (a first session, an unknown program that is no harness Otea knows by name), the one noted is gone
// (a restart: the new session takes over), or the processes could not be read.
export type SessionVerdict = 'bound' | 'other' | 'unverified';

// The harness session noted for `agent` while it runs; none when none is trusted or it ended.
export function boundHarness(
  db: DatabaseSync,
  agent: string,
  alive: (pid: number) => boolean = processAlive,
): number | undefined {
  const noted = selectListenerProcesses(db).get(agent)?.harness ?? null;
  return noted !== null && noted > 0 && alive(noted) ? noted : undefined;
}

// What a command run under `caller` (the harness process it was found under, when it could be read)
// is, for the name `agent`.
export function sessionVerdict(
  db: DatabaseSync,
  agent: string,
  caller: number | undefined,
  alive: (pid: number) => boolean = processAlive,
): SessionVerdict {
  const bound = boundHarness(db, agent, alive);
  if (bound === undefined || caller === undefined) return 'unverified';
  return bound === caller ? 'bound' : 'other';
}
