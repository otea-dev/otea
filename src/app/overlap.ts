import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { type ItemRecord, selectItems } from '../store/queries.ts';
import type { Context, FilesChanged } from './context.ts';
import { liveBoardOf, liveBoards } from './next.ts';
import { recordedWith } from './tips.ts';

// Two items whose branches change the same files conflict when the second lands: the first one's
// change is on the base by then, and each conflict was another review round (field study: one item
// took five). Nothing here can know what an item will touch, so it says what is true now, from the
// branches as pushed: the files both change over the same base. Cheap git only, no fetch.

// A file name as one safe word of a line: control characters (an escape sequence, a line break)
// never reach a terminal or an agent's prompt.
export const safeName = (name: string): string => name.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?');

const memoized = new WeakSet<object>();

// The same context whose answers about files are kept for as long as it is used: one request or
// one scan asks git about each branch once, however many items it compares. Idempotent.
export function scanned<C extends Context>(ctx: C): C {
  const { changed } = ctx;
  if (!changed || memoized.has(changed)) return ctx;
  const known = new Map<string, string[] | undefined>();
  const keep: FilesChanged = (branch, base) => {
    const key = `${branch}\0${base}`;
    if (!known.has(key)) known.set(key, changed(branch, base));
    return known.get(key);
  };
  memoized.add(keep);
  return { ...ctx, changed: keep };
}

type Line = { branch: string; base: string; key: string };

// The branch an item works on and the base it lands in, with the key of that base in its repo (the
// same key the landing order uses): undefined for an item that is closed, on a board that protects
// no branch, or that works straight on its base (no branch of its own to compare).
function lineOf(ctx: Context, item: ItemRecord): Line | undefined {
  const board = liveBoardOf(ctx, item.collection);
  const guard = board && guardedBranch(board.def);
  if (!guard || isClosed(positionOf(item.state))) return undefined;
  const base = guard.guard.base;
  const branch = String(item.fields[guard.id] ?? '').trim();
  if (base === undefined || branch === '' || branch === base) return undefined;
  const repo = guard.guard.repo === undefined ? '' : item.fields[guard.guard.repo];
  return { branch, base, key: `${typeof repo === 'string' ? repo.toLowerCase() : ''}\0${base}` };
}

// The files the branches of two items both change; none when either is not pushed, or they land in
// different bases. Give it a `scanned` context when comparing many.
export function sharedFiles(ctx: Context, a: ItemRecord, b: ItemRecord): string[] {
  const [one, two] = [lineOf(ctx, a), lineOf(ctx, b)];
  if (!ctx.changed || !one || !two || one.key !== two.key) return [];
  const [mine, theirs] = [ctx.changed(one.branch, one.base), ctx.changed(two.branch, two.base)];
  if (!mine || !theirs) return [];
  const there = new Set(theirs);
  return mine.filter((file) => there.has(file));
}

// Another open item that changes files the item changes too. `landing`: it is on a land step, so
// it lands before the item does.
export type Overlap = { id: string; title: string; files: string[]; landing: boolean };

// The other open items on the item's base, with the board each is on.
function peersOf(ctx: Context, item: ItemRecord) {
  const own = lineOf(ctx, item);
  if (!own) return undefined;
  const peers = liveBoards(ctx).flatMap((board) =>
    selectItems(ctx.db, { collection: board.collection }).flatMap((other) => {
      const line = other.id === item.id ? undefined : lineOf(ctx, other);
      return line?.key === own.key ? [{ other, board, line }] : [];
    }),
  );
  return { own, peers };
}

// The open items whose pushed branches share files with the item's, the ones landing first, worked
// out now.
export function overlapsNow(ctx: Context, item: ItemRecord): Overlap[] {
  const scan = scanned(ctx);
  const found = scan.changed && peersOf(scan, item);
  if (!found) return [];
  return found.peers
    .flatMap(({ other, board }) => {
      const files = sharedFiles(scan, item, other);
      if (files.length === 0) return [];
      const position = positionOf(other.state);
      const landing =
        !isClosed(position) && position.phase === 'doing' && isLandStep(board.def, position.step);
      return [{ id: other.id, title: other.title, files, landing }];
    })
    .sort((a, b) => Number(b.landing) - Number(a.landing) || a.id.localeCompare(b.id));
}

// Where the branches that matter to the item stand, as one string; it changes when any of them
// moves. Undefined when git cannot be asked.
function stampOf(ctx: Context, item: ItemRecord): string | undefined {
  const found = ctx.stamp && peersOf(ctx, item);
  if (!ctx.stamp || !found) return undefined;
  return ctx.stamp(
    [found.own.branch, ...found.peers.map(({ line }) => line.branch)],
    found.own.base,
  );
}

// What a handoff records of the overlaps of its round, with where the branches stood: the review
// reads it back until one of them moves.
export function overlapsRecord(
  ctx: Context,
  item: ItemRecord,
): { stamp: string; list: Overlap[] } | undefined {
  const stamp = stampOf(ctx, item);
  return stamp === undefined ? undefined : { stamp, list: overlapsNow(ctx, item) };
}

// The overlaps the item's review is told: what its handoff recorded while no branch moved since
// (so reading it costs one look at the refs), worked out again once one did.
export function overlapsOf(ctx: Context, item: ItemRecord): Overlap[] {
  const recorded = recordedWith(ctx, item.id)?.overlaps;
  if (recorded && recorded.stamp === stampOf(ctx, item)) return recorded.list as Overlap[];
  return overlapsNow(ctx, item);
}

// The files, as many as read in a line.
export function filesText(files: readonly string[]): string {
  const names = files.map(safeName);
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

// What is said of one overlap, in a line that ends where the item that lands second must act.
export function overlapText(id: string, overlap: Overlap): string {
  const files = filesText(overlap.files);
  return overlap.landing
    ? `${id} touches the same files as ${overlap.id} (${files}), which lands first: main will hold its change when ${id} lands, so expect to merge main and maybe resolve a conflict.`
    : `${id} touches the same files as ${overlap.id} (${files}), which is open too: whichever lands second must merge main first and may meet a conflict.`;
}
