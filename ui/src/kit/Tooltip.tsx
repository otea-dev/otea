import { useEffect } from 'react';
import { C } from '../motion/curves.ts';

// The one tooltip (mock:4055-4069): any [data-tip] says its words after 350 ms of hover, or at once
// on keyboard focus; to the right inside the rail, below elsewhere. Words already written next to a
// control (an unfolded rail's rows) need no tip. Mounted once by App.

const ROW = '.nav > .nrow, .nav > button, .nav > a';

// A title that can be long is held to two lines with an ellipsis (lanes.css): a lane row's, or any
// element with `.clamp`. Its whole text is its tip, said only while it is cut. One rule for every
// list, so a long title never takes the room of the rows under it.
export const CLAMPED = '.clamp, .row .t';

// Whether an element's text goes past its box (cut by the clamp or by its width).
export function isCut(box: { scrollHeight: number; clientHeight: number }): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

// A tip is said unless its words are already written beside it: an unfolded rail's row, unless the
// row's tip says more than its label (data-tip-more: a board's yours / open).
export function tipWanted(at: { folded: boolean; row: boolean; more: boolean }): boolean {
  return at.folded || !at.row || at.more;
}

const words = (el: HTMLElement): string =>
  el.dataset.tip ?? (el.matches(CLAMPED) ? (el.textContent ?? '').trim() : '');

function shows(el: HTMLElement): boolean {
  if (!el.isConnected || !words(el)) return false;
  // A clamped title with no tip of its own says its words only when they do not fit.
  if (el.dataset.tip === undefined && !isCut(el)) return false;
  return tipWanted({
    folded: !!el.closest('.app[data-folded]'),
    row: el.matches(ROW),
    more: el.dataset.tipMore !== undefined,
  });
}

export function Tooltip() {
  useEffect(() => {
    let tip: HTMLDivElement | null = null;
    let timer = 0;
    let on: HTMLElement | null = null;
    const show = (el: HTMLElement, wait: number) => {
      clearTimeout(timer);
      on = el;
      timer = window.setTimeout(() => {
        if (!shows(el)) return;
        if (!tip) {
          tip = document.createElement('div');
          tip.className = 'tip';
          tip.setAttribute('role', 'tooltip');
          document.body.appendChild(tip);
        }
        tip.textContent = words(el);
        const r = el.getBoundingClientRect();
        const right = !!el.closest('.rail');
        // Never past the window's edge: a long title's tip is a column up to 380 px wide.
        const at = right ? r.right + 8 : r.left;
        tip.style.left = `${Math.max(8, Math.min(at, window.innerWidth - tip.offsetWidth - 8))}px`;
        tip.style.top = `${right ? r.top + r.height / 2 - 11 : r.bottom + 6}px`;
        tip.animate(
          [
            { opacity: 0, transform: 'translateX(-3px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 240, easing: C.glide, fill: 'both' },
        );
      }, wait);
    };
    const hide = () => {
      clearTimeout(timer);
      on = null;
      const t = tip;
      tip = null;
      t?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 160,
        easing: C.drift,
        fill: 'forwards',
      }).finished.then(
        () => t.remove(),
        () => t.remove(),
      );
    };
    const tipped = `[data-tip], ${CLAMPED}`;
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(tipped);
      if (el === on) return;
      if (el) show(el, 350);
      else hide();
    };
    const focus = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(tipped);
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, 0);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      clearTimeout(timer);
      tip?.remove();
    };
  }, []);
  return null;
}
