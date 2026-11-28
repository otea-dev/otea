import type { Advice, AdviceKind } from '../../../../src/core/board/advice.ts';
import { t } from '../../i18n/i18n.ts';
import {
  type DiffFilesOff,
  type DiffOffTip,
  diffFilesText,
  diffOffTipText,
  useDiffFiles,
  useDiffOffTip,
} from './diff-tip.ts';

// What every page that offers Aprobar on an item in review says beside it, from this one source (s-real2
// D-13751d, D-00b356): that the attached diff is not what lands, and what the secretary or the
// delivering agent advised. Said in the words of someone who does not read code; the technical
// sentences ride along as `detail`, one tap away. Advice and warnings never block the move: the
// person's act stays theirs.

export type ReviewNotice = {
  key: 'diff' | 'advice';
  // Advice: whether it recommends sending the item back or only doubts it.
  kind?: AdviceKind;
  text: string;
  detail: readonly string[];
};

function adviceText(advice: Advice, agent: string): string {
  const who = advice.secretary ? 'secretary' : 'agent';
  const kind = advice.kind === 'send_back' ? 'sendBack' : 'doubt';
  return t(`rvn.advice.${kind}.${who}`, { agent, note: advice.note });
}

export function reviewNotices(o: {
  advice?: Advice | undefined;
  off: DiffOffTip | null;
  files: DiffFilesOff | null;
}): ReviewNotice[] {
  const notices: ReviewNotice[] = [];
  if (o.advice) {
    notices.push({
      key: 'advice',
      kind: o.advice.kind,
      text: adviceText(o.advice, o.advice.by),
      detail: [],
    });
  }
  const detail = [o.off ? diffOffTipText(o.off) : '', o.files ? diffFilesText(o.files) : ''].filter(
    Boolean,
  );
  if (detail.length > 0) notices.push({ key: 'diff', text: t('rvn.diff'), detail });
  return notices;
}

// The id a notice carries, for the button that offers Aprobar to be described by it.
export const noticeIdOf = (item: string, key: ReviewNotice['key']): string => `rvn-${item}-${key}`;

// The notices of an item a page offers to approve: the advice it carries (the server sends it only
// while the item waits for the person), and, while `branch` (its delivery is a branch the person
// reviews), what the PC says of its attached diff. Asked again whenever the item changes.
export function useReviewNotices(
  item: { id: string; updatedAt: string; advice?: Advice | undefined },
  branch: boolean,
): ReviewNotice[] {
  const off = useDiffOffTip(item.id, branch, item.updatedAt);
  const files = useDiffFiles(item.id, branch, item.updatedAt);
  return reviewNotices({
    advice: item.advice,
    off: branch ? off : null,
    files: branch ? files : null,
  });
}
