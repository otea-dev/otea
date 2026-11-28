// The main process's own view of the items: /api/items and /api/collections, read again on every
// change the live stream announces. It keeps working while the window is closed to the tray. And
// the notices the server tells the desktop app, for the system's notifications.
import type { Pending } from '../../src/core/pending.ts';
import type { DeskItem } from './state.ts';

// `pending`: what Otea counts that is no item (GET /api/pending), so the tray and the rail say one
// number; absent from a server that does not say.
export type Snapshot = { items: DeskItem[]; collections: string[]; pending?: Pending };

export type Watch = { close(): void };

export type WatchEvents = {
  onSnapshot(snapshot: Snapshot): void;
  onConnection(connected: boolean): void;
};

const MAX_BACKOFF_MS = 10_000;

// The server answers its API to a signed-in browser or a paired device only: the main process reads
// as the window does, with the session `cookie` the sign-in sets (see sessionCookie, server.ts).
async function getJson<T>(url: string, cookie: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json', cookie } });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function isPending(value: unknown): value is Pending {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

export async function readSnapshot(
  base: string,
  cookie: string,
  signal: AbortSignal,
): Promise<Snapshot> {
  const [items, collections, pending] = await Promise.all([
    getJson<DeskItem[]>(`${base}/api/items`, cookie, signal),
    getJson<{ name: string }[]>(`${base}/api/collections`, cookie, signal),
    getJson<unknown>(`${base}/api/pending`, cookie, signal).catch(() => undefined),
  ]);
  const snapshot: Snapshot = { items, collections: collections.map((each) => each.name) };
  // Read defensively: an older server has no such route, and its answer is no list of entries.
  if (isPending(pending)) snapshot.pending = pending;
  return snapshot;
}

export type SseMessage = { event: string; data: string };

// The server-sent events in a chunk of the stream, with their data, and what is left unfinished.
export function sseMessages(buffer: string): { messages: SseMessage[]; rest: string } {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages = blocks.flatMap((block) => {
    const lines = block.split('\n');
    const line = lines.find((each) => each.startsWith('event:'));
    if (!line) return [];
    const data = lines
      .filter((each) => each.startsWith('data:'))
      .map((each) => each.slice('data:'.length).replace(/^ /, ''))
      .join('\n');
    return [{ event: line.slice('event:'.length).trim(), data }];
  });
  return { messages, rest };
}

// The names of the server-sent events in a chunk of the stream, and what is left unfinished.
export function sseEvents(buffer: string): { events: string[]; rest: string } {
  const { messages, rest } = sseMessages(buffer);
  return { events: messages.map(({ event }) => event), rest };
}

// Follows a stream of server-sent events until stopped, connecting again (slower each time) when
// the server goes away or restarts.
function keepFollowing(
  url: string,
  cookie: string,
  stop: AbortSignal,
  onMessage: (message: SseMessage) => Promise<void> | void,
  onLost: () => void,
): void {
  const follow = async () => {
    const response = await fetch(url, {
      signal: stop,
      headers: { accept: 'text/event-stream', cookie },
    });
    if (!response.ok || !response.body)
      throw new Error(`The live stream answered ${response.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      const parsed = sseMessages(buffer + decoder.decode(chunk, { stream: true }));
      buffer = parsed.rest;
      for (const message of parsed.messages) await onMessage(message);
    }
  };

  void (async () => {
    let backoff = 500;
    while (!stop.aborted) {
      try {
        await follow();
        backoff = 500;
      } catch {
        // the server went away or is restarting: try again, slower each time
      }
      if (stop.aborted) break;
      onLost();
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  })();
}

export function watchItems(base: string, cookie: string, events: WatchEvents): Watch {
  const stop = new AbortController();
  let reading = false;
  let again = false;

  // One read at a time; changes that arrive meanwhile collapse into one more read.
  const refresh = async () => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      do {
        again = false;
        events.onSnapshot(await readSnapshot(base, cookie, stop.signal));
      } while (again && !stop.signal.aborted);
    } finally {
      reading = false;
    }
  };

  keepFollowing(
    `${base}/api/stream`,
    cookie,
    stop.signal,
    async ({ event }) => {
      if (event === 'ready') {
        events.onConnection(true);
        await refresh();
      } else if (event === 'change') void refresh().catch(() => {});
    },
    () => events.onConnection(false),
  );

  return { close: () => stop.abort() };
}

// A place in the app: a project's page at one of its places (`/p/<id>/#/i/T-1`), or this page's.
const PLACE = /^(?:\/p\/[a-z0-9-]+)?\/#\//;

// A notice the server tells the desktop app (Preferencias › Avisos), already in words.
export type DeskNotice = { title: string; body: string; tag: string; url: string };

export function parseNotice(data: string): DeskNotice | undefined {
  try {
    const notice = JSON.parse(data) as Partial<Record<keyof DeskNotice, unknown>>;
    const { title, body, tag, url } = notice;
    if (typeof title !== 'string' || typeof body !== 'string') return undefined;
    return {
      title,
      body,
      tag: typeof tag === 'string' ? tag : '',
      url: typeof url === 'string' && PLACE.test(url) ? url : '/#/',
    };
  } catch {
    return undefined;
  }
}

// The notices for the system's notifications: the server decides what and when (the same as a
// phone's pushes), worded in the system's language until one is chosen in Preferencias.
export function watchNotices(
  base: string,
  cookie: string,
  lang: 'es' | 'en',
  onNotice: (notice: DeskNotice) => void,
): Watch {
  const stop = new AbortController();
  keepFollowing(
    `${base}/api/notify/stream?lang=${lang}`,
    cookie,
    stop.signal,
    ({ event, data }) => {
      if (event !== 'notice') return;
      const notice = parseNotice(data);
      if (notice) onNotice(notice);
    },
    () => {},
  );
  return { close: () => stop.abort() };
}
