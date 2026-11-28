// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { type Mounted, mount, press, settle } from '../../test-dom.tsx';
import { Attachments } from './Attachments.tsx';

// Pilot 1 (a2): the picture a message came with opens large, with no way to close it in sight, and
// Tab left it for the buttons behind. It is a dialog: it takes the focus, holds it, and says how to
// close it.

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  document.body.replaceChildren();
  setLanguage('en');
});

const picture = {
  id: 7,
  name: 'carrito.png',
  contentType: 'image/png',
  kind: 'image',
  size: 1200,
  sha256: '',
} as const;

const tab = async (from: Element, shift = false) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    from.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

describe('a picture opened large', () => {
  it('is a dialog named for the picture, with a visible way to close it that takes the focus', async () => {
    page = mount(
      <>
        <button type="button" id="before">
          antes
        </button>
        <Attachments files={[picture]} />
      </>,
    );
    const thumb = document.querySelector<HTMLElement>('.hb-pic');
    thumb?.focus();
    await press(thumb);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('carrito.png');
    const close = dialog?.querySelector<HTMLElement>('button');
    expect(close?.textContent).toBe('Cerrar');
    expect(document.activeElement).toBe(close);
  });

  it('keeps Tab inside, both ways', async () => {
    page = mount(<Attachments files={[picture]} />);
    await press(document.querySelector('.hb-pic'));
    await settle();
    const close = document.activeElement as HTMLElement;
    expect(close.closest('[role="dialog"]')).not.toBeNull();
    expect(await tab(close)).toBe(true);
    expect(await tab(close, true)).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('closes with its button, and the focus goes back to the thumbnail', async () => {
    page = mount(<Attachments files={[picture]} />);
    const thumb = document.querySelector<HTMLElement>('.hb-pic');
    thumb?.focus();
    await press(thumb);
    await settle();
    await press(document.activeElement);
    // The dialog leaves with its gesture, then it is gone.
    for (let waited = 0; document.querySelector('[role="dialog"]') && waited < 3000; waited += 100)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(thumb);
  });
});
