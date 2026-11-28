import { describe, expect, it } from 'vitest';
import type { FeedEvent } from '../activity.ts';
import type { CollectionView, Item } from '../types.ts';
import { boardsKey, canCaptureNow, firstFeed, newlyUnknown, unknownBoards } from './data.ts';

// s-real2, D-a55c6d: the day's recap read the newest 200 events, so a busy afternoon lost the
// morning's. The first look reads back until it reaches the start of the day.
describe('the first look at the feed', () => {
  const day = Date.parse('2026-11-11T00:00:00Z');
  // A server with `total` events, one a minute, the last at noon; `latest` gives the newest n.
  const server = (total: number) => {
    const all = Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      at: new Date(day + 12 * 3_600_000 - (total - 1 - i) * 60_000).toISOString(),
    })) as unknown as FeedEvent[];
    return async (latest: number) => all.slice(-latest);
  };

  it('reaches back to the start of the day when the newest events are all of today', async () => {
    const events = await firstFeed(day, server(450));
    expect(events).toHaveLength(450);
  });

  it('stops at the newest 200 once they reach into yesterday', async () => {
    const events = await firstFeed(day + 11 * 3_600_000 + 30 * 60_000, server(450));
    expect(events.length).toBeLessThan(450);
    expect(events.length).toBeGreaterThanOrEqual(200);
  });
});

// P5-R3-9: a board published elsewhere (another window, the phone, an agent's change) left this
// desk on the boards it first read, and an item's new field showed by its hidden key («DSI4K2MQ:
// yes»), its Documentos with no section. The boards are read again on every change of the project.
describe('when the desk reads the boards again', () => {
  it('reads them on every change of the project, not only on this window’s Studio writes', () => {
    expect(boardsKey(0, 1)).not.toBe(boardsKey(0, 2));
    expect(boardsKey(1, 1)).not.toBe(boardsKey(0, 1));
  });

  it('keeps them while nothing changed', () => {
    expect(boardsKey(2, 5)).toBe(boardsKey(2, 5));
  });
});

// E1: an item of a board the loaded boards did not know (made through the CLI while this page held
// older answers, or served from the cache) showed its step by the hidden id («sgp22f0j__review»)
// and its type as «item». An item of a board the desk does not have means the boards are old.
describe('boards an item names that the desk does not have', () => {
  const board = (name: string) => ({ name }) as CollectionView;
  const item = (collection: string) => ({ collection }) as Item;

  it('lists each once, in the order the items name them', () => {
    expect(
      unknownBoards(
        [item('Tareas'), item('Cambios'), item('Tareas'), item('Otro')],
        [board('Cambios')],
      ),
    ).toEqual(['Tareas', 'Otro']);
  });

  it('says none when every item is on a board it has', () => {
    expect(unknownBoards([item('Cambios')], [board('Cambios')])).toEqual([]);
  });

  it('reads the boards again for a set of unknown boards it has not looked for, and only once', () => {
    expect(boardsKey(0, 1, 1)).not.toBe(boardsKey(0, 1, 0));
    expect(newlyUnknown(['Tareas'], '')).toBe('Tareas');
    // Looked for already and still unknown (its board was archived): no loop.
    expect(newlyUnknown(['Tareas'], 'Tareas')).toBeUndefined();
    expect(newlyUnknown(['Tareas', 'Otro'], 'Tareas')).toBe('Tareas\nOtro');
    expect(newlyUnknown([], 'Tareas')).toBeUndefined();
  });
});

// TS-6: offline, Nuevo stayed grey whenever the session answer had not been kept, though the queue
// takes the capture and sends it once the PC answers (and says so if the PC then refuses it).
describe('whether Nuevo can capture', () => {
  it('online, as the session allows', () => {
    expect(canCaptureNow({ canWrite: true, offline: false, queue: true })).toBe(true);
    expect(canCaptureNow({ canWrite: undefined, offline: false, queue: true })).toBe(false);
  });

  it('offline, into the queue, unless the session said no', () => {
    expect(canCaptureNow({ canWrite: true, offline: true, queue: true })).toBe(true);
    expect(canCaptureNow({ canWrite: undefined, offline: true, queue: true })).toBe(true);
    expect(canCaptureNow({ canWrite: false, offline: true, queue: true })).toBe(false);
    expect(canCaptureNow({ canWrite: true, offline: true, queue: false })).toBe(false);
  });
});
