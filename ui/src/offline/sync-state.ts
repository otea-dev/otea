import { useSyncExternalStore } from 'react';
import { CLOSED, FROM_CACHE, SAVED_AT } from './sw-routes.ts';

// Whether what the app shows came from the PC just now or is the last it saw: every read the app
// makes tells this store (api.ts). A read the service worker answered from its cache, or one that
// got no answer at all, means the PC does not answer; the next read from the PC means it does.

export type SyncState = {
  offline: boolean;
  // When the app last heard from the PC (ms since the epoch); null before it ever has.
  syncedAt: number | null;
  // The PC answered through its door (Tailscale serve, 502) with nothing behind it: Otea itself
  // is closed there, rather than the PC out of reach.
  closed?: true;
  // The PC answers, and refuses every read: this browser's sign-in ran out (P8-F4). Not offline:
  // the app says so and shows the way back in, never an empty project.
  signedOut?: true;
};

export type Read =
  // `open`: the answer of a call the PC gives anyone (the session's), which says nothing of the
  // sign-in.
  | { kind: 'fresh'; open?: true }
  | { kind: 'cached'; savedAt: number | null; closed?: true }
  | { kind: 'refused' }
  | { kind: 'failed' };

export function afterRead(state: SyncState, read: Read, now: number): SyncState {
  if (read.kind === 'refused') return { offline: false, syncedAt: state.syncedAt, signedOut: true };
  if (read.kind === 'fresh') {
    const kept = read.open === true && state.signedOut === true;
    return kept
      ? { offline: false, syncedAt: now, signedOut: true }
      : { offline: false, syncedAt: now };
  }
  const saved = read.kind === 'cached' ? read.savedAt : null;
  const syncedAt =
    saved === null ? state.syncedAt : Math.max(saved, state.syncedAt ?? Number.NEGATIVE_INFINITY);
  const closed = read.kind === 'cached' && read.closed === true;
  return closed ? { offline: true, syncedAt, closed } : { offline: true, syncedAt };
}

export function readOf(headers: Pick<Headers, 'get'>): Read {
  const from = headers.get(FROM_CACHE);
  if (from === null) return { kind: 'fresh' };
  const saved = Number(headers.get(SAVED_AT));
  const savedAt = Number.isFinite(saved) && saved > 0 ? saved : null;
  return from === CLOSED ? { kind: 'cached', savedAt, closed: true } : { kind: 'cached', savedAt };
}

let state: SyncState = { offline: false, syncedAt: null };
const listeners = new Set<() => void>();

// Opened cold (from a notification, from the home screen), a phone takes seconds to reach the PC:
// the service worker gives up on the first reads after four and serves what it kept, and the PC
// answers a moment later. Offline is not said for that: a read the cache answered, or that got no
// answer, in the first STARTUP_MS of the page counts only if no answer from the PC came by the end
// of it. After that, or once the PC has answered, a failed read says it at once.
export const STARTUP_MS = 7_000;
let startedAt = Date.now();
let answered = false;
let held: Read | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;

function set(next: SyncState) {
  const same =
    next.offline === state.offline &&
    next.syncedAt === state.syncedAt &&
    next.closed === state.closed &&
    next.signedOut === state.signedOut;
  if (same) return;
  state = next;
  for (const fn of [...listeners]) fn();
}

export function noteRead(read: Read, now = Date.now()): void {
  if (read.kind === 'fresh' || read.kind === 'refused') {
    answered = true;
    held = undefined;
  } else if (!answered && now - startedAt < STARTUP_MS) {
    held = read;
    clearTimeout(settle);
    settle = setTimeout(() => settleStartup(), startedAt + STARTUP_MS - now + 1);
    return;
  }
  set(afterRead(state, read, now));
}

// The end of the grace: a PC that has not answered by now is offline, as the last read said.
export function settleStartup(now = Date.now()): void {
  if (answered || held === undefined || now - startedAt < STARTUP_MS) return;
  const read = held;
  held = undefined;
  set(afterRead(state, read, now));
}

export const syncNow = (): SyncState => state;

export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useSync(): SyncState {
  return useSyncExternalStore(subscribe, syncNow, syncNow);
}

// For tests: back to a fresh start.
export function resetSync(now = Date.now() - STARTUP_MS): void {
  clearTimeout(settle);
  state = { offline: false, syncedAt: null };
  startedAt = now;
  answered = false;
  held = undefined;
}
