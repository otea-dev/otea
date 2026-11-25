import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { type ItemRecord, selectItems } from '../store/queries.ts';
import type { Context } from './context.ts';
import { liveBoardOf, liveBoards } from './next.ts';

// Two items whose branches change the same files conflict when the second lands: the first one's
// change is on the base by then, and each conflict was another review round (field study: one item
// took five). Nothing here can know what an item will touch, so it says what is true now, from the
// branches as pushed: the files both change over the same base. Cheap git only, no fetch.

// The branch an item works on and the base it lands in, with the key of that base in its repo (the
// same key the landing order uses): undefined for an item that is closed, on a board that protects
// no branch, or that works straight on its base (no branch of its own to compare).
function lineOf(
  ctx: Context,
  item: ItemRecord,
): { branch: string; base: string; key: string } | undefined {
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
// different bases.
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

// The open items whose pushed branches share files with the item's, the ones landing first.
export function overlapsOf(ctx: Context, item: ItemRecord): Overlap[] {
  if (!ctx.changed || !lineOf(ctx, item)) return [];
  return liveBoards(ctx)
    .flatMap((board) =>
      selectItems(ctx.db, { collection: board.collection }).flatMap((other) => {
        if (other.id === item.id) return [];
        const files = sharedFiles(ctx, item, other);
        if (files.length === 0) return [];
        const position = positionOf(other.state);
        const landing =
          !isClosed(position) && position.phase === 'doing' && isLandStep(board.def, position.step);
        return [{ id: other.id, title: other.title, files, landing }];
      }),
    )
    .sort((a, b) => Number(b.landing) - Number(a.landing) || a.id.localeCompare(b.id));
}

// The files, as many as read in a line.
export function filesText(files: readonly string[]): string {
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

// What is said of one overlap, in a line that ends where the item that lands second must act.
export function overlapText(id: string, overlap: Overlap): string {
  const files = filesText(overlap.files);
  return overlap.landing
    ? `${id} touches the same files as ${overlap.id} (${files}), which lands first: main will hold its change when ${id} lands, so expect to merge main and maybe resolve a conflict.`
    : `${id} touches the same files as ${overlap.id} (${files}), which is open too: whichever lands second must merge main first and may meet a conflict.`;
}
