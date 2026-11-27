import { noteHarness } from '../app/presence.ts';
import { openProject, type Project } from '../app/project.ts';
import { secretaryName } from '../app/secretary.ts';
import { type Noted, notedSession, type SessionVerdict, sameStart } from '../app/session-bound.ts';
import { OteaError } from '../core/errors.ts';
import { findItem, forgetHarness } from '../store/queries.ts';
import type { Command, Input } from './command.ts';
import { harnessOf, isKnownHarness, listProcesses, type ProcessRow } from './owner.ts';
import { STARTED_BY } from './started-by.ts';

// An agent name proves nothing: `otea say "..." --as <the secretary>` from any process spoke as it
// (field study 4, U8). The session noted for a name (app/session-bound.ts) is what ties it to one,
// so while that session runs, the commands that act under the name of the secretary, or on an item
// its worker's session leased, are refused from another session, over the command line and over MCP
// alike; once the session is gone, a new one takes the name over. Reading the processes costs a
// listing, so it happens only when a session is noted and runs, and a listing that cannot be read in
// time leaves the command alone, said as unverified (which the desk marks on the secretary's
// messages, and which never carries a card). A listing that is read but reaches no harness from the
// caller (an orphan process, an MCP server whose launcher is gone) does not leave it alone: while
// the noted session runs, what cannot be proven to be it is refused (field study 5, V8).
//
// What this stops is a process that misuses Otea's own interfaces. A local process that writes the
// SQLite file directly is outside it: Otea cannot stop that, and docs/working-with-agents.md says so.

// The commands the secretary acts through: they speak, link or hold for it.
const SECRETARY_ACTS = new Set([
  'say',
  'relay',
  'conversation',
  'create',
  'update',
  'ask',
  'bandeja take',
  'bandeja close',
]);

// The commands that change an item an agent holds, by its id as the first argument.
const LEASE_ACTS = new Set([
  'claim',
  'handoff',
  'move',
  'update',
  'release',
  'attach',
  'detach',
  'ask',
  'drop',
]);

// How long a command waits for the process table to know its harness.
const READ_MS = 3000;

// What each command that was checked found out, for the ones that say it (say marks its message).
const verdicts = new WeakMap<Input, SessionVerdict>();

export function sessionVerdictOf(input: Input): SessionVerdict {
  return verdicts.get(input) ?? 'unverified';
}

// The commands that read under the secretary's name from a session that is not the bound one: they
// are answered, but are no sign of life of the secretary (field study 4, T1c: `otea pending --as
// <secretary>` from any process kept a dead secretary «connected» and its role taken).
const strangers = new WeakSet<Input>();

export const isFromAnotherSession = (input: Input): boolean => strangers.has(input);

// `pid` is the harness the command runs under; undefined when the table is read but reaches none: a
// process nobody started that runs (an orphan, whose parent is gone, so no harness can be resolved).
type Caller = {
  pid: number | undefined;
  started: number | undefined;
  known: boolean;
  rows: ProcessRow[];
};

// The caller, from the processes read; the harness is none when the table does not reach one.
export function callerIn(rows: ProcessRow[], startedBy: number): Caller {
  const pid = harnessOf(rows, startedBy);
  return {
    pid,
    started: pid === undefined ? undefined : rows.find((row) => row.pid === pid)?.started,
    known: pid !== undefined && isKnownHarness(rows, pid),
    rows,
  };
}

// The harness this command runs under, from the processes; undefined when they cannot be read (or
// not in time).
async function callerOf(): Promise<Caller | undefined> {
  const table = await listProcesses(AbortSignal.timeout(READ_MS));
  return table === undefined ? undefined : callerIn(table.rows, STARTED_BY);
}

type Bound = { noted: Noted; refusal: string };

// The session the command is bound to, if it acts as the secretary or on an item its own session
// leased and that session runs.
function boundOf(project: Project, input: Input, agent: string): Bound | undefined {
  const command = input.command ?? '';
  const declares = command === 'profile' && input.option('role') === 'secretary';
  const secretaryAct =
    SECRETARY_ACTS.has(command) || declares || (command === 'wait' && input.flag('secretary'));
  if (secretaryAct && secretaryName(project.db) === agent) {
    const noted = notedSession(project.db, agent);
    if (noted !== undefined)
      return {
        noted,
        refusal: `${agent} is this project's secretary and runs in another session: this command is not from it. If you are the secretary, it is that session; if that one ended, take over from yours once its process is gone. Otherwise use your own name (otea whoami) and ask the secretary through otea escalate`,
      };
  }
  if (!LEASE_ACTS.has(command)) return undefined;
  const id = input.args[0];
  const item = id === undefined ? undefined : findItem(project.db, id);
  if (item?.lease?.holder !== agent) return undefined;
  const noted = notedSession(project.db, agent);
  if (noted === undefined) return undefined;
  return {
    noted,
    refusal: `${item.id} is leased by a session of ${agent} that runs in another harness than this command: another session may not act under its name. Use your own name (otea whoami) and claim what you need; this lease ends with that session`,
  };
}

// Whether the command runs under the noted session: `gone` when the noted harness is not the
// process it was (its id was handed out again, or it is no longer listed): a new session takes over.
async function judge(
  noted: Noted,
  input: Input,
): Promise<{ verdict: SessionVerdict | 'gone'; harness?: number }> {
  // An MCP session is one server process: its own calls are the session's.
  if (noted.kind === 'mcp' && input.channel === 'mcp') {
    return { verdict: noted.session === process.pid ? 'bound' : 'other' };
  }
  return judgeCaller(noted, await callerOf());
}

// The verdict for a caller read from the processes. While the noted session runs, a caller that
// cannot be proven to be it is not it: one the table reads but reaches no harness from (an orphan
// background process, an MCP server whose launcher is gone) is refused, not let through unverified
// (field study 5, V8). Unverified stays for what cannot be checked at all: the table cannot be read,
// or the noted harness cannot be resolved.
export function judgeCaller(
  noted: Noted,
  caller: Caller | undefined,
): { verdict: SessionVerdict | 'gone'; harness?: number } {
  if (caller === undefined) return { verdict: 'unverified' };
  const bound =
    noted.kind === 'cli' ? noted.pid : harnessOf(caller.rows, noted.launcher ?? Number.NaN);
  if (bound === undefined) return { verdict: 'unverified' };
  const row = caller.rows.find(({ pid }) => pid === bound);
  if (row === undefined) return { verdict: 'gone', harness: bound };
  if (noted.kind === 'cli' && !sameStart(noted.started, row.started)) {
    return { verdict: 'gone', harness: bound };
  }
  return { verdict: caller.pid === bound ? 'bound' : 'other' };
}

// Throws when the command acts under a name bound to another session; otherwise notes what it
// found, and returns what to do once the command succeeded (note the harness of a declaration).
export async function guardSession(input: Input): Promise<(() => Promise<void>) | undefined> {
  const agent = input.agent;
  if (agent === undefined) return undefined;
  let bound: Bound | undefined;
  let declares = false;
  let reading: Noted | undefined;
  try {
    const project = openProject(input.cwd);
    try {
      bound = boundOf(project, input, agent);
      declares = input.command === 'profile' && input.option('role') === 'secretary';
      // A read under the secretary's name: not refused, but not taken for its sign of life unless it
      // comes from its session.
      if (bound === undefined && !declares && secretaryName(project.db) === agent) {
        reading = notedSession(project.db, agent);
      }
    } finally {
      project.db.close();
    }
  } catch {
    // No project here: the command says so itself.
    return undefined;
  }
  if (reading !== undefined && (await judge(reading, input)).verdict === 'other') {
    strangers.add(input);
  }
  if (bound !== undefined) {
    const { verdict, harness } = await judge(bound.noted, input);
    if (verdict === 'other') throw new OteaError('forbidden', bound.refusal);
    if (verdict === 'bound') verdicts.set(input, 'bound');
    if (verdict === 'gone' && harness !== undefined) {
      try {
        const project = openProject(input.cwd);
        try {
          forgetHarness(project.db, agent, harness);
        } finally {
          project.db.close();
        }
      } catch {
        // Nothing to forget it in.
      }
    }
  }
  // A secretary's declaration notes the harness it runs under, so its binding stands before any
  // wait of anyone's: an impersonator's first wait cannot take the role before the real one.
  // Over MCP the server is the session, noted when it hears the name.
  if (declares && input.channel === 'cli') return () => noteCallerAs(input, agent);
  return undefined;
}

async function noteCallerAs(input: Input, agent: string): Promise<void> {
  const caller = await callerOf();
  if (caller?.pid === undefined || caller.pid === process.pid) return;
  try {
    const project = openProject(input.cwd);
    try {
      noteHarness(project.db, agent, caller.pid, undefined, caller.known, caller.started);
    } finally {
      project.db.close();
    }
  } catch {
    // The project is gone: nothing to note it for.
  }
}

// A command that checks the session before it runs.
export function sessionBound(command: Command): Command {
  return {
    ...command,
    execute: async (input) => {
      const after = await guardSession(input);
      const output = await command.execute(input);
      await after?.();
      return output;
    },
  };
}
