import { currentProjectId, LAST_PROJECT_KEY } from './base.ts';
import { DATA_CACHE, dataCacheOf, LAST_PROJECT } from './offline/sw-strategies.ts';

// An installed app remembers the project it had open and opens it again, with its answers kept for
// the times the PC is out of reach. When that project is gone from the PC (the folder was removed,
// the server was set up again), the page stayed on those kept answers with "No llego a tu equipo",
// and Reintentar asked for the same project again. The PC says so (`no_project`); the app then
// forgets the project and goes to `/`, which the PC answers with the last project it does serve.

export const NO_PROJECT = 'no_project';

export type Leave = {
  storage?: Pick<Storage, 'getItem' | 'removeItem'> | undefined;
  caches?: Pick<CacheStorage, 'open' | 'delete'> | undefined;
  go: (url: string) => void;
};

let leaving = false;

function defaults(): Leave {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    storage,
    caches: typeof caches === 'undefined' ? undefined : caches,
    go: (url) => window.location.replace(url),
  };
}

// Forgets `id` (what the page remembers, what the service worker kept of it) and leaves it.
export async function leaveStaleProject(
  id: string | undefined = currentProjectId(),
  { storage, caches: kept, go }: Leave = defaults(),
): Promise<void> {
  if (id === undefined || leaving) return;
  leaving = true;
  try {
    if (storage?.getItem(LAST_PROJECT_KEY) === id) storage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // nowhere to forget it: `/` still asks the PC
  }
  try {
    if (kept) {
      await kept.delete(dataCacheOf(id));
      const data = await kept.open(DATA_CACHE);
      const last = await data.match(LAST_PROJECT);
      if ((await last?.text()) === id) await data.delete(LAST_PROJECT);
    }
  } catch {
    // the cache is only a convenience
  }
  go('/');
}

// For tests: ready to leave again.
export function resetLeaving(): void {
  leaving = false;
}
