import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// kit/input-modality.ts only says which hand was last on the page (`data-input` on the root): the
// foundation sheet must read it, for every control but a text field (which draws its own ring).
const base = readFileSync(new URL('./base.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

describe('the focus ring', () => {
  it('is drawn for the keys only: a tap leaves none', () => {
    expect(base).toMatch(
      /:root\[data-input="pointer"\] :focus-visible:not\(input, textarea, select, \[contenteditable\]\) \{\s*outline: none;/,
    );
  });

  it('follows the radius of the control it rings, the small one only for a control with none', () => {
    const ring = /(^|\n):focus-visible \{([^}]*)\}/.exec(base)?.[2] ?? '';
    expect(ring).toContain('outline: 2px solid');
    // Forced on the ring's own rule it would round every pill and circle into a 4 px box.
    expect(ring).not.toContain('border-radius');
    expect(base).toMatch(/:where\(:focus-visible\) \{\s*border-radius: 4px;/);
  });
});
