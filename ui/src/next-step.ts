import type { Item } from './types.ts';

// What follows a project's first finished item (Te toca): a calm card with what people usually do
// next. It shows once per project on this device: a press of «Ahora no», or of anything it offers,
// puts it away for good. Kept in the browser, as the other first-run notes are, under the project.

const key = (project: string) => `otea.nextStep.${project}`;

function store(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function nextStepDismissed(project: string): boolean {
  try {
    return store()?.getItem(key(project)) === 'dismissed';
  } catch {
    return false;
  }
}

export function dismissNextStep(project: string): void {
  try {
    store()?.setItem(key(project), 'dismissed');
  } catch {
    // Put away for this page only.
  }
}

const WEEK_MS = 7 * 24 * 3_600_000;

// The card is for the project's first finished item, soon after it: the earliest item that
// reached the last step of its board (a closed state that closes it as done) did so within the
// last week. A project that finished its first item long ago (every project, on the release that
// brought this card) never gets it, and a second finished item is not a first. Only work counts:
// an item of a built-in board (`requests`, the collections of the Pedidos where a board an agent
// drafts waits, closed by publishing it) is nobody's first finished item.
export function firstFinishedRecently(
  items: readonly Item[],
  now: number,
  requests: ReadonlySet<string> = new Set(),
): boolean {
  const done = items
    .filter((item) => item.closes === 'done' && !requests.has(item.collection))
    .map((item) => Date.parse(item.enteredAt ?? item.updatedAt))
    .filter((at) => !Number.isNaN(at));
  return done.length > 0 && Math.min(...done) >= now - WEEK_MS;
}
