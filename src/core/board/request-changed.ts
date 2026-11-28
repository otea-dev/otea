import type { Actor } from '../item.ts';
import { timeText } from '../time.ts';

// A request rewritten while its delivery waits for review (U5, field study 4): the title and the
// fields now say one thing, the branch and its diff are the other. The delivery is the last move an
// agent made (its handoff); whoever rewrote the item after it, other than the agent that handed it
// in, changed what the person is about to approve. The reader says so before they decide.

export type RequestChange = { field: string; from: string | null; to: string | null };

export type RequestChanged = {
  // When the delivery was handed in, and by whom.
  handedAt: string;
  handedBy: string;
  // When the request was last changed, and by whom.
  changedAt: string;
  by: string;
  // Per field, what it said at the handoff and what it says now.
  changes: RequestChange[];
};

type Event = {
  type: string;
  actor: Actor;
  at: string;
  data: Record<string, unknown>;
};

const SHOWN = 160;

const quoted = (value: string | null): string =>
  value === null
    ? '(empty)'
    : JSON.stringify(value.length > SHOWN ? `${value.slice(0, SHOWN)}…` : value);

// What `otea show` and the assistant's wake say of it, in one sentence.
export function requestChangedText(changed: RequestChanged): string {
  const list = changed.changes
    .map(({ field, from, to }) => `${field}: ${quoted(from)} -> ${quoted(to)}`)
    .join('; ');
  return `The request changed after this delivery was handed in (${changed.by}, ${timeText(changed.changedAt)}): ${list}. The diff and the branch answer the earlier request: say so before the person approves, or send it back.`;
}

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

// A subagent of the agent that handed it in works under its name and a role (quill-haiku): it is
// the same hand, never someone changing the request. A number alone after the name is another
// session of the agent (claude-2), as presence.ts isSubagent says.
function ownSubagent(name: string, parent: string): boolean {
  return name.startsWith(`${parent}-`) && !/^\d+$/.test(name.slice(parent.length + 1));
}

// `events`: the item's, oldest first. Whether the item waits for the person is the caller's to ask.
// `isRequest`: whether a field is what the person asked for (its title and the board's form fields):
// a branch pushed, a link or a checklist edited since is bookkeeping, no change of the request.
export function requestChangedAfterHandoff(
  events: readonly Event[],
  isRequest: (field: string) => boolean = () => true,
): RequestChanged | undefined {
  const handoff = events.findLastIndex(({ type }) => type === 'transitioned');
  const handed = events[handoff];
  if (handed?.actor.kind !== 'agent') return undefined;
  const merged = new Map<string, RequestChange>();
  let last: Event | undefined;
  for (const event of events.slice(handoff + 1)) {
    if (event.type !== 'updated' || event.actor.name === handed.actor.name) continue;
    if (event.actor.kind === 'agent' && ownSubagent(event.actor.name, handed.actor.name)) continue;
    const changes = event.data.changes;
    if (typeof changes !== 'object' || changes === null) continue;
    for (const [field, change] of Object.entries(changes)) {
      if (!isRequest(field)) continue;
      last = event;
      const { from, to } = change as { from?: unknown; to?: unknown };
      const known = merged.get(field);
      merged.set(field, { field, from: known ? known.from : text(from), to: text(to) });
    }
  }
  const changes = [...merged.values()].filter(({ from, to }) => from !== to);
  if (!last || changes.length === 0) return undefined;
  return {
    handedAt: handed.at,
    handedBy: handed.actor.name,
    changedAt: last.at,
    by: last.actor.name,
    changes,
  };
}
