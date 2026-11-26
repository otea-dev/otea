import type { DatabaseSync } from 'node:sqlite';
import { dataVersion } from '../store/database.ts';

export type Listener = () => void;

export type ChangeFeed = {
  subscribe(listener: Listener): () => void;
  notify(): void;
  close(): void;
};

// What the clock alone changes: no write announces it, so it is looked at on a timer.
export type ClockWatch = {
  // What is true now, in one string; listeners are told when it differs from the last look.
  signature: () => string;
  everyMs: number;
};

export function createChangeFeed(
  db: DatabaseSync,
  intervalMs = 250,
  watch?: ClockWatch,
): ChangeFeed {
  const listeners = new Set<Listener>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let version = 0;
  let seen: string | undefined;
  let looked = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  // A process that ended writes nothing (a secretary killed with its session): the desk is told
  // by looking, now and then, at what depends on the clock and on the processes.
  const look = () => {
    if (!watch || Date.now() - looked < watch.everyMs) return false;
    looked = Date.now();
    let now: string;
    try {
      now = watch.signature();
    } catch {
      return false;
    }
    const changed = seen !== undefined && now !== seen;
    seen = now;
    return changed;
  };

  const poll = () => {
    const current = dataVersion(db);
    const written = current !== version;
    version = current;
    if (look() || written) notify();
  };

  const start = () => {
    version = dataVersion(db);
    looked = 0;
    seen = undefined;
    look();
    timer = setInterval(poll, intervalMs);
  };

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!timer) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    notify,
    close() {
      listeners.clear();
      stop();
    },
  };
}
