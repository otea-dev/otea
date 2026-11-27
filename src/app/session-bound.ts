import type { DatabaseSync } from 'node:sqlite';
import { selectListener, selectListenerProcesses } from '../store/queries.ts';
import { processAlive } from './presence.ts';

// An agent name is a claim, not a proof (field study 4, U8: `otea say "..." --as <the secretary>`
// from any process spoke as it). What ties a name to a session is the harness process noted for it,
// which stays for as long as the session lives:
// - a command-line agent's: the harness above the shells that ran its claim, its wait or its
//   declaration (presence.ts noteHarness), noted with when it started;
// - an agent heard through an MCP server: that server (a process of its own), started by a
//   launcher, which is the harness or a wrapper of it.
//
// `bound`: the command runs under that session. `other`: the session noted for the name runs, and
// this command is under another. `unverified`: Otea cannot tell, because nothing trusted is noted
// (a first session, a program that is no harness Otea knows by name), the one noted is gone (a
// restart: the new session takes over), or the processes could not be read.
export type SessionVerdict = 'bound' | 'other' | 'unverified';

export type Noted =
  | { kind: 'cli'; pid: number; started?: number }
  | { kind: 'mcp'; session: number; launcher: number | null };

// The session noted for `agent` while it runs; none when none is trusted or it ended.
export function notedSession(
  db: DatabaseSync,
  agent: string,
  alive: (pid: number) => boolean = processAlive,
): Noted | undefined {
  const heard = selectListener(db, agent);
  if (heard?.session && alive(heard.session)) {
    return { kind: 'mcp', session: heard.session, launcher: heard.harness };
  }
  const listener = selectListenerProcesses(db).get(agent);
  if (listener?.harness != null && alive(listener.harness)) {
    return {
      kind: 'cli',
      pid: listener.harness,
      ...(listener.harnessStarted === null ? {} : { started: listener.harnessStarted }),
    };
  }
  return undefined;
}

// The start times the system gives agree (to the second or two) or one of them is not known.
export function sameStart(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || Math.abs(a - b) <= 2000;
}
