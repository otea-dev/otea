import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { FOCUSABLE } from '../../kit/pop/focus.ts';

// Where the focus is when a sheet sits beside the list. Opened from a control (a row, a chip), it
// goes into the sheet, to the headline (the first control for a form), so a keyboard or a screen
// reader starts reading where the sheet is, not behind it; closed, it goes back to what opened it.
// Stepping to the next or the previous item keeps the focus on that step. An open with no control
// to take the focus from (a link, a pointer on a card) leaves the focus alone.

function focusIn(root: HTMLElement): boolean {
  const first =
    root.querySelector<HTMLElement>('[data-autofocus]') ??
    root.querySelector<HTMLElement>('.headline, h1') ??
    root.querySelector<HTMLElement>(FOCUSABLE);
  if (!first) return false;
  // A headline takes the focus without being a stop of Tab.
  if (!first.matches(FOCUSABLE)) first.setAttribute('tabindex', '-1');
  first.focus({ preventScroll: true });
  return true;
}

export function useSheetFocus(
  sheet: RefObject<HTMLElement | null>,
  shown: string | null,
  content: string,
): { keepNav: (dir: -1 | 1) => void } {
  const opener = useRef<HTMLElement | null>(null);
  const was = useRef<string | null>(null);
  // The sheet opened with a focus to take in, and the content it opened on is not drawn yet.
  const pending = useRef(false);
  const nav = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the sheet opens, closes or changes its content
  useLayoutEffect(() => {
    const root = sheet.current;
    const before = was.current;
    was.current = shown;
    const active = document.activeElement as HTMLElement | null;
    if (shown === null) {
      const back = opener.current;
      opener.current = null;
      pending.current = false;
      if (back?.isConnected && (!active || active === document.body)) {
        back.focus({ preventScroll: true });
      }
      return;
    }
    if (!root) return;
    if (before === null) {
      const from = active && active !== document.body && !root.contains(active) ? active : null;
      opener.current = from;
      pending.current = from !== null;
    } else if (nav.current !== null) {
      // The sheet shows the next item: the step that was pressed takes the focus again.
      const step = root.querySelector<HTMLElement>(`[data-nav="${nav.current}"]:not(:disabled)`);
      nav.current = null;
      if (step) {
        step.focus({ preventScroll: true });
        return;
      }
      pending.current = opener.current !== null;
    }
    if (pending.current && focusIn(root)) pending.current = false;
  }, [shown, content]);
  const keepNav = useCallback((dir: -1 | 1) => {
    nav.current = String(dir);
  }, []);
  return { keepNav };
}
