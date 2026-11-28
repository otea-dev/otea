// Where the keys are after a review is decided in Triage. The card that held the focus goes (thrown
// away, or dropped to the end of the pass), and the page would leave the focus to fall on the next
// card's Aprobar. It lands on the heading of the card that comes up instead: what it is is the
// first thing heard, and approving it is a Tab away, never an Enter too many.

// Whether the last hand on the page was the keys (the document says it: kit/input-modality.ts;
// nothing said yet counts as the keys).
export function handedByKeys(doc: Document = document): boolean {
  return doc.documentElement.getAttribute('data-input') !== 'pointer';
}

// Puts the focus on the heading of the card on top (or the closing page when no card is left).
// False when there is nothing to land on.
export function focusNewCard(root: ParentNode | null): boolean {
  const heading = root?.querySelector<HTMLElement>('.tcard:not(.under) h2, .tdone h2');
  if (!heading) return false;
  // A heading takes the focus without becoming a stop of Tab.
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  return true;
}
