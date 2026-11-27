import { useEffect, useState } from 'react';
import type { Overlap } from '../../../../src/app/overlap.ts';
import { fetchOverlaps } from '../../api.ts';
import { t } from '../../i18n/i18n.ts';

// Other open items whose pushed branches change the files this one does: whichever lands second
// meets a conflict when it merges main, and each conflict was another review round. The PC compares
// the branches (src/app/overlap.ts) and the review says so before the person approves; approving
// stays theirs.

export type { Overlap };

// The files, as many as read in a line.
function filesText(files: readonly string[]): string {
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3
    ? `${shown} ${t('bi.branch.overlapMore', { n: files.length - 3 })}`
    : shown;
}

export function overlapTexts(item: string, overlaps: readonly Overlap[]): string[] {
  return overlaps.map((overlap) =>
    t(overlap.landing ? 'bi.branch.overlapLanding' : 'bi.branch.overlapOpen', {
      item,
      other: overlap.id,
      files: filesText(overlap.files),
    }),
  );
}

// What the review says of them all: one notice, not a box per item (U5, field study 4). One overlap
// reads as its own sentence; several read as a line naming them, with each one's files folded.
export type OverlapNotice = { text: string; each: string[] };

export function overlapNotice(item: string, overlaps: readonly Overlap[]): OverlapNotice | null {
  const each = overlapTexts(item, overlaps);
  const [first] = each;
  if (first === undefined) return null;
  if (each.length === 1) return { text: first, each: [] };
  const landing = overlaps.filter((overlap) => overlap.landing).length;
  const group = t('bi.branch.overlapGroup', {
    item,
    count: overlaps.length,
    others: overlaps.map(({ id }) => id).join(', '),
  });
  return {
    text: landing === 0 ? group : `${group}${t('bi.branch.overlapFirst', { count: landing })}`,
    each,
  };
}

// The overlaps of the item while `asking` (it waits for the person's review); none otherwise, and
// while the PC has not answered. Asked once on entering the review, not on every change of the
// item: the PC reads what the handoff recorded until a branch moves.
export function useOverlaps(item: string, asking: boolean): Overlap[] {
  const [heard, setHeard] = useState<{ item: string; overlaps: Overlap[] }>({
    item,
    overlaps: [],
  });
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchOverlaps(item, abort.signal).then(
      (overlaps) => setHeard({ item, overlaps }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking]);
  return asking && heard.item === item ? heard.overlaps : [];
}
