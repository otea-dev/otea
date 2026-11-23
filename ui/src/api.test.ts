import { afterEach, describe, expect, it, vi } from 'vitest';
import { SURFACE_HEADER } from '../../src/core/surface.ts';
import {
  fetchCollections,
  fetchItem,
  fetchItems,
  fetchProject,
  fetchSession,
  freshPairingCode,
  moveItem,
  reassignItem,
  restartItem,
  resumeItem,
  undoMove,
  undoRelease,
} from './api.ts';
import {
  resetSync,
  type SyncState,
  subscribe as subscribeSync,
  syncNow,
} from './offline/sync-state.ts';

// Retomar, Reasignar and their Deshacer, as the UI asks the server.

const calls: { path: string; body: unknown }[] = [];
const ok = { id: 'ERR-7' };

function stubFetch() {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(ok), { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('a stuck item, from the UI', () => {
  it('puts it back in the queue of its step', async () => {
    stubFetch();
    await restartItem('ERR-7');
    expect(calls).toEqual([{ path: '/api/items/ERR-7/restart', body: {} }]);
  });

  it('leaves it for the agent picked', async () => {
    stubFetch();
    await reassignItem('ERR-7', 'quill');
    expect(calls).toEqual([{ path: '/api/items/ERR-7/reassign', body: { agent: 'quill' } }]);
  });

  it('takes either back through the undo route', async () => {
    stubFetch();
    await undoRelease('ERR-7');
    expect(calls).toEqual([{ path: '/api/items/ERR-7/undo', body: { release: true } }]);
  });
});

// P1-S1: the page says it is the page on every write, so the record tells its moves from a direct
// API call made with the same session.
describe('a move, from the UI', () => {
  it('says it comes from the page, as a direct call does not', async () => {
    const heard: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init: RequestInit) => {
        heard.push(new Headers(init.headers));
        return new Response('{}', { status: 200 });
      }),
    );
    await moveItem('ERR-7', 'done', '');
    await undoMove('ERR-7', 'review');
    expect(heard.map((headers) => headers.get(SURFACE_HEADER))).toEqual(['1', '1']);
  });
});

// P7-R3-1: an item an agent set aside for later, taken up again by the person (Retomar).
describe('an item set aside for later, from the UI', () => {
  it('takes it up again through the resume route', async () => {
    stubFetch();
    await resumeItem('ERR-7');
    expect(calls).toEqual([{ path: '/api/items/ERR-7/resume', body: {} }]);
  });
});

// P7-R3-5: the pairing dialog opens on a fresh code, pointed at the network picked.
describe('the pairing dialog, from the UI', () => {
  it('asks for a fresh code when it opens', async () => {
    stubFetch();
    await freshPairingCode();
    await freshPairingCode('192.168.1.24');
    expect(calls).toEqual([
      { path: '/api/lan/code/fresh', body: {} },
      { path: '/api/lan/code/fresh?address=192.168.1.24', body: {} },
    ]);
  });
});

describe('an item opened by its link', () => {
  it('asks for null rather than a 404, and reads null as no such item', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        asked.push(path);
        return new Response('null', { status: 200 });
      }),
    );
    expect(await fetchItem('NOPE-99', new AbortController().signal)).toBeNull();
    expect(asked).toEqual(['/api/items/NOPE-99?missing=null']);
  });
});

// P8-F4: a browser whose sign-in ran out reads 401 «unauthorized» on everything; the app must know
// the session is gone, not take it for an empty project or a PC that does not answer.
describe('a session that ran out, from the UI', () => {
  const refused = () =>
    new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in' } }), {
      status: 401,
    });
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const signal = () => new AbortController().signal;

  afterEach(() => resetSync());

  it('notes it on a refused read, and lifts it on the next read the PC answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => refused()),
    );
    await expect(fetchItems(signal())).rejects.toThrow();
    expect(syncNow().signedOut).toBe(true);
    // Nothing says the PC is down: it answered, and said no.
    expect(syncNow().offline).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer([])),
    );
    await fetchItems(signal());
    expect(syncNow().signedOut).toBeUndefined();
  });

  it('is not lifted by the session read, which the PC answers to anyone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => refused()),
    );
    await expect(fetchItems(signal())).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer({ canWrite: false })),
    );
    await fetchSession(signal());
    expect(syncNow().signedOut).toBe(true);
  });

  // The signed-out page replaces the app: a moment of «not signed out» between two refused reads
  // would mount the app and unmount it again, and drop what was being typed.
  it('never lifts it, nor stamps a sync, while refused reads keep coming, in parallel too', async () => {
    const seen: SyncState[] = [];
    const stop = subscribeSync(() => seen.push(syncNow()));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.endsWith('/api/session') ? answer({ canWrite: false }) : refused(),
      ),
    );
    const reads = () =>
      Promise.allSettled([
        fetchItems(signal()),
        fetchCollections(signal()),
        fetchSession(signal()),
        fetchProject(signal()),
      ]);
    // A refused read stamps no sync time.
    await Promise.allSettled([fetchItems(signal()), fetchCollections(signal())]);
    expect(syncNow()).toEqual({ offline: false, syncedAt: null, signedOut: true });
    await reads();
    // A retry (the page's button, the stream coming back) reads everything again, all at once.
    await Promise.all([reads(), reads()]);
    stop();
    const first = seen.findIndex((state) => state.signedOut === true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(seen.slice(first).every((state) => state.signedOut === true)).toBe(true);
    expect(seen.every((state) => !state.offline)).toBe(true);
  });
});
