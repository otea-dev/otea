import { useEffect, useState } from 'react';
import type { RoundSame } from '../../../../src/server/round-same.ts';
import { fetchRoundSame } from '../../api.ts';
import { t } from '../../i18n/i18n.ts';

// A round whose work holds the same files as the round it answers (P5-F2): an empty commit and the
// old diff were handed off, and the person could approve a change that never happened. The PC
// compares the tips (src/server/round-same.ts) and the page says so under the branch, before the
// person approves; approving is still theirs.

export type { RoundSame };

export function roundSameText(same: RoundSame): string {
  return t('bi.branch.roundSame', {
    round: same.round,
    earlier: same.earlier,
    branch: same.branch,
  });
}

// The round the item's handoff repeats while `asking` (it waits for the person's review); null
// otherwise, and while the PC has not answered. Asked again whenever the item changes (`at`).
export function useRoundSame(item: string, asking: boolean, at: string): RoundSame | null {
  const [same, setSame] = useState<{ item: string; same: RoundSame | null }>({
    item,
    same: null,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchRoundSame(item, abort.signal).then(
      (heard) => setSame({ item, same: heard }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && same.item === item ? same.same : null;
}
