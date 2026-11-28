// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppTestProvider } from '../../app/context.tsx';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, settle } from '../../test-dom.tsx';
import { Composer } from './Composer.tsx';

// Field study s-final (D-7bb68e): the way to the box that writes to the secretary, from a thread of
// links and cards, was twenty Tabs. «/» is the way, as in a search box.

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  setLanguage('en');
});

const key = async (target: EventTarget, init: KeyboardEventInit) => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
};

describe('the way to the message box by a key', () => {
  it('«/» puts the focus in the box from anywhere that is no box, and writes no slash', async () => {
    page = mount(
      <AppTestProvider value={testApp()}>
        <a href="#x" id="link">
          un enlace
        </a>
        <input id="other" />
        <Composer onSent={() => undefined} />
      </AppTestProvider>,
    );
    await settle();
    const box = page.root.querySelector('.hb-composer textarea');
    const link = page.root.querySelector('#link') as HTMLElement;
    link.focus();
    await key(link, { key: '/' });
    expect(document.activeElement).toBe(box);

    // In a text box of its own the slash is a slash.
    const other = page.root.querySelector('#other') as HTMLElement;
    other.focus();
    await key(other, { key: '/' });
    expect(document.activeElement).toBe(other);

    // With a modifier it is a shortcut of the browser's.
    link.focus();
    await key(link, { key: '/', ctrlKey: true });
    expect(document.activeElement).toBe(link);
  });

  // D-d251b3: a double tap on a suggestion put its words in the box twice.
  it('a suggestion tapped twice at once is put in the box once', async () => {
    page = mount(
      <AppTestProvider value={testApp()}>
        <Composer onSent={() => undefined} />
      </AppTestProvider>,
    );
    await settle();
    const chip = page.root.querySelector('.hb-sugg') as HTMLElement;
    await act(async () => {
      chip.click();
      chip.click();
    });
    const box = page.root.querySelector('.hb-composer textarea') as HTMLTextAreaElement;
    expect(box.value).toBe(chip.textContent);

    // Another suggestion, then, is added after it as ever.
    const other = page.root.querySelectorAll('.hb-sugg')[1] as HTMLElement;
    await act(async () => other.click());
    expect(box.value).toBe(`${chip.textContent} ${other.textContent}`);
  });

  it('leaves it alone while the box is off (read-only, or no PC)', async () => {
    page = mount(
      <AppTestProvider
        value={testApp({
          session: { canWrite: false, canConfigure: false, canManageDevices: false },
        })}
      >
        <button type="button" id="b">
          algo
        </button>
        <Composer onSent={() => undefined} />
      </AppTestProvider>,
    );
    await settle();
    const b = page.root.querySelector('#b') as HTMLElement;
    b.focus();
    await key(b, { key: '/' });
    expect(document.activeElement).toBe(b);
  });
});

// s-real D-a0b4a2: «Anotar idea» is in reach of the box that talks to the secretary, and opens the
// quick note, not a message.
describe('the quick note from the message box', () => {
  it('opens the note form with «Anotar idea», writing nothing in the box', async () => {
    let opened = 0;
    page = mount(
      <AppTestProvider value={testApp({ newItem: () => (opened += 1) })}>
        <Composer onSent={() => undefined} />
      </AppTestProvider>,
    );
    await settle();
    const jot = page.root.querySelector('.hb-jot') as HTMLButtonElement;
    expect(jot.textContent).toContain('Anotar idea');
    await act(async () => jot.click());
    expect(opened).toBe(1);
    const box = page.root.querySelector('.hb-composer textarea') as HTMLTextAreaElement;
    expect(box.value).toBe('');
  });
});
