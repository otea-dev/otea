import { openProject, type Project } from '../app/project.ts';
import { secretaryName } from '../app/secretary.ts';
import { boundHarness, type SessionVerdict } from '../app/session-bound.ts';
import { OteaError } from '../core/errors.ts';
import { findItem } from '../store/queries.ts';
import type { Command, Input } from './command.ts';
import { harnessOf, listProcesses } from './owner.ts';
import { STARTED_BY } from './started-by.ts';

// An agent name proves nothing: `otea say "..." --as <the secretary>` from any process spoke as it
// (field study 4, U8). The harness session noted for a name (presence.ts noteHarness) is what ties
// it to one, so while that session runs, the commands that act under the name of the secretary, or
// on an item its worker's session leased, are refused from another harness; once the session is
// gone, a new one takes the name over. Reading the processes costs a listing, so it happens only
// when a session is noted and runs, and a listing that cannot be read leaves the command alone
// (said as unverified, which the desk marks on the secretary's messages).

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

// The harness this command runs under, from the processes; undefined when they cannot be read.
async function callerHarness(): Promise<number | undefined> {
  const table = await listProcesses(AbortSignal.timeout(READ_MS));
  return table === undefined ? undefined : harnessOf(table.rows, STARTED_BY);
}

type Bound = { harness: number; text: string };

// The session the command is bound to, if it acts as the secretary or on an item its own session
// leased and that session runs.
function boundOf(project: Project, input: Input, agent: string): Bound | undefined {
  const command = input.command ?? '';
  const secretaryAct =
    SECRETARY_ACTS.has(command) || (command === 'wait' && input.flag('secretary'));
  if (secretaryAct && secretaryName(project.db) === agent) {
    const harness = boundHarness(project.db, agent);
    if (harness !== undefined)
      return {
        harness,
        text: `${agent} is this project's secretary and runs in another session: this command is not from it. If you are the secretary, it is that session; if that one ended, wait for its process to be gone and take over from yours. Otherwise use your own name (otea whoami) and ask the secretary through otea escalate`,
      };
  }
  if (!LEASE_ACTS.has(command)) return undefined;
  const id = input.args[0];
  const item = id === undefined ? undefined : findItem(project.db, id);
  if (item?.lease?.holder !== agent) return undefined;
  const harness = boundHarness(project.db, agent);
  if (harness === undefined) return undefined;
  return {
    harness,
    text: `${item.id} is leased by a session of ${agent} that runs in another harness than this command: another session may not act under its name. Use your own name (otea whoami) and claim what you need; this lease ends with that session`,
  };
}

// Throws when the command acts under a name bound to another session; otherwise notes what it found.
export async function guardSession(input: Input): Promise<void> {
  const agent = input.agent;
  if (input.channel !== 'cli' || agent === undefined) return;
  let bound: Bound | undefined;
  try {
    const project = openProject(input.cwd);
    try {
      bound = boundOf(project, input, agent);
    } finally {
      project.db.close();
    }
  } catch {
    // No project here: the command says so itself.
    return;
  }
  if (bound === undefined) return;
  const caller = await callerHarness();
  if (caller === undefined) return;
  if (caller !== bound.harness) throw new OteaError('forbidden', bound.text);
  verdicts.set(input, 'bound');
}

// A command that checks the session before it runs.
export function sessionBound(command: Command): Command {
  return {
    ...command,
    execute: async (input) => {
      await guardSession(input);
      return command.execute(input);
    },
  };
}
