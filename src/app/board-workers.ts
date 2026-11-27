import type { DatabaseSync } from 'node:sqlite';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { type BoardDefinition, guardedBranch } from '../core/board/model.ts';
import { OteaError } from '../core/errors.ts';
import { activeLease } from '../core/lease.ts';
import { timeText } from '../core/time.ts';
import { selectItems, selectRecentAgentWork } from '../store/queries.ts';
import { selectRoles } from '../store/secretary.ts';
import type { Item } from './items.ts';
import type { AgentPresence } from './presence.ts';
import { listAgents, processAlive } from './presence.ts';

// The agents working a board (F2, field study 3): the one holding an item of it on a live lease, at
// work however long its step runs between two otea calls, and the one that handed an item of it off
// or let it go a moment ago, between two items. Neither is «nobody listening», and neither is a
// worker to launch another beside. The secretary never counts: it does no item. Both must be
// there: a holder whose session ended, or that gave no sign for SILENT_AFTER_MS, left the board
// free (a crashed worker frees it by itself).
export const BETWEEN_ITEMS_MS = 5 * 60_000;

// An agent working a board, and until when it counts as there (its lease, or the time between two
// items) when that is known.
export type BoardWorker = { name: string; until: string | null };

// The agents working each board, by its collection.
export type TendedBy = ReadonlyMap<string, readonly BoardWorker[]>;

type WorkerFacts = Pick<AgentPresence, 'name' | 'role' | 'status' | 'sessionEnded' | 'live'>;

// Whether the agent is there: connected, or at work on a lease with a sign of it lately.
const isThere = (agent: WorkerFacts): boolean =>
  !agent.sessionEnded && (agent.live || agent.status === 'working');

const isDoing = (state: string): boolean => {
  const at = positionOf(state);
  return !isClosed(at) && at.phase === 'doing';
};

// Per board (its collection), the agents working it now. Only the work of a step counts: a review,
// a send-back or an approval is another agent's by design and holds no worker.
export function workersByBoard(
  db: DatabaseSync,
  items: readonly Pick<Item, 'collection' | 'lease'>[],
  agents: readonly WorkerFacts[],
  at: string,
): TendedBy {
  const byName = new Map(
    agents.filter(({ role }) => role !== 'secretary').map((agent) => [agent.name, agent]),
  );
  const boards = new Map<string, Map<string, string | null>>();
  const add = (collection: string, agent: string, until: string | null) => {
    const names = boards.get(collection) ?? new Map<string, string | null>();
    const known = names.get(agent);
    if (known === undefined || (until !== null && (known === null || until > known))) {
      names.set(agent, until);
    }
    boards.set(collection, names);
  };
  for (const { collection, lease } of items) {
    const live = activeLease(lease, at);
    const holder = live ? byName.get(live.holder) : undefined;
    if (holder && isThere(holder)) add(collection, holder.name, live?.expiresAt ?? null);
  }
  const since = Date.parse(at) - BETWEEN_ITEMS_MS;
  for (const work of selectRecentAgentWork(db, new Date(since).toISOString())) {
    const agent = byName.get(work.agent);
    if (!agent?.live || agent.sessionEnded || Date.parse(work.at) < since) continue;
    // The step it did: a claim or a release of an item still being done, or a move out of a doing
    // step (its handoff). A review's claim, a send-back or an approval is not its work.
    const did =
      work.type === 'transitioned' ? work.from !== null && isDoing(work.from) : isDoing(work.state);
    if (!did) continue;
    add(
      work.collection,
      agent.name,
      new Date(Date.parse(work.at) + BETWEEN_ITEMS_MS).toISOString(),
    );
  }
  return new Map(
    [...boards].map(([collection, names]) => [
      collection,
      [...names].map(([name, until]) => ({ name, until })),
    ]),
  );
}

// One live worker per board (the canon of the secretary's project); a board that merges code (it
// protects a branch) allows two, since one can be rebasing while the other works.
export const WORKERS_PER_BOARD = 1;
export const WORKERS_PER_CODE_BOARD = 2;

export const workerLimitOf = (def: BoardDefinition): number =>
  guardedBranch(def) === undefined ? WORKERS_PER_BOARD : WORKERS_PER_CODE_BOARD;

// What refuses an agent an item of a board while it has its limit of other workers at work, or
// undefined when there is room. Only a project with a secretary keeps this canon: it launches the
// workers and obeys the refusal, so a second one is never started beside a live one (the duplicate
// branch of field study 3). The agent that already works the board is one of them, never refused
// for being there. The facts (who is on each board) are read once, at the first question, and kept
// for the others: build one per look.
export type CrowdCheck = (
  item: { collection: string; state: string },
  agent: string,
  def: BoardDefinition,
) => OteaError | undefined;

export function crowdCheck(
  db: DatabaseSync,
  at: string,
  processes: (pid: number) => boolean = processAlive,
): CrowdCheck {
  let workers: TendedBy | undefined;
  let keeps: boolean | undefined;
  return (item, agent, def) => {
    keeps ??= [...selectRoles(db).values()].includes('secretary');
    if (!keeps) return undefined;
    // Only the work of a step counts: a review is another agent's by design, and holds no worker.
    if (!isDoing(item.state)) return undefined;
    workers ??= workersByBoard(
      db,
      selectItems(db, {}).filter(({ state }) => isDoing(state)),
      listAgents(db, () => at, processes),
      at,
    );
    const others = (workers.get(item.collection) ?? []).filter(({ name }) => name !== agent);
    const limit = workerLimitOf(def);
    if (others.length < limit) return undefined;
    const who = others
      .map(({ name, until }) => (until === null ? name : `${name} (until ${timeText(until)})`))
      .join(', ');
    const many = others.length > 1;
    return new OteaError(
      'not_claimable',
      `${who} already ${many ? 'work' : 'works'} the board ${def.name}, and a board has ${limit === 1 ? 'one worker' : 'two workers'} at a time${limit === 1 ? '' : ' (it merges code)'}: ${agent} takes no item of it while ${many ? 'those are' : 'that one is'} there. Take other work, or wait for it to free up: otea wait --turn agent --unclaimed --as ${agent}. The secretary starts no second worker for ${def.name}.`,
    );
  };
}

// One question: the same as a check built for it.
export function crowdedBoard(
  db: DatabaseSync,
  item: { collection: string; state: string },
  agent: string,
  def: BoardDefinition,
  at: string,
  processes: (pid: number) => boolean = processAlive,
): OteaError | undefined {
  return crowdCheck(db, at, processes)(item, agent, def);
}
