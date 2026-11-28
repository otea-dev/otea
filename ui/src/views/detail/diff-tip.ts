import { useEffect, useState } from 'react';
import type { DiffFilesOff } from '../../../../src/server/diff-files.ts';
import type { DiffOffTip } from '../../../../src/server/diff-tip.ts';
import { fetchDiffFiles, fetchDiffOffTip } from '../../api.ts';
import { listOf, t } from '../../i18n/i18n.ts';

// The attached diff of an item in review does not come from the tip handed off on its branch
// (P1-R3-1): the PC compares them (src/server/diff-tip.ts) and the page says so under the branch,
// before the person approves. Approving keeps the tip, not the diff.

export type { DiffFilesOff, DiffOffTip };

// At most this many files are named; the rest are counted.
const NAMED = 3;

export function diffOffTipText(off: DiffOffTip): string {
  const more = off.files.length - NAMED;
  const named = off.files.slice(0, NAMED);
  const files = listOf(more > 0 ? [...named, t('bi.branch.diffOffMore', { count: more })] : named);
  return t('bi.branch.diffOff', {
    files,
    branch: off.branch,
    tip: off.tip,
    count: off.files.length,
  });
}

// Whether the attached diff is off the tip handed off, while `asking` (the item waits for the
// person's review); null otherwise, and while the PC has not answered. Asked again whenever the
// item changes (`at`).
export function useDiffOffTip(item: string, asking: boolean, at: string): DiffOffTip | null {
  const [off, setOff] = useState<{ item: string; off: DiffOffTip | null }>({ item, off: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchDiffOffTip(item, abort.signal).then(
      (heard) => setOff({ item, off: heard }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && off.item === item ? off.off : null;
}

// The files the attached diff names are not those the work handed off changes (P1-F2): the PC
// compares the two lists (src/server/diff-files.ts) and the page names both before the person
// approves; approving is still theirs.
const LISTED = 4;

function filesList(files: readonly string[]): string {
  const more = files.length - LISTED;
  const named = files.slice(0, LISTED);
  return listOf(more > 0 ? [...named, t('bi.branch.diffOffMore', { count: more })] : named);
}

export function diffFilesText(off: DiffFilesOff): string {
  // The same files with other lines (D-492953): the attached file is the agent's, not the branch's.
  if (off.lines) return t('bi.branch.diffLines', { files: filesList(off.landed) });
  const diff =
    off.diff.length === 0
      ? t('bi.branch.diffFilesNone')
      : t('bi.branch.diffFilesNames', { files: filesList(off.diff) });
  const landed =
    off.landed.length === 0
      ? t('bi.branch.diffFilesChangesNone')
      : t('bi.branch.diffFilesChanges', { files: filesList(off.landed) });
  return t('bi.branch.diffFiles', { diff, landed });
}

// Whether the attached diff names other files than the work handed off changes, while `asking`;
// null otherwise, and while the PC has not answered.
export function useDiffFiles(item: string, asking: boolean, at: string): DiffFilesOff | null {
  const [off, setOff] = useState<{ item: string; off: DiffFilesOff | null }>({ item, off: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to the item asks again
  useEffect(() => {
    if (!asking) return;
    const abort = new AbortController();
    fetchDiffFiles(item, abort.signal).then(
      (heard) => setOff({ item, off: heard }),
      () => undefined,
    );
    return () => abort.abort();
  }, [item, asking, at]);
  return asking && off.item === item ? off.off : null;
}
