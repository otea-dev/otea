import { useEffect, useState } from 'react';
import type { Drift } from '../../../../src/server/drift.ts';
import { fetchDrift } from '../../api.ts';
import { listOf, t } from '../../i18n/i18n.ts';

// A clone without Otea's hook can push to the branch while the person reviews it (P3C-R3-1): the
// PC asks the remote (src/server/drift.ts) and the page says so under the branch, before the person
// approves. Approving still approves only what was handed off.

export type { Drift };

export function driftText(drift: Drift): string {
  // On a board kept on main the base is the item's branch (P1-F1): the commits are in this
  // checkout, whoever made them, and a push of the base takes them along.
  if (drift.onBase) {
    if (drift.added.length === 0)
      return t('bi.branch.movedBase', { base: drift.branch, now: drift.now, handed: drift.handed });
    // The first few are named, the rest counted: "…, and 5 more".
    const named = drift.added.map(({ commit, author }) =>
      t('bi.branch.driftBy', { commit, author }),
    );
    const list = listOf(
      drift.more ? [...named, t('bi.branch.diffOffMore', { count: drift.more })] : named,
    );
    return t('bi.branch.driftBase', { base: drift.branch, list, handed: drift.handed });
  }
  if (drift.added.length === 0)
    return t('bi.branch.moved', { now: drift.now, handed: drift.handed });
  const list = drift.added
    .map(({ commit, author }) => t('bi.branch.driftBy', { commit, author }))
    .join(', ');
  return t('bi.branch.drift', { list, handed: drift.handed });
}

// The item's drift while `asking` (its branch waits for the person's review); null otherwise, and
// while the PC has not answered. Asked again whenever the item changes (`at`).
export function useDrift(item: string, asking: boolean, at: string): Drift | null {
  const [drift, setDrift] = useState<{ item: string; drift: Drift | null }>({ item, drift: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchDrift(item, abort.signal).then(
      (heard) => setDrift({ item, drift: heard }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && drift.item === item ? drift.drift : null;
}
