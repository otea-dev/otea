import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OverlapLine } from './BoardSections.tsx';
import type { Overlap } from './overlaps.ts';

const overlap = (id: string, landing = false): Overlap => ({
  id,
  title: `Change ${id}`,
  files: ['src/server.ts', 'src/app/items.ts'],
  landing,
});

// Field study 6 (D-5ad178): two changes that share files is information for the person, not a
// fault in the one they review. DESIGN keeps the warn colour for a stuck agent or a critical
// severity, so the line is drawn in the neutral tone of a note.
describe('the notice of items that share files', () => {
  it('is drawn as a neutral note, never in the warn tone of a fault', () => {
    for (const overlaps of [[overlap('CHA-2')], [overlap('CHA-2'), overlap('CHA-3', true)]]) {
      const html = renderToStaticMarkup(<OverlapLine item="CHA-1" overlaps={overlaps} />);

      expect(html).toMatch(/class="bstrip [^"]*\bnote\b/);
      expect(html).not.toMatch(/class="bstrip [^"]*\bdrift\b/);
      // Nor the warn icon (a circle with a bang): this is the branch's, not a fault's.
      expect(html).not.toContain('M8 1.75 A6.25');
    }
  });

  it('draws nothing when no item shares files', () => {
    expect(renderToStaticMarkup(<OverlapLine item="CHA-1" overlaps={[]} />)).toBe('');
  });
});
