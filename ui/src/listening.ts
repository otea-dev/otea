import { itemUnheard, LISTEN_WINDOW_MS } from '../../src/core/agent-status.ts';
import { isClosed, isLandStep, positionOf } from '../../src/core/board/engine.ts';
import type { BoardDefinition } from '../../src/core/board/model.ts';
import { activeLease } from './active-lease.ts';
import { t } from './i18n/i18n.ts';
import { type Agent, hearsDesk, isConnected, statusOf } from './presence.ts';
import type { Item, ItemEvent } from './types.ts';

// Whether the desk is heard (PLAN5 G3): only an agent waiting in otea wait wakes for what the person
// does here. One idle in its chat, even with its MCP server open, hears nothing until it is told to
// go on, so an approval or an answer would sit there with the item reading as on its way.

// Whether any agent waits now (the server's status listening). Before presence loads, or from a
// server that does not say, it is taken as yes: the desk never warns of a silence it cannot tell.
export function anyoneWaits(agents: readonly Agent[] | null | undefined): boolean {
  if (!agents) return true;
  return takers(agents).some(hearsDesk);
}

// Whether a move the person can make here lands the item on an agent: only then does it matter
// that nobody listens. On a step of their own that closes the item or keeps it theirs, the desk
// says nothing of listening (P4-R3-5).
export function handsToAgent(
  choices: readonly ({ move: { turn: string } } | null | undefined)[],
): boolean {
  return choices.some((choice) => choice?.move.turn === 'agent');
}

// The agents at work now (P7-R2-9, P7-R2-12), as the server says (status working): connected, and
// holding an item they work on (not one that only waits for their question to be answered). While
// one is, what the person hands to an agent reaches it when it waits again, and an item nobody
// hears waits its turn in a queue: the desk says so calmly, not as an alarm.
export function workingAgents(
  agents: readonly Agent[] | null | undefined,
  items: readonly Pick<Item, 'id' | 'asks'>[],
  now: number,
): string[] {
  return takers(agents)
    .filter((a) => isWorking(a, items, now))
    .map((a) => a.name);
}

// The agents that take items, the workers: every one but the secretary, which talks with the
// person, and the refiner, which turns the Bandeja's notes into items and waits for the next note
// (neither takes an item, so neither is the one an item waits in the queue for, and neither counts
// as a listener on the boards: field study 3, S2, and the review of F6).
function takers(agents: readonly Agent[] | null | undefined): Agent[] {
  return (agents ?? []).filter((a) => a.role !== 'secretary' && a.role !== 'refiner');
}

// Whether one agent is at work: the server's status, the one definition the pill, the menu and the
// queue note share (it holds an item it works on, not one that waits for its own question to be
// answered). `items` and `now` stay for the callers; the desk works out nothing of its own.
export function isWorking(
  a: Agent,
  _items?: readonly Pick<Item, 'id' | 'asks'>[],
  _now?: number,
): boolean {
  return statusOf(a) === 'working';
}

// The agents the server says are connected but not waiting (status connected): one that just handed
// off, or sits idle in its chat with its MCP server open. They hear nothing of the desk until they
// wait again, which is no fault: the desk says so calmly (P5-F12, P2-F4).
export function connectedAgents(agents: readonly Agent[] | null | undefined): string[] {
  return takers(agents)
    .filter((a) => statusOf(a) === 'connected')
    .map((a) => a.name);
}

// The agent that holds the item's live lease while it is no longer connected (P7-R3-10): its
// session ended, or it went quiet, and the lease alone keeps the item until it runs out. Null while
// it is connected, with no live lease, or before presence loads.
export function goneHolder(
  item: Pick<Item, 'lease'>,
  agents: readonly Agent[] | null | undefined,
  now: number,
): Agent | null {
  const lease = activeLease(item.lease, now);
  const holder = lease ? agents?.find((a) => a.name === lease.holder) : undefined;
  return holder && !isConnected(holder) ? holder : null;
}

// The holder of the item's live lease when its question on it was answered and it never picked the
// answer up (P6-R3-4): no otea call since the answer, no otea wait running, past the moment it
// takes to pick it up. Its MCP server may still beat, so it can be connected; the lease alone keeps
// the item. A long step with no call reads as at work, as #477 has it: only an answer left unread
// tells it went quiet. `since`: when the answer came. Null otherwise, or before presence loads.
export function silentHolder(
  item: Pick<Item, 'lease'>,
  agents: readonly Agent[] | null | undefined,
  events: readonly Pick<ItemEvent, 'type' | 'actor' | 'at' | 'data'>[],
  now: number,
): { agent: string; since: string } | null {
  const lease = activeLease(item.lease, now);
  const holder = lease ? agents?.find((a) => a.name === lease.holder) : undefined;
  // The server's status says whether it listens or is still connected: one gone has goneHolder.
  if (!holder || hearsDesk(holder) || !isConnected(holder)) return null;
  const asked = new Set(
    events
      .filter((e) => e.type === 'question_asked' && e.actor.name === holder.name)
      .map((e) => e.data.question),
  );
  const answer = events.findLast(
    (e) => e.type === 'question_answered' && asked.has(e.data.question),
  );
  if (!answer) return null;
  const since = Date.parse(answer.at) || 0;
  if (now - since < LISTEN_WINDOW_MS) return null;
  if (holder.actedAt && (Date.parse(holder.actedAt) || 0) >= since) return null;
  return { agent: holder.name, since: answer.at };
}

// What the desk says beside a move that hands the item to an agent (P7-R2-9): nothing while an
// agent waits (it hears it at once); while none does, that the agents at work, or connected, will
// see it when they wait again (calm); with none there at all, that none is connected (calm too);
// and only when the agents left gave no signal, that nobody is listening (the alarm).
export type Hearing =
  | { kind: 'unheard' }
  | { kind: 'nobody' }
  | { kind: 'working'; agents: string[] }
  | { kind: 'connected'; agents: string[] };

// Whether no agent is here at all (none connected, none silent on a lease): an empty room, which
// the desk says calmly, never as a silence to fix. Before presence loads it is not.
export function noAgents(agents: readonly Agent[] | null | undefined): boolean {
  return !!agents && takers(agents).every((a) => statusOf(a) === 'away');
}

export function hearing(
  agents: readonly Agent[] | null | undefined,
  items: readonly Pick<Item, 'id' | 'asks'>[],
  now: number,
): Hearing | null {
  if (anyoneWaits(agents)) return null;
  const working = workingAgents(agents, items, now);
  if (working.length > 0) return { kind: 'working', agents: working };
  const connected = connectedAgents(agents);
  if (connected.length > 0) return { kind: 'connected', agents: connected };
  return noAgents(agents) ? { kind: 'nobody' } : { kind: 'unheard' };
}

// What the desk says of an item nobody hears: «nadie está escuchando» (a warning, only when the
// agents there gave no signal), or, while an agent is at work on another item, or connected, that
// it waits in the queue for it (calm); with no agent connected at all, that none is (calm).
export function unheardWords(
  busy: readonly string[],
  nobody = false,
  connected: readonly string[] = [],
): { text: string; calm: boolean } {
  if (busy.length === 0 && connected.length > 0)
    return {
      text: t('listen.connectedQueue', { count: connected.length, agent: connected[0] ?? '' }),
      calm: true,
    };
  if (busy.length === 0 && nobody) return { text: t('listen.noAgents'), calm: true };
  if (busy.length === 0) return { text: t('listen.none'), calm: false };
  return { text: t('listen.busy', { count: busy.length, agent: busy[0] ?? '' }), calm: true };
}

// The same, as a sentence for the header of item `id`. «Busy with another item» only when each of
// them holds an item other than this one; one holding none (between two items, or claiming this
// one) is only at work (P6-R3-5).
export function unheardLead(
  busy: readonly string[],
  agents: readonly Agent[] | null | undefined,
  id: string,
): string {
  if (busy.length === 0) {
    const connected = connectedAgents(agents);
    if (connected.length > 0)
      return t('listen.connected', { count: connected.length, agent: connected[0] ?? '' });
    return t(noAgents(agents) ? 'listen.noAgentsLead' : 'listen.lead');
  }
  const elsewhere = busy.every((name) =>
    agents?.find((a) => a.name === name)?.holding.some((held) => held !== id),
  );
  return t(elsewhere ? 'listen.busyLead' : 'listen.activeLead', {
    count: busy.length,
    agent: busy[0] ?? '',
  });
}

// Whether an item waits for an agent that nobody will bring: on the agent turn, no agent waiting,
// and no agent at work on it (none holds it, or its holder has gone idle or is no longer connected,
// P7-R3-10). One an agent set aside for later is not: the desk says who set it aside instead, with
// Retomar (P7-R3-1).
export function unheard(
  item: Pick<Item, 'turn' | 'lease' | 'setAside'>,
  agents: readonly Agent[] | null | undefined,
  now: number,
): boolean {
  const lease = activeLease(item.lease, now);
  const holder = lease ? agents?.find((a) => a.name === lease.holder) : undefined;
  return itemUnheard({
    turn: item.turn,
    setAside: !!item.setAside,
    anyoneWaits: anyoneWaits(agents),
    holderWorking: !!holder && statusOf(holder) === 'working',
  });
}

// The items waiting behind `item` to land: on a board's land step (one agent lands at a time on a
// base, app/land-order.ts), the others of its board on the same step that no agent holds. What a
// silent holder keeps waiting (P6-R3-4). None off a land step, or off a board.
export function waitingToLand(
  item: Pick<Item, 'id' | 'collection' | 'state'>,
  all: readonly Pick<Item, 'id' | 'collection' | 'state' | 'lease'>[],
  def: BoardDefinition | null | undefined,
  now: number,
): string[] {
  const at = positionOf(item.state);
  if (!def || isClosed(at) || at.phase !== 'doing' || !isLandStep(def, at.step)) return [];
  return all
    .filter(
      (other) =>
        other.id !== item.id &&
        other.collection === item.collection &&
        other.state === item.state &&
        !activeLease(other.lease, now),
    )
    .map(({ id }) => id);
}
