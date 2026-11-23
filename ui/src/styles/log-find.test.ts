import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// P7-F6: at 390 px the log's search row (field, "1 of 1", two steps) did not fit one line: the count
// broke in two and the last button ran past the edge. The field takes its own line, the rest wraps.

const css = readFileSync(new URL('./evidence.css', import.meta.url), 'utf8').replace(/\r/g, '');
const phone = css.slice(css.indexOf('/* On a phone the search takes its own full line'));
const rule = (selector: string): string => {
  const at = phone.indexOf(`  ${selector} {`);
  const open = phone.indexOf('{', at);
  return at < 0 ? '' : phone.slice(open + 1, phone.indexOf('}', open));
};

describe('the log search on a phone', () => {
  it('wraps its count and steps under the field instead of overflowing', () => {
    expect(rule('.ev-find')).toMatch(/flex-wrap: wrap;/);
    expect(rule('.ev-find-input.input')).toMatch(/flex: 1 1 100%;/);
  });

  it('keeps the count on one line', () => {
    expect(css).toMatch(/\.ev-find-count \{[^}]*white-space: nowrap;/);
  });
});
