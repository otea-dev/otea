import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { BranchLine } from './BoardSections.tsx';
import type { BranchStrip } from './board-item.ts';

afterEach(() => setLanguage('en'));

// H3 (field study 4, U7): the review led with a branch name, red boxes about merging main and the
// diff, none of which a person who does not read code can use. Plain, it leads with what the person
// can judge and keeps the technical lines one tap away, folded.
const strip: BranchStrip = { tone: 'ok', key: 'push', value: 'cambio/CAM-5-contador' };

describe('the branch and its notices, in plain words', () => {
  it('folds them behind «Detalles técnicos», closed, saying how many notices wait inside', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      <BranchLine strip={strip} waits="Espera a CAM-2: se integra después." plain />,
    );
    expect(html).toContain('<details class="tech"');
    expect(html).not.toContain('<details class="tech" open');
    expect(html).toContain('Detalles técnicos');
    expect(html).toContain('1 aviso');
    // The branch is still there, a tap away, never lost.
    expect(html).toContain('cambio/CAM-5-contador');
    expect(html).toContain('Espera a CAM-2');
  });

  it('draws them as they are when the review is not plain', () => {
    const html = renderToStaticMarkup(<BranchLine strip={strip} waits="Waits for CAM-2." />);
    expect(html).not.toContain('class="tech"');
    expect(html).toContain('bstrip');
  });

  it('says nothing for a branch nobody knows, plain or not', () => {
    expect(renderToStaticMarkup(<BranchLine strip={null} plain />)).toBe('');
  });
});
