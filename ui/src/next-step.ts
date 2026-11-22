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

// The first item to reach the last step of its board (a closed state that closes it as done).
export function hasFinishedItem(items: readonly Item[]): boolean {
  return items.some((item) => item.closes === 'done');
}
