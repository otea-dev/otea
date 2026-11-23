// Brings a line to the middle of the log's own box and nothing else: scrollIntoView also moves the
// page and the sheet around it, which on a phone pushed the search field and its count out of
// view while the person stepped through the matches.

type Box = Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'getBoundingClientRect'>;
type Line = Pick<HTMLElement, 'getBoundingClientRect'>;

// The scroll position that puts the line in the middle of the box.
export function centeredTop(box: Box, line: Line): number {
  const inBox = box.getBoundingClientRect();
  const at = line.getBoundingClientRect();
  return box.scrollTop + (at.top - inBox.top) - (box.clientHeight - at.height) / 2;
}

export function centerLine(box: Box, line: Line): void {
  box.scrollTop = Math.max(0, centeredTop(box, line));
}
