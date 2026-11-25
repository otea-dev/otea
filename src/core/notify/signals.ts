// What is worth a notification (a push to a phone, a desktop notification), read from the items as
// the lists show them. Each signal has a key that stays the same while the thing it says holds, so
// comparing two looks finds what is new:
// - turn: an item is yours to review, approve or do (your own step);
// - ask: an agent asks you something (otea ask), the turn yours until you answer;
// - replied: an agent answered one of your notes (otea reply);
// - stuck: an agent's lease ran out with nobody releasing it or taking the item again;
// - aside: an agent set the item aside for later (otea release --later);
// - unheard: the item waits for an agent and none is listening or at work (the desk's «nadie está
//   escuchando», core/agent-status.ts itemUnheard).

export const NOTIFY_KINDS = ['turn', 'ask', 'replied', 'stuck', 'aside', 'unheard'] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number];

type Lease = { holder: string; expiresAt: string };

// What an item says about itself in /api/items.
export type NotifyFacts = {
  id: string;
  title: string;
  state: string;
  turn: 'human' | 'agent' | 'none';
  round?: number;
  lease: Lease | null;
  expiredLease?: Lease;
  asks?: { question: number; by: string; text?: string };
  notes?: { replied?: { note: number; by: string; at: string } };
  // Set aside for later by an agent, while nothing lifted it (app/set-aside.ts).
  setAside?: { by: string; at: string };
  // Waits for an agent that nobody brings (the server works it out from the agents' statuses).
  unheard?: boolean;
};

export type Signal = {
  key: string;
  kind: NotifyKind;
  item: string;
  title: string;
  // Who asks (a question), answered, went quiet or set it aside.
  by?: string;
  // The question, for an ask.
  text?: string;
};

const active = (lease: Lease | null, now: number) =>
  lease !== null && Date.parse(lease.expiresAt) > now;

export function signalsOf(items: readonly NotifyFacts[], now: number): Signal[] {
  const out: Signal[] = [];
  for (const facts of items) {
    const { id: item, title } = facts;
    if (facts.turn === 'human') {
      const base = `turn:${item}:${facts.state}:${facts.round ?? ''}`;
      out.push(
        facts.asks
          ? {
              key: `${base}:q${facts.asks.question}`,
              kind: 'ask',
              item,
              title,
              by: facts.asks.by,
              ...(facts.asks.text ? { text: facts.asks.text } : {}),
            }
          : { key: base, kind: 'turn', item, title },
      );
    }
    const quiet = facts.expiredLease;
    if (facts.turn === 'agent' && quiet && !active(facts.lease, now)) {
      out.push({
        key: `stuck:${item}:${quiet.holder}:${quiet.expiresAt}`,
        kind: 'stuck',
        item,
        title,
        by: quiet.holder,
      });
    }
    if (facts.turn === 'agent' && facts.unheard) {
      out.push({
        key: `unheard:${item}:${facts.state}:${facts.round ?? ''}`,
        kind: 'unheard',
        item,
        title,
      });
    }
    const aside = facts.setAside;
    if (aside) {
      out.push({
        key: `aside:${item}:${aside.by}:${aside.at}`,
        kind: 'aside',
        item,
        title,
        by: aside.by,
      });
    }
    const replied = facts.notes?.replied;
    if (replied) {
      out.push({
        key: `replied:${item}:${replied.note}:${replied.at}`,
        kind: 'replied',
        item,
        title,
        by: replied.by,
      });
    }
  }
  return out;
}

// How long an item must stay unheard, without a break, before it is told: an agent between two
// steps is back in otea wait well within it.
export const UNHEARD_GRACE_MS = 2 * 60_000;

// The key an item's unheard stretch is counted under: a new state or round starts it over.
export const unheardKey = (facts: Pick<NotifyFacts, 'id' | 'state' | 'round'>): string =>
  `${facts.id}:${facts.state}:${facts.round ?? ''}`;

// Which of the items unheard now (`unheard`, by unheardKey) have been so for the grace. `since`
// is the state kept between looks: when each stretch began. Those unheard at the first look
// (`starting`) were there before the watching began and are never told, until heard again.
export function settleUnheard(
  since: Map<string, number | null>,
  unheard: ReadonlySet<string>,
  now: number,
  starting: boolean,
): Set<string> {
  for (const key of since.keys()) if (!unheard.has(key)) since.delete(key);
  const told = new Set<string>();
  for (const key of unheard) {
    if (!since.has(key)) since.set(key, starting ? null : now);
    const began = since.get(key);
    if (typeof began === 'number' && now - began >= UNHEARD_GRACE_MS) told.add(key);
  }
  return told;
}

// The signals that were not there the last time; the first look (`before` undefined) is where
// watching starts, so a server that starts or a phone that subscribes is not told the past.
export function freshSignals(
  before: ReadonlySet<string> | undefined,
  now: readonly Signal[],
): Signal[] {
  if (before === undefined) return [];
  return now.filter(({ key }) => !before.has(key));
}
