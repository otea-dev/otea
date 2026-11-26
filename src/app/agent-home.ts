import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { OteaError } from '../core/errors.ts';
import { openDatabase } from '../store/database.ts';
import {
  type AgentHome,
  selectAgentHome,
  selectProjectPaths,
  upsertAgentHome,
} from '../store/registry.ts';
import { openRegistry } from './home.ts';
import { type Clock, systemClock } from './items.ts';
import { listAgents } from './presence.ts';
import { databasePath, type Env, type Project } from './project.ts';

// Which project an agent name is at work in. Projects are told apart by folder, and their ids
// repeat (CAM-1 in two of them), so an agent that stands in a folder of another project would
// otherwise write there: the field study had a worker of one project update the item of another
// from a shared folder. The first project an agent is seen in is its home; while it is at work
// there (connected, or holding an item on a live lease) a command of it from any other project is
// refused, and once it is not, the name goes free and follows the agent to the project it comes
// to. Kept in the Otea home with the registry, since no project knows the others.

// Whether `name` is at work in the project whose data sits in `dataDir`: connected or listening,
// or quiet with an item on a live lease. A project whose data is gone, whose folders are all gone
// (a registered project whose repo was deleted), or that cannot be read, holds nobody.
function atWorkIn(
  registry: DatabaseSync,
  home: AgentHome,
  name: string,
  now: Clock,
): { holding: string[] } | undefined {
  const path = databasePath(home.dataDir);
  if (!existsSync(path)) return undefined;
  const folders = selectProjectPaths(registry).filter(
    ({ projectId }) => projectId === home.projectId,
  );
  if (folders.length > 0 && !folders.some((folder) => existsSync(folder.path))) return undefined;
  try {
    const db = openDatabase(path);
    try {
      const agent = listAgents(db, now).find((each) => each.name === name);
      return agent && agent.status !== 'away' ? { holding: agent.holding } : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

// Notes that `name` runs a command in `project`. A command that writes (`write`) is refused when
// the name is at work in another project, and nothing is written for it. One that only reads
// is let through, but the agent is not taken for one of this project (false: do not note it as
// seen here).
export function holdAgentHome(
  project: Pick<Project, 'identity' | 'dataDir'>,
  name: string,
  mode: 'write' | 'read' = 'write',
  env: Env = process.env,
  now: Clock = systemClock,
): boolean {
  const registry = openRegistry(env);
  try {
    const home = selectAgentHome(registry, name);
    const here = project.identity;
    if (home && home.projectId !== here.id) {
      const there = atWorkIn(registry, home, name, now);
      if (there && mode === 'read') return false;
      if (there) {
        const holds = there.holding.length > 0 ? `, holding ${there.holding.join(', ')}` : '';
        throw new OteaError(
          'forbidden',
          `${name} is at work in the project ${home.projectName} (${home.projectId})${holds}, but this folder is the project ${here.name} (${here.id}); nothing was written. Work from a folder of ${home.projectName}, or give this session a name of its own here (otea whoami hands out a free one)`,
        );
      }
    }
    if (
      home?.projectId === here.id &&
      home.dataDir === project.dataDir &&
      home.projectName === here.name
    )
      return true;
    upsertAgentHome(registry, {
      name,
      projectId: here.id,
      projectName: here.name,
      dataDir: project.dataDir,
      at: now(),
    });
    return true;
  } finally {
    registry.close();
  }
}
