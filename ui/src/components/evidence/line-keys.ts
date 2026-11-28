// The lines of a diff, a log or a text, reached with the keys when a note can be left on one: a
// click picks a line, and Enter picks the line that has the focus. The lines are one Tab stop for
// the whole file (the one last on, else the first); the arrows move from line to line. Only the
// reader that takes a note makes its lines stops: the page's own diff stays a read.

// A line a note can be on: not a hunk's header, a note about the file, or the empty side of a row.
const LINE = '.ev-line:not([data-kind="hunk"]):not([data-kind="note"]):not([data-kind="none"])';

// The lines that can be reached now: a file folded shut hides its lines.
export function lineStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(LINE)].filter(
    (line) => !line.closest('details:not([open])'),
  );
}

// Where an arrow or Home or End moves to from the line at `at`; null for any other key.
export function lineStep(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

// Marks the lines under `root` as the stops, and again as lines come (a text is fetched before it
// is drawn, a file opens). Returns what stops it.
export function keepLineStops(root: HTMLElement): () => void {
  const mark = () => {
    const lines = lineStops(root);
    const current = lines.find((line) => line.getAttribute('tabindex') === '0') ?? lines[0];
    for (const line of lines) {
      line.setAttribute('role', 'button');
      line.setAttribute('tabindex', line === current ? '0' : '-1');
    }
  };
  // The line that has the focus is the one Tab comes back to.
  const focused = (event: FocusEvent) => {
    const line = (event.target as Element).closest<HTMLElement>(LINE);
    if (!line || !root.contains(line)) return;
    for (const other of lineStops(root))
      other.setAttribute('tabindex', other === line ? '0' : '-1');
  };
  mark();
  root.addEventListener('focusin', focused);
  const watch = typeof MutationObserver === 'undefined' ? null : new MutationObserver(mark);
  watch?.observe(root, { childList: true, subtree: true });
  return () => {
    watch?.disconnect();
    root.removeEventListener('focusin', focused);
    for (const line of root.querySelectorAll(LINE)) {
      line.removeAttribute('role');
      line.removeAttribute('tabindex');
    }
  };
}
