import { useState } from 'react';
import type { MoveChoice } from './moves.ts';

// A move that is allowed but worth a second look (Aprobar with an "at least N of" group short) is
// asked once: the first press says the line and holds the move, the next press for the same line
// lets it through. The line is part of what was asked, so anything that changes it (a file attached
// meanwhile, a group met) asks again or, when nothing is short any more, asks nothing. `key` names
// the item as it stands (id, state, update, files): another key forgets what was asked.
export type Warned = { key: string; to: string; line: string };

// Whether pressing `to` must wait: the line to show when it must, null when it may go.
export function holdFor(warned: Warned | null, key: string, to: string, line: string | null) {
  if (line === null) return null;
  const again = warned?.key === key && warned.to === to && warned.line === line;
  return again ? null : line;
}

// The item as it stands: its place, its last update, and its files (attaching one does not update
// the item, yet changes what is short).
export function cautionKeyOf(item: {
  id: string;
  state: string;
  updatedAt: string;
  evidence: readonly { id: number }[];
}): string {
  return `${item.id}:${item.state}:${item.updatedAt}:${item.evidence.map((e) => e.id).join(',')}`;
}

export type Caution = {
  // Presses a move: the line to show while it waits for a second press, null when it goes.
  press: (choice: MoveChoice) => string | null;
  // The line standing for this item now, shown wherever the person is (the page, the reader).
  line: string;
};

export function useCaution(
  key: string,
  caution: ((choice: MoveChoice) => string | null) | undefined,
): Caution {
  const [warned, setWarned] = useState<Warned | null>(null);
  const press = (choice: MoveChoice) => {
    const line = caution?.(choice) ?? null;
    const hold = holdFor(warned, key, choice.move.to, line);
    if (hold !== null) setWarned({ key, to: choice.move.to, line: hold });
    // Kept once let through: the page's own button, pressed right after the reader's, goes too.
    else if (line === null && warned !== null) setWarned(null);
    return hold;
  };
  return { press, line: warned?.key === key ? warned.line : '' };
}
