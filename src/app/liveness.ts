import type { DatabaseSync } from 'node:sqlite';
import { assistantStatus } from './assistant.ts';
import { type Clock, systemClock } from './items.ts';
import { type AgentPresence, listAgents, presenceSignatureOf, processAlive } from './presence.ts';

// What flips with no write: a process that ended (an assistant killed with its session leaves
// nothing behind) and a window that ran out (the assistant's held 30 minutes, an agent quiet past
// the listening window). The server looks at it on a timer while a desk is open and tells the desk
// when it differs, so «conectado» never outlives the process it was true of. `agents`: already
// read by the caller, which reads them once per look.
export function livenessSignature(
  db: DatabaseSync,
  now: Clock = systemClock,
  processes: (pid: number) => boolean = processAlive,
  agents: readonly AgentPresence[] = listAgents(db, now, processes),
): string {
  const states = agents
    .map(({ name, status, sessionEnded }) => [name, status, sessionEnded])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const assistant = assistantStatus(db, now, processes, agents);
  return JSON.stringify([states, assistant ? [assistant.name, assistant.state] : null]);
}

// What a desk's stream compares between two changes: who is there and what each is doing (the
// presence), and what time alone moved (the liveness). The agents are read once.
export function deskSignature(db: DatabaseSync): string {
  const agents = listAgents(db);
  return `${presenceSignatureOf(agents)}${livenessSignature(db, systemClock, processAlive, agents)}`;
}
