import type { DatabaseSync } from 'node:sqlite';
import { selectListener, selectListenerProcesses } from '../store/queries.ts';
import { assistantName } from './assistant.ts';
import { processAlive } from './presence.ts';

// An agent name is a claim, not a proof (field study 4, U8: `otea say "..." --as <the assistant>`
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

// Whether an MCP server (`self`: its process and the one that started it) may not be heard as the
// assistant: the session noted for the assistant runs, and this server is not it. A name a server
// calls under is a claim, and hearing it would move the binding, the listening and the harness to
// the server (field study 5, V8: one impostor message left every later message of the real
// assistant «sin verificar», and its end read the real one as disconnected). A server is the noted
// session when it is the MCP session noted, or its launcher is the harness noted for a
// command-line assistant; a wrapper between them cannot be told apart here, and the server's calls
// are then judged by their processes (cli/session-guard.ts) without being heard.
export function bindsToAnother(
  db: DatabaseSync,
  agent: string,
  self: { pid: number; launcher: number },
  alive: (pid: number) => boolean = processAlive,
): boolean {
  if (assistantName(db) !== agent) return false;
  const noted = notedSession(db, agent, alive);
  if (noted === undefined) return false;
  // A newer server of the same launcher is the same harness's restart (claimName lets it take over).
  return noted.kind === 'mcp'
    ? noted.session !== self.pid && noted.launcher !== self.launcher
    : noted.pid !== self.launcher;
}
