// Where the focus goes when the person chooses a place in the rail with the keys (D-ab7560): to the
// page they chose, not left on the row, with the whole rail (and Preferencias at its foot) between
// them and the first thing to read.

// The first match that is still on the page: a view that is leaving stays in the DOM, hidden from a
// reader, while the new one comes in.
export function livePlace(selector: string, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (!el.closest('.leaving, [aria-hidden="true"]')) return el;
  }
  return null;
}

// The focus on a place; a heading takes it without becoming a stop of Tab.
export function focusPlace(el: HTMLElement): void {
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) {
    el.setAttribute('tabindex', '-1');
  }
  el.focus({ preventScroll: false });
}

const HEADING = '.main h1';
const FRAMES = 40;

// After a move to another view: waits (frames, not a fixed time) for the new heading to stand and
// puts the focus on it. `was` is the heading the page had; a view that did not change (the same
// row chosen again) keeps its own. Returns a way to stop waiting.
export function focusContentSoon(
  was: HTMLElement | null = livePlace(HEADING),
  frame: (run: () => void) => unknown = (run) => requestAnimationFrame(run),
): () => void {
  let left = FRAMES;
  let stopped = false;
  const look = () => {
    if (stopped) return;
    const now = livePlace(HEADING);
    if (now && (now !== was || left <= 0)) return focusPlace(now);
    if (--left < 0) return;
    frame(look);
  };
  frame(look);
  return () => {
    stopped = true;
  };
}
