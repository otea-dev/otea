// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../../../../src/core/board/testing.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { buttonNamed, type Mounted, mount, press } from '../../test-dom.tsx';
import { GroupCheck } from './ItemPreview.tsx';

// P5-F7: the preview always showed the group as ready, so the short state, in red, could only be
// seen by making a real item. «Ver cómo queda corto» shows it.

const def = creatures();
const group = { id: 'gproof', name: 'Prueba', parts: ['eanim', 'ecode'], min: 2 };

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  setLanguage('en');
});

const row = (review: boolean) => {
  page = mount(<GroupCheck def={def} group={group} review={review} onReveal={() => undefined} />);
  return page.root;
};

describe('the group in the preview of a step', () => {
  it('reads as met in review, and as short, in red, when asked to', async () => {
    const root = row(true);
    expect(root.querySelector('.bsp-hc.ok small')?.textContent).toBe('listo');

    await press(buttonNamed(root, 'Ver cómo queda corto'));
    expect(root.querySelector('.bsp-hc.ok')).toBeNull();
    expect(root.querySelector('.bsp-hc.miss.req small')?.textContent).toBe('1 de 2');

    await press(buttonNamed(root, 'Ver cómo queda completo'));
    expect(root.querySelector('.bsp-hc.ok small')?.textContent).toBe('listo');
  });

  it('offers no other state while the agent is still doing the step', () => {
    const root = row(false);
    expect(root.querySelector('.bsp-hc.miss small')?.textContent).toBe('falta');
    expect(root.querySelector('.bsp-hcswap')).toBeNull();
  });
});
