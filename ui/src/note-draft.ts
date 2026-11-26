// The words of a quick note that was not sent (the PC did not answer, or refused it): kept on the
// phone per project, so closing the sheet or reloading the page brings them back instead of losing
// them. Files cannot be kept here (a picked file lives only in the open page); a note that waits
// for the PC with its files goes to the offline queue instead (offline/capture-queue.ts).

const KEY = 'otea.capture.note';
const keyOf = (project: string | undefined) => (project ? `${KEY}:${project}` : KEY);

export function keepNoteDraft(project: string | undefined, text: string): void {
  try {
    localStorage.setItem(keyOf(project), text);
  } catch {
    // Storage off (a private window, blocked site data): the words stay in the open sheet only.
  }
}

export function readNoteDraft(project: string | undefined): string | undefined {
  try {
    const text = localStorage.getItem(keyOf(project));
    return text === null || text.trim() === '' ? undefined : text;
  } catch {
    return undefined;
  }
}

export function clearNoteDraft(project: string | undefined): void {
  try {
    localStorage.removeItem(keyOf(project));
  } catch {
    // Storage off: nothing was kept.
  }
}
