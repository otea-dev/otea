import { useEffect, useState } from 'react';
import type { LocalBehind } from '../../../../src/cli/local-behind.ts';
import { fetchLocalBehind } from '../../api.ts';

// A Done item landed by an agent from a worktree leaves the person's local main where it was, and
// nothing said so (field study 3): while `asking` (the item is Done), the PC asks git whether what
// landed is on the remote's base and not on the local one.

export type { LocalBehind };

// Null while the local base has it, or the PC has not answered. Asked again whenever the item
// changes (`at`).
export function useLocalBehind(item: string, asking: boolean, at: string): LocalBehind | null {
  const [behind, setBehind] = useState<{ item: string; behind: LocalBehind | null }>({
    item,
    behind: null,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchLocalBehind(item, abort.signal).then(
      (heard) => setBehind({ item, behind: heard }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && behind.item === item ? behind.behind : null;
}
