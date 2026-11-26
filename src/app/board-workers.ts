import type { DatabaseSync } from 'node:sqlite';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { type BoardDefinition, guardedBranch } from '../core/board/model.ts';
import { OteaError } from '../core/errors.ts';
import { activeLease } from '../core/lease.ts';
import { selectItems, selectRecentAgentWork } from '../store/queries.ts';
import { selectRoles } from '../store/secretary.ts';
import type { Item } from './items.ts';
import type { AgentPresence } from './presence.ts';
import { listAgents, processAlive } from './presence.ts';

// The agents working a board (F2, field study 3): the one holding an item of it on a live lease, at
// work however long its step runs between two otea calls, and the one that handed an item of it off
// or let it go a moment ago, between two items. Neither is «nobody listening», and neither is a
// worker to launch another beside. The secretary never counts: it does no item.
export const BETWEEN_ITEMS_MS = 5 * 60_000;

// The agents working each board, by its collection.
export type TendedBy = ReadonlyMap<string, readonly string[]>;

// Per board (its collection), the agents working it now.
export function workersByBoard(
  db: DatabaseSync,
  items: readonly Pick<Item, 'collection' | 'lease'>[],
  agents: readonly Pick<AgentPresence, 'name' | 'role' | 'status' | 'sessionEnded' | 'live'>[],
  at: string,
): TendedBy {
  const byName = new Map(
    agents.filter(({ role }) => role !== 'secretary').map((agent) => [agent.name, agent]),
  );
  const boards = new Map<string, Set<string>>();
  const add = (collection: string, agent: string) => {
    const set = boards.get(collection) ?? new Set<string>();
    set.add(agent);
    boards.set(collection, set);
  };
  for (const { collection, lease } of items) {
    const live = activeLease(lease, at);
    const holder = live ? byName.get(live.holder) : undefined;
    if (holder && !holder.sessionEnded) add(collection, holder.name);
  }
  const since = Date.parse(at) - BETWEEN_ITEMS_MS;
  for (const work of selectRecentAgentWork(db)) {
    const agent = byName.get(work.agent);
    if (agent?.live && !agent.sessionEnded && Date.parse(work.at) >= since) {
      add(work.collection, agent.name);
    }
  }
  return new Map([...boards].map(([collection, names]) => [collection, [...names]]));
}

// One live worker per board (the canon of the secretary's project); a board that merges code (it
// protects a branch) allows two, since one can be rebasing while the other works.
export const WORKERS_PER_BOARD = 1;
export const WORKERS_PER_CODE_BOARD = 2;

export const workerLimitOf = (def: BoardDefinition): number =>
  guardedBranch(def) === undefined ? WORKERS_PER_BOARD : WORKERS_PER_CODE_BOARD;

const isDoing = (state: string): boolean => {
  const at = positionOf(state);
  return !isClosed(at) && at.phase === 'doing';
};

// What refuses `agent` taking an item of the board `def` while the board already has its limit of
// other workers at work, or undefined when there is room. Only a project with a secretary keeps
// this canon: it launches the workers and obeys the refusal, so a second one is never started
// beside a live one (the duplicate branch of field study 3). The agent that already works the
// board is one of them, never refused for being there.
export function crowdedBoard(
  db: DatabaseSync,
  item: { collection: string; state: string },
  agent: string,
  def: BoardDefinition,
  at: string,
  processes: (pid: number) => boolean = processAlive,
): OteaError | undefined {
  if (![...selectRoles(db).values()].includes('secretary')) return undefined;
  // Only the work of a step counts: a review is another agent's by design, and holds no worker.
  if (!isDoing(item.state)) return undefined;
  const agents = listAgents(db, () => at, processes);
  const items = selectItems(db, { collection: item.collection }).filter(({ state }) =>
    isDoing(state),
  );
  const others = (workersByBoard(db, items, agents, at).get(item.collection) ?? []).filter(
    (name) => name !== agent,
  );
  const limit = workerLimitOf(def);
  if (others.length < limit) return undefined;
  const who = others.join(', ');
  return new OteaError(
    'not_claimable',
    `${who} already ${others.length === 1 ? 'works' : 'work'} the board ${def.name}, and a board has ${limit === 1 ? 'one worker' : 'two workers'} at a time${limit === 1 ? '' : ' (it merges code)'}: ${agent} takes no item of it while ${others.length === 1 ? 'that one is' : 'those are'} there. Take other work, or stop: the secretary starts no second worker for ${def.name}.`,
  );
}
