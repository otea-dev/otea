import { useEffect, useState } from 'react';
import type { MergeOnly } from '../../../../src/app/merge-only.ts';
import { fetchMergeOnly } from '../../api.ts';
import { t } from '../../i18n/i18n.ts';

// An approved item bounced by a landing conflict, whose new round only merges main into the work the
// person approved: the review says so and shows what the merge changed by hand, since the rest was
// approved already or landed through its own review (src/app/merge-only.ts). Approving still takes
// the commit handed off, whole.

export type { MergeOnly };

export function mergeOnlyText(merge: MergeOnly): string {
  const files = merge.files.slice(0, 3).join(', ');
  const key = merge.files.length === 0 ? 'bi.branch.mergeOnlyClean' : 'bi.branch.mergeOnly';
  return t(key, {
    since: merge.since.slice(0, 7),
    tip: merge.tip.slice(0, 7),
    branch: merge.branch,
    files: merge.files.length > 3 ? `${files} …` : files,
  });
}

// The merge-only round of the item while `asking` (it waits for the person's review); null
// otherwise, and while the PC has not answered. Asked again whenever the item changes (`at`).
export function useMergeOnly(item: string, asking: boolean, at: string): MergeOnly | null {
  const [heard, setHeard] = useState<{ item: string; merge: MergeOnly | null }>({
    item,
    merge: null,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchMergeOnly(item, abort.signal).then(
      (merge) => setHeard({ item, merge }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && heard.item === item ? heard.merge : null;
}
