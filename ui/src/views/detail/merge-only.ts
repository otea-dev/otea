import { useEffect, useState } from 'react';
import type { MergeOnly } from '../../../../src/app/merge-only.ts';
import { fetchMergeOnly } from '../../api.ts';
import { t } from '../../i18n/i18n.ts';

// An approved item bounced by a landing conflict, whose new round only merges main into the work the
// person approved: the review says so and shows what the merge changed by hand, since the rest was
// approved already or landed through its own review (src/app/merge-only.ts). Approving still takes
// the commit handed off, whole.

export type { MergeOnly };

// Every file the merge changed is named, none left to "and more": the diff holds all of it.
export function mergeOnlyText(merge: MergeOnly): string {
  const key = merge.files.length === 0 ? 'bi.branch.mergeOnlyClean' : 'bi.branch.mergeOnly';
  return t(key, {
    since: merge.since.slice(0, 7),
    tip: merge.tip.slice(0, 7),
    branch: merge.branch,
    files: merge.files.map((file) => file.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?')).join(', '),
  });
}

// The merge-only round of the item while `asking` (it waits for the person's review); null
// otherwise, and while the PC has not answered. Asked once on entering the review.
export function useMergeOnly(item: string, asking: boolean): MergeOnly | null {
  const [heard, setHeard] = useState<{ item: string; merge: MergeOnly | null }>({
    item,
    merge: null,
  });
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchMergeOnly(item, abort.signal).then(
      (merge) => setHeard({ item, merge }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking]);
  return asking && heard.item === item ? heard.merge : null;
}
