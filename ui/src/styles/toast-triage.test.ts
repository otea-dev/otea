import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Field study s-real (D-5dc01e): on the desk the toast stands at the foot of the page, and in Triage
// the foot is where a tall card keeps Aprobar and Devolver: «You approved … Undo» covered the buttons
// of the next card, and three taps in a row were caught by it. Like the reader's, it goes to the top
// bar there, which has only the mark in the middle.

const css = readFileSync(new URL('./pops.css', import.meta.url), 'utf8')
  .replace(/\r/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of every rule whose selector list holds `selector`, inside the media query that
// starts with `media`.
function rules(media: string, selector: string): string {
  const at = css.indexOf(`@media ${media}`);
  if (at < 0) return '';
  let depth = 0;
  let end = at;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const inside = css.slice(at, end);
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(inside); m; m = re.exec(inside)) {
    const sels = (m[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2] ?? '');
  }
  return out.join(';');
}

describe('a toast over Triage on the desk', () => {
  it('stands in the top bar, off the decisions at the foot of the card', () => {
    const r = rules('(min-width: 721px)', 'body:has(.tri) .toast');
    expect(r).toMatch(/top:\s*8px/);
    expect(r).toMatch(/bottom:\s*auto/);
  });
});
