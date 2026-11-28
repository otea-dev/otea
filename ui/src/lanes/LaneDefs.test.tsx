import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LaneDefs } from './LaneDefs.tsx';

// The gradients the lanes paint with are markup written by hand: a browser forgives an attribute
// that touches the one before it, a strict XML reader does not and drops the gradient.
describe('the lanes’ gradients', () => {
  it('are written as markup a strict reader takes: attributes are told apart by a space', () => {
    const tags = renderToStaticMarkup(<LaneDefs />).match(/<[^>]+>/g) ?? [];

    expect(tags.length).toBeGreaterThan(10);
    const loose = tags.filter((tag) => !/^<\/?[A-Za-z]+(\s+[\w:-]+="[^"]*")*\s*\/?>$/.test(tag));
    expect(loose).toEqual([]);
  });
});
