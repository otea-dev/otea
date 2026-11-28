// Focus is never left on nothing. Answering a question, approving, sending back or dismissing a
// notice takes the control that held the focus out of the page, and the browser drops the focus to
// the body: the next Tab starts from the top and a screen reader loses its place (pilot 1, a2).
// When that happens the focus goes where the control stood, to the next control there, or to the one
// that follows it in the page, else the one before.
//
// A dialog, a menu and a toast hand the focus back themselves (pop/focus.ts), so they are left to.

import { FOCUSABLE } from './focus.ts';

// What hands its own focus back, or never had it to hold.
const OWN = '[role="dialog"], [role="menu"], [role="alertdialog"], .pop, .toast';

const ELEMENT_NODE = 1;
const FOLLOWING = 4;
const PRECEDING = 2;
const CONTAINED_BY = 16;

function ancestors(el: Element): Element[] {
  const chain: Element[] = [];
  for (let at: Element | null = el; at; at = at.parentElement) chain.push(at);
  return chain;
}

// A control that can be focused now: not disabled, hidden or inert, and drawn.
function reachable(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

// The control to take the focus when the one that held it went: inside what is left of the place it
// stood in, else the next in the page after that place, else the last one before.
export function successor(root: ParentNode, anchor: Element): HTMLElement | null {
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
  const inside = list.find((el) => anchor.contains(el));
  if (inside) return inside;
  const after = list.find(
    (el) =>
      anchor.compareDocumentPosition(el) & FOLLOWING &&
      !(anchor.compareDocumentPosition(el) & CONTAINED_BY),
  );
  if (after) return after;
  return list.findLast((el) => anchor.compareDocumentPosition(el) & PRECEDING) ?? null;
}

// Watches the document; returns what stops it.
export function keepFocus(doc: Document = document): () => void {
  let held: Element[] = [];
  const noted = (event: Event) => {
    const target = event.target;
    held = target instanceof Element && target.nodeType === ELEMENT_NODE ? ancestors(target) : [];
  };
  const check = () => {
    const was = held[0];
    if (!was || was.isConnected) return;
    // The focus went somewhere on its own: nothing is lost.
    const now = doc.activeElement;
    if (now && now !== doc.body) {
      held = ancestors(now);
      return;
    }
    const chain = held;
    held = [];
    if (chain.some((el) => el.matches(OWN))) return;
    const anchor = chain.find((el) => el.isConnected && el !== doc.body) ?? doc.body;
    successor(doc, anchor)?.focus({ preventScroll: true });
  };
  doc.addEventListener('focusin', noted);
  const watch = new MutationObserver(check);
  watch.observe(doc.body, { childList: true, subtree: true });
  return () => {
    doc.removeEventListener('focusin', noted);
    watch.disconnect();
  };
}
