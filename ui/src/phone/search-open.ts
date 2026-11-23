import { useSyncExternalStore } from 'react';

// Whether the phone's search sheet is open: the magnifier in the top bar opens it, the sheet closes
// it. Each opening starts blank (`seq`).
type SearchState = { open: boolean; seq: number };

let state: SearchState = { open: false, seq: 0 };
const listeners = new Set<() => void>();

function set(next: SearchState) {
  state = next;
  for (const fn of [...listeners]) fn();
}

export function openSearch(): void {
  set({ open: true, seq: state.seq + 1 });
}

export function closeSearch(): void {
  if (state.open) set({ ...state, open: false });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useSearchOpen(): SearchState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
