// The projects the app opened, last first, kept in recent-projects.json in Electron's user data
// folder. The app reopens the last one; the picker lists them.
export type Recent = { root: string; name: string; openedAt: number };

const KEEP = 8;

export function remember(list: readonly Recent[], entry: Recent): Recent[] {
  return [entry, ...list.filter(({ root }) => root !== entry.root)].slice(0, KEEP);
}

export function forget(list: readonly Recent[], root: string): Recent[] {
  return list.filter((each) => each.root !== root);
}

// A root the picker page sent: it counts only when it is a string equal to one of the stored
// recent roots, so the page can reopen or forget a project it lists and name no other folder.
export function recentRoot(arg: unknown, list: readonly Recent[]): string | undefined {
  return typeof arg === 'string' && list.some(({ root }) => root === arg) ? arg : undefined;
}

function isRecent(value: unknown): value is Recent {
  const each = value as Partial<Recent> | null;
  return (
    typeof each?.root === 'string' &&
    typeof each.name === 'string' &&
    typeof each.openedAt === 'number'
  );
}

export function parseRecents(value: unknown): Recent[] {
  return Array.isArray(value) ? value.filter(isRecent).slice(0, KEEP) : [];
}

export type First = { kind: 'open'; dir: string } | { kind: 'pick' };

// What the app shows first: the folder it was given, else the last project still on disk, else
// the picker.
export function firstProject(start: {
  asked?: string | undefined;
  recents: readonly Recent[];
  exists(root: string): boolean;
}): First {
  if (start.asked !== undefined) return { kind: 'open', dir: start.asked };
  const last = start.recents.find(({ root }) => start.exists(root));
  return last ? { kind: 'open', dir: last.root } : { kind: 'pick' };
}
