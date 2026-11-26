import { existsSync } from 'node:fs';
import { OteaError } from '../core/errors.ts';
import { openDatabase } from '../store/database.ts';
import { selectAgentHome, upsertAgentHome } from '../store/registry.ts';
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
// or quiet with an item on a live lease. A project whose data is gone, or cannot be read, holds
// nobody.
function atWorkIn(dataDir: string, name: string, now: Clock): { holding: string[] } | undefined {
  const path = databasePath(dataDir);
  if (!existsSync(path)) return undefined;
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

// Notes that `name` runs a command in `project`, and refuses it when the name is at work in
// another project. Nothing is written for a refused command.
export function holdAgentHome(
  project: Pick<Project, 'identity' | 'dataDir'>,
  name: string,
  env: Env = process.env,
  now: Clock = systemClock,
): void {
  const registry = openRegistry(env);
  try {
    const home = selectAgentHome(registry, name);
    const here = project.identity;
    if (home && home.projectId !== here.id) {
      const there = atWorkIn(home.dataDir, name, now);
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
      return;
    upsertAgentHome(registry, {
      name,
      projectId: here.id,
      projectName: here.name,
      dataDir: project.dataDir,
      at: now(),
    });
  } finally {
    registry.close();
  }
}
