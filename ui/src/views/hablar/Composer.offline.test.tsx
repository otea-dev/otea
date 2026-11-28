// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../../app/context.tsx';
import { setLanguage } from '../../i18n/i18n.ts';
import { ToastHost } from '../../kit/pop/toast.tsx';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, settle, typeInto } from '../../test-dom.tsx';
import { Composer } from './Composer.tsx';

// Field study s-real (D-0607d1): Enter while the connection was cut did nothing, and nothing said
// so: the words stayed in the box and the person could not tell a lost key from a lost message. The
// line under the box that says «sin conexión» can lie below the fold of a small window, so the
// answer to the key is a notice over the page.

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  setLanguage('en');
});

const enter = async (box: Element | null) => {
  await act(async () => {
    box?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await settle();
};

const mountOffline = async (offline: boolean) => {
  page = mount(
    <AppTestProvider value={testApp({ sync: { offline, syncedAt: null } })}>
      <Composer onSent={() => undefined} />
      <ToastHost />
    </AppTestProvider>,
  );
  await settle();
  return page.root.querySelector('.hb-composer textarea') as HTMLTextAreaElement;
};

const said = () =>
  [...document.querySelectorAll('.tmsg:not(.out)')].map((p) => p.textContent).join(' ');

describe('Enter while the connection is cut', () => {
  it('says the message was not sent and that its words stay, and keeps them', async () => {
    const box = await mountOffline(true);
    await typeInto(box, 'Cambia el precio del olivo');
    await enter(box);

    expect(said()).toMatch(/no se envió/i);
    expect(said()).toMatch(/sin conexión|no hay conexión/i);
    expect(box.value).toBe('Cambia el precio del olivo');
  });

  it('says nothing for an Enter on an empty box', async () => {
    const box = await mountOffline(true);
    await enter(box);
    expect(said()).toBe('');
  });
});

// The page does not always know the connection is cut: the send goes, fails, and the box says so on
// the line under it, which a small window (or a zoomed one) keeps below its fold. A notice over the
// page says it where it can be seen; where the line is in sight, it is not said twice.
describe('Enter when the send fails', () => {
  const lineAt = (bottom: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const at = this.classList.contains('hb-err') ? bottom : 0;
      return { top: at - 20, bottom: at, left: 0, right: 0, width: 0, height: 20 } as DOMRect;
    });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const failing = async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const box = await mountOffline(false);
    await typeInto(box, 'Cambia el precio del olivo');
    await enter(box);
    await settle();
  };

  it('says it was not sent over the page when the line under the box is out of sight', async () => {
    lineAt(window.innerHeight + 400);
    await failing();
    expect(page?.root.querySelector('.hb-err')).not.toBeNull();
    expect(said()).toMatch(/no se envió/i);
  });

  it('keeps to the line under the box when it is in sight', async () => {
    lineAt(window.innerHeight - 40);
    await failing();
    expect(page?.root.querySelector('.hb-err')).not.toBeNull();
    expect(said()).toBe('');
  });
});
