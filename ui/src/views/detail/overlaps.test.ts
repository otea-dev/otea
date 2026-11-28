import { describe, expect, it } from 'vitest';
import { type Overlap, overlapNotice } from './overlaps.ts';

const overlap = (id: string, landing = false): Overlap => ({
  id,
  title: `Change ${id}`,
  files: ['src/server.ts', 'src/app/items.ts'],
  landing,
});

// U5 and U4 (field study 4): one orange box per overlapping item filled the phone above the
// evidence. The review says it once.
describe('the notice of items that share files', () => {
  it('says nothing when no item shares them', () => {
    expect(overlapNotice('CHA-1', [])).toBeNull();
  });

  it('keeps one overlap as its own sentence, with nothing to fold', () => {
    const notice = overlapNotice('CHA-1', [overlap('CHA-2')]);

    expect(notice?.text).toContain('CHA-2');
    expect(notice?.each).toEqual([]);
  });

  it('says several in one line naming them, with each one’s files folded', () => {
    const notice = overlapNotice('CHA-1', [
      overlap('CHA-2'),
      overlap('CHA-3', true),
      overlap('CHA-4'),
    ]);

    expect(notice?.text).toMatch(/CHA-2, CHA-3, CHA-4/);
    expect(notice?.each).toHaveLength(3);
    expect(notice?.each.join(' ')).toContain('src/server.ts');
  });
});
