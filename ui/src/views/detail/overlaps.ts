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

// The overlaps of the item while `asking` (it waits for the person's review); none otherwise, and
// while the PC has not answered. Asked again whenever the item changes (`at`).
export function useOverlaps(item: string, asking: boolean, at: string): Overlap[] {
  const [heard, setHeard] = useState<{ item: string; overlaps: Overlap[] }>({
    item,
    overlaps: [],
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchOverlaps(item, abort.signal).then(
      (overlaps) => setHeard({ item, overlaps }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && heard.item === item ? heard.overlaps : [];
}
