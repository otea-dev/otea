import { useSyncExternalStore } from 'react';

// How much of a review shows at first on this browser: «full» (the branch, the diff and what Otea
// checked in their usual places) or «plain» (what changed in words and the pictures first, the
// technical lines folded behind «Detalles técnicos»). The phone is always plain: a person judging
// from a phone is not reading a diff there. Kept in localStorage; a browser that refuses it is full.
export type ReviewDetail = 'full' | 'plain';

export const REVIEW_DETAIL_KEY = 'otea.review.detail';

const listeners = new Set<() => void>();

export function reviewDetail(): ReviewDetail {
  try {
    return window.localStorage.getItem(REVIEW_DETAIL_KEY) === 'plain' ? 'plain' : 'full';
  } catch {
    return 'full';
  }
}

export function setReviewDetail(choice: ReviewDetail): void {
  try {
    window.localStorage.setItem(REVIEW_DETAIL_KEY, choice);
  } catch {
    // Storage refused: the choice lasts until the page is closed, through the listeners below.
    memory = choice;
  }
  for (const fn of listeners) fn();
}

let memory: ReviewDetail | undefined;

const read = (): ReviewDetail => {
  const kept = reviewDetail();
  return kept === 'full' && memory ? memory : kept;
};

// Whether the review is in plain words here: always on a phone, else as the person chose.
export function usePlainReview(phone: boolean): boolean {
  const choice = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => 'full' as ReviewDetail,
  );
  return phone || choice === 'plain';
}
