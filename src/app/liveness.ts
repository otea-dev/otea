import type { DatabaseSync } from 'node:sqlite';
import { type Clock, systemClock } from './items.ts';
import { listAgents, processAlive } from './presence.ts';
import { secretaryStatus } from './secretary.ts';

// What flips with no write: a process that ended (a secretary killed with its session leaves
// nothing behind) and a window that ran out (the secretary's held 30 minutes, an agent quiet past
// the listening window). The server looks at it on a timer while a desk is open and tells the desk
// when it differs, so «conectado» never outlives the process it was true of.
export function livenessSignature(
  db: DatabaseSync,
  now: Clock = systemClock,
  processes: (pid: number) => boolean = processAlive,
): string {
  const agents = listAgents(db, now, processes)
    .map(({ name, status, sessionEnded }) => [name, status, sessionEnded])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const secretary = secretaryStatus(db, now, processes);
  return JSON.stringify([agents, secretary ? [secretary.name, secretary.state] : null]);
}
