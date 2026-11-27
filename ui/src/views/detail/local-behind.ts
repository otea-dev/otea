import { useEffect, useState } from 'react';
import type { LocalBehind } from '../../../../src/cli/local-behind.ts';
import { fetchLocalBehind } from '../../api.ts';

// A Done item landed by an agent from a worktree leaves the person's local main where it was, and
// nothing said so (field study 3): while `asking` (the item is Done), the PC asks git whether what
// landed is on the remote's base and not on the local one.

export type { LocalBehind };

// Null while the local base has it, or the PC has not answered. Asked again whenever the item
// changes (`at`), and whenever the person comes back to the window: a `git pull` in a terminal
// writes nothing the page hears, so coming back is the moment to look again. A PC that does not
// answer leaves no word standing.
export function useLocalBehind(item: string, asking: boolean, at: string): LocalBehind | null {
  const [behind, setBehind] = useState<{ item: string; behind: LocalBehind | null }>({
    item,
    behind: null,
  });
  const [back, setBack] = useState(0);
  useEffect(() => {
    if (!asking) return;
    const again = () => setBack((n) => n + 1);
    const visible = () => {
      if (document.visibilityState !== 'hidden') again();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [asking]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchLocalBehind(item, abort.signal).then(
      (heard) => setBehind({ item, behind: heard }),
      () => {
        if (!abort.signal.aborted) setBehind({ item, behind: null });
      },
    );
    return () => abort.abort();
  }, [item, asking, at, back]);
  return asking && behind.item === item ? behind.behind : null;
}
