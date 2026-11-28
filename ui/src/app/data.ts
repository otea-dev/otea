import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withoutUndone } from '../../../src/core/board/history.ts';
import { FEED_DAY_MAX, FEED_SIZE, type FeedEvent, mergeFeed } from '../activity.ts';
import {
  fetchCollections,
  fetchEvents,
  fetchItems,
  fetchPending,
  fetchPresets,
  fetchProject,
  fetchProjects,
  fetchSecretary,
  fetchSession,
} from '../api.ts';
import { currentProjectId } from '../base.ts';
import type { SecretaryView } from '../conversation.ts';
import { type Connection, useBeat, useLive, useRemote, useThrottled } from '../hooks.ts';
import { flushQueue, queueAvailable } from '../offline/queue-store.ts';
import { type SyncState, useSync } from '../offline/sync-state.ts';
import type { Pending } from '../pending.ts';
import type { Agent } from '../presence.ts';
import type { Remote } from '../remote.ts';
import type { CollectionView, Item, PresetView, ProjectOverview, ProjectView } from '../types.ts';
import { useAgents } from '../use-agents.ts';

// Everything the app reads from the server, kept live (moved out of App.tsx): the stream, the
// items, the session, the project and the others on this machine, the boards and presets (read
// again when Studio writes), the agents, and the project's feed of events.

export type Session = { canWrite: boolean; canConfigure: boolean; canManageDevices: boolean };

export type LoadedData = {
  connection: Connection;
  // Tries the PC again now: the stream and every read (the offline line's Reintentar).
  retry: () => void;
  version: number;
  presence: number;
  now: number;
  session: Session;
  // Whether the PC answers, and when it last did: while it does not, the app shows the last data
  // it saw, read-only, and a capture goes to the queue (canCapture).
  sync: SyncState;
  canCapture: boolean;
  project?: ProjectView;
  projects?: ProjectOverview[];
  items: Remote<Item[]>;
  all: Item[];
  collections: CollectionView[];
  // The boards have been read once: a board missing from them is not there.
  collectionsReady: boolean;
  presets: PresetView[];
  presetsRemote: Remote<PresetView[]>;
  agents: Agent[] | null | undefined;
  // What waits for the person, as Otea counts it; undefined until the first answer.
  pending: Pending | undefined;
  // The project's secretary and what waits for it, as GET /api/secretary says; null while the
  // project has none, undefined until the first answer.
  secretary: SecretaryView | null | undefined;
  feed: FeedEvent[];
  studioWrites: number;
  studioChanged(): void;
};

const ready = <T>(r: Remote<T>): T | undefined => (r.status === 'ready' ? r.value : undefined);

const startOfDay = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// The first look at the feed: the newest events, and as many more as it takes to reach back to the
// start of the day when the newest ones are all of today (a busy day holds more than FEED_SIZE).
export async function firstFeed(
  today: number,
  read: (latest: number) => Promise<FeedEvent[]>,
): Promise<FeedEvent[]> {
  let size = FEED_SIZE;
  let events = await read(size);
  while (
    events.length === size &&
    size < FEED_DAY_MAX &&
    Date.parse(events[0]?.at ?? '') >= today
  ) {
    size = Math.min(size * 3, FEED_DAY_MAX);
    events = await read(size);
  }
  return events;
}

// The project's latest events, then the ones after the last on every change.
export function useFeed(version: number): FeedEvent[] {
  const [feed, setFeed] = useState<{ events: FeedEvent[]; loaded: boolean }>({
    events: [],
    loaded: false,
  });
  const current = useRef(feed);
  current.current = feed;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new version means the log grew
  useEffect(() => {
    const controller = new AbortController();
    const { loaded, events } = current.current;
    const today = startOfDay(Date.now());
    const arrive = (arrived: FeedEvent[]) =>
      setFeed((was) => ({ events: mergeFeed(was.events, arrived, today), loaded: true }));
    if (loaded) {
      fetchEvents({ since: events.at(-1)?.id ?? 0 }, controller.signal).then(arrive, () => undefined);
    } else {
      firstFeed(today, (latest) => fetchEvents({ latest }, controller.signal)).then(
        arrive,
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [version]);
  return useMemo(() => withoutUndone(feed.events), [feed.events]);
}

// When the boards are read again: on this window's Studio writes and on every change of the
// project, so a board published elsewhere (another window, the phone) draws its new fields by their
// names (P5-R3-9). Both counts only grow, so their sum changes whenever either does.
// `rereads`: how many times the boards were read again because an item named one the desk did not
// have (newlyUnknown). All three counts only grow.
export function boardsKey(studioWrites: number, version: number, rereads = 0): number {
  return studioWrites + version + rereads;
}

// The boards the items are on that the loaded boards do not include, each once.
export function unknownBoards(
  items: readonly Pick<Item, 'collection'>[],
  collections: readonly Pick<CollectionView, 'name'>[],
): string[] {
  const known = new Set(collections.map((board) => board.name));
  return [...new Set(items.map((item) => item.collection))].filter((name) => !known.has(name));
}

// A board made elsewhere while this page held older answers (or served them from the cache) left
// its items with a hidden step id and no type words. The boards are read again for a set of
// unknown ones the desk has not looked for yet, once: a board that stays unknown (an item whose
// board was archived) does not read them in a loop.
export function newlyUnknown(unknown: readonly string[], looked: string): string | undefined {
  const names = unknown.join('\n');
  return names !== '' && names !== looked ? names : undefined;
}

// Nuevo: online as the session allows; offline into the queue, where there is one, unless the
// session said no. A session never read while the PC answered stays unknown, and the queue still
// takes the capture: the PC refuses it later if it must, and the queue shows that (TS-6).
export function canCaptureNow({
  canWrite,
  offline,
  queue,
}: {
  canWrite: boolean | undefined;
  offline: boolean;
  queue: boolean;
}): boolean {
  if (!offline) return canWrite === true;
  return queue && canWrite !== false;
}

// At most one read of every project's state in this many ms, however fast the items change.
export const PROJECTS_READ_MS = 5_000;

// What waits for you is read at most this often as the project changes (the server also keeps the
// answer while nothing changed).
export const PENDING_READ_MS = 1_500;

export function useAppData(): LoadedData {
  const { connection, version, presence, retry } = useLive();
  const beat = useBeat(30_000);
  const now = useNow(beat);
  const items = useRemote(fetchItems, version, connection);
  const session = useRemote(fetchSession, 0, connection);
  const [studioWrites, setStudioWrites] = useState(0);
  const [rereads, setRereads] = useState(0);
  const looked = useRef('');
  const boards = boardsKey(studioWrites, version, rereads);
  const collections = useRemote(fetchCollections, boards, connection);
  const boardsRead = ready(collections);
  const itemsRead = ready(items);
  const unknown =
    boardsRead && itemsRead ? unknownBoards(itemsRead, boardsRead).join('\n') : undefined;
  useEffect(() => {
    if (unknown === undefined) return;
    if (unknown === '') looked.current = '';
    else if (newlyUnknown(unknown.split('\n'), looked.current) !== undefined) {
      looked.current = unknown;
      setRereads((n) => n + 1);
    }
  }, [unknown]);
  const presets = useRemote(fetchPresets, boards, connection);
  const project = useRemote(fetchProject, 0, connection);
  // Other projects are not on this server's stream: read again as this one changes, and on the beat.
  // The read looks at every project (its items, its agents), so a burst of changes asks once.
  const projectsVersion = useThrottled(version, PROJECTS_READ_MS);
  const projects = useRemote(fetchProjects, projectsVersion * 1000 + beat, connection);
  const agents = useAgents(version, presence, connection);
  // A secretary gone offline sends presence, not a change: both read it again (both only grow).
  // A burst of changes (an agent at work writes often) reads it once per window, the last one.
  const pendingKey = useThrottled(version + presence, PENDING_READ_MS);
  const pending = useRemote(fetchPending, pendingKey, connection);
  // The secretary's state is read here once, on the same trigger, and every screen shows this one:
  // the rail, Hablar, Te toca, the phone's sheet (s-real2, D-51081c: Hablar kept «conectado» after
  // the agents menu had dropped it, because it read the state only when an item changed).
  const secretary = useRemote(fetchSecretary, pendingKey, connection);
  const feed = useFeed(version);
  const studioChanged = useCallback(() => setStudioWrites((n) => n + 1), []);
  // The PC is back (the live stream reconnected): what was captured without it goes now.
  useEffect(() => {
    if (connection === 'live') void flushQueue();
  }, [connection]);
  const s = ready(session);
  const sync = useSync();
  const data: LoadedData = {
    connection,
    retry,
    version,
    presence,
    now,
    session: {
      canWrite: s?.canWrite === true && !sync.offline,
      canConfigure: s?.canConfigure === true,
      canManageDevices: s?.canManageDevices === true,
    },
    sync,
    canCapture: canCaptureNow({
      canWrite: s?.canWrite,
      offline: sync.offline,
      // Outside any project (`/` with nothing saved) a capture has nowhere to go.
      queue: queueAvailable() && currentProjectId() !== undefined,
    }),
    items,
    all: ready(items) ?? [],
    collections: ready(collections) ?? [],
    collectionsReady: collections.status === 'ready',
    presets: ready(presets) ?? [],
    presetsRemote: presets,
    agents,
    pending: ready(pending),
    secretary: ready(secretary),
    feed,
    studioWrites,
    studioChanged,
  };
  const p = ready(project);
  if (p) data.project = p;
  const ps = ready(projects);
  if (ps) data.projects = ps;
  return data;
}

// The time, read again on each beat.
function useNow(beat: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (beat > 0) setNow(Date.now());
  }, [beat]);
  return now;
}
