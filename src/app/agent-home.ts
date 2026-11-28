import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { OteaError } from '../core/errors.ts';
import { transaction } from '../store/database.ts';
import {
  type AgentHome,
  selectAgentHome,
  selectProjectPaths,
  upsertAgentHome,
} from '../store/registry.ts';
import { openRegistry } from './home.ts';
import { type Clock, systemClock } from './items.ts';
import { CLI_SESSION_GAP_MS, SEEN_PRECISION_MS } from './presence.ts';
import { databasePath, type Env, type Project } from './project.ts';

// Which project an agent name works in. Projects are told apart by folder, and their ids repeat
// (CAM-1 in two of them), so an agent that stands in a folder of another project would otherwise
// write there: the field study had a worker of one project update the item of another from a
// shared folder. The first project an agent writes in is its home, kept in the Otea home with the
// registry (no project knows the others). The home lasts a session: it is kept by every write,
// claim and connect of the agent in it, and it lapses only at a session boundary, an hour of
// silence (CLI_SESSION_GAP_MS, the gap after which a command-line agent is a new session) or a new
// harness process asking from another project (`launcher`, when the call knows it: an MCP
// server's parent). A quiet few minutes on a long step is no boundary. Until then a write of the
// agent from any other project is refused, and a read goes through with a warning. A read never
// binds anything.

export const HOME_HOLD_MS = CLI_SESSION_GAP_MS;

// Whether the home no longer holds the name: its project's data or folders are gone (a registered
// project whose repo was deleted), the agent was silent for a session's gap, or another harness
// process asks.
function lapsed(
  registry: DatabaseSync,
  home: AgentHome,
  now: Clock,
  launcher: number | undefined,
): boolean {
  if (!existsSync(databasePath(home.dataDir))) return true;
  const folders = selectProjectPaths(registry).filter(
    ({ projectId }) => projectId === home.projectId,
  );
  if (folders.length > 0 && !folders.some((folder) => existsSync(folder.path))) return true;
  if (Date.parse(now()) - Date.parse(home.at) >= HOME_HOLD_MS) return true;
  return launcher !== undefined && home.launcher !== null && launcher !== home.launcher;
}

// How often a wait keeps its agent's home: well inside HOME_HOLD_MS.
const HOME_KEEP_MS = 10 * 60_000;

// Keeps the home of an agent that is only waiting (an assistant's wait lasts hours and writes
// nothing, so its home would lapse after HOME_HOLD_MS and the next write would be refused): the
// returned function is called on each beat of the wait, and renews the home at most every
// HOME_KEEP_MS. Where the home is another project's, or the registry cannot be read, it does
// nothing: a wait binds nothing new and fails nothing.
export function homeKeeper(
  project: Pick<Project, 'identity' | 'dataDir'>,
  name: string,
  env: Env = process.env,
  now: Clock = systemClock,
  launcher?: number,
): (at?: Clock) => void {
  let last = Date.parse(now());
  return (at = systemClock) => {
    const nowMs = Date.parse(at());
    if (nowMs - last < HOME_KEEP_MS) return;
    last = nowMs;
    try {
      holdAgentHome(project, name, 'write', env, at, launcher);
    } catch {
      // Another project's, or the registry is busy: the next beat looks again.
    }
  };
}

const where = (name: string, home: AgentHome, here: { id: string; name: string }) =>
  `${name} works in the project ${home.projectName} (${home.projectId}), but this folder is the project ${here.name} (${here.id}), and item ids repeat across projects: CAM-1 here is not CAM-1 there`;

const REGISTRY_TROUBLE =
  'Otea could not check which project this agent works in; nothing was written. Try again in a moment';

// Notes that `name` runs a command in `project`. A command that writes (`write`) is refused when
// the name works in another project, nothing is written for it, and it keeps (or takes) the home
// of the name, all in one step so two first calls from two projects never both get in. One that
// only reads (`read`) is let through and binds nothing: the answer is the warning to tell, and the
// caller leaves the agent unnoted as seen in this project; undefined when all is as usual. Where
// Otea cannot tell, a write is refused (try again), never let through.
export function holdAgentHome(
  project: Pick<Project, 'identity' | 'dataDir'>,
  name: string,
  mode: 'write' | 'read' = 'write',
  env: Env = process.env,
  now: Clock = systemClock,
  launcher?: number,
): string | undefined {
  const here = project.identity;
  try {
    const registry = openRegistry(env);
    try {
      if (mode === 'read') {
        const home = selectAgentHome(registry, name);
        if (!home || home.projectId === here.id || lapsed(registry, home, now, launcher))
          return undefined;
        return `${where(name, home, here)}. This shows ${here.name}'s items, not ${home.projectName}'s, and ${name} is not noted here; run it from a folder of ${home.projectName} (otea projects current shows where you are).`;
      }
      return transaction(registry, () => {
        const home = selectAgentHome(registry, name);
        if (home && home.projectId !== here.id && !lapsed(registry, home, now, launcher)) {
          throw new OteaError(
            'forbidden',
            `${where(name, home, here)}; nothing was written. Run this from a folder of ${home.projectName} (otea projects current shows where you are).`,
          );
        }
        const same = home?.projectId === here.id;
        const keptLauncher = launcher ?? (same ? (home?.launcher ?? undefined) : undefined);
        // Kept as it stands while it is fresh: a busy agent does not write the registry on every call.
        if (
          home &&
          same &&
          home.dataDir === project.dataDir &&
          home.projectName === here.name &&
          home.launcher === (keptLauncher ?? null) &&
          Date.parse(now()) - Date.parse(home.at) < SEEN_PRECISION_MS
        )
          return undefined;
        upsertAgentHome(registry, {
          name,
          projectId: here.id,
          projectName: here.name,
          dataDir: project.dataDir,
          at: now(),
          launcher: keptLauncher ?? null,
        });
        return undefined;
      });
    } finally {
      registry.close();
    }
  } catch (error) {
    if (error instanceof OteaError) throw error;
    // A read that cannot be checked goes on; a write is refused rather than guessed.
    if (mode === 'read') return undefined;
    throw new OteaError('forbidden', REGISTRY_TROUBLE);
  }
}
