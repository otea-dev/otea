import type { DatabaseSync } from 'node:sqlite';
import { dataVersion } from '../store/database.ts';

export type Listener = () => void;

// `desk`: a desk's live stream is the one listening. What the clock alone changes is looked at only
// while one is, since only a desk shows it; the notifier has its own, slower tick.
export type SubscribeOptions = { desk?: boolean };

export type ChangeFeed = {
  subscribe(listener: Listener, options?: SubscribeOptions): () => void;
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
  const desks = new Set<Listener>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let version = 0;
  let seen: string | undefined;
  let looked = 0;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  // A process that ended writes nothing (an assistant killed with its session): an open desk is told
  // by looking, now and then, at what depends on the clock and on the processes.
  const look = () => {
    if (!watch || desks.size === 0 || Date.now() - looked < watch.everyMs) return false;
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
    timer = setInterval(poll, intervalMs);
  };

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };

  return {
    subscribe(listener, options = {}) {
      listeners.add(listener);
      if (options.desk) {
        // The first desk takes the baseline the next look is compared with.
        if (desks.size === 0) {
          looked = 0;
          seen = undefined;
        }
        desks.add(listener);
        look();
      }
      if (!timer) start();
      return () => {
        listeners.delete(listener);
        desks.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    notify,
    close() {
      listeners.clear();
      desks.clear();
      stop();
    },
  };
}
