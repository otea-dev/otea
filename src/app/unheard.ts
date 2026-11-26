import { itemUnheard } from '../core/agent-status.ts';
import { activeLease } from '../core/lease.ts';
import type { Item } from './items.ts';
import type { AgentPresence } from './presence.ts';

// Whether an item waits for an agent that nobody brings (the desk's «nadie está escuchando»): the
// one place the notifier and the secretary's wait ask it. Only an agent in otea wait on the boards
// is listening (status `listening`), never the secretary, whose wait presence says it is not (see
// AgentPresence.waiting); an item whose holder is at work is heard. `setAside`: left for later.
export function unheardOf(
  item: Pick<Item, 'turn' | 'lease'>,
  agents: readonly Pick<AgentPresence, 'name' | 'status'>[],
  at: string,
  setAside: boolean,
): boolean {
  const lease = activeLease(item.lease, at);
  const holder = lease ? agents.find(({ name }) => name === lease.holder) : undefined;
  return itemUnheard({
    turn: item.turn,
    setAside,
    anyoneWaits: agents.some(({ status }) => status === 'listening'),
    holderWorking: holder?.status === 'working',
  });
}
