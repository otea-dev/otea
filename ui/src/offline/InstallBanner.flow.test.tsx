// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { buttonNamed, mount, press } from '../test-dom.tsx';
import { InstallBanner } from './InstallBanner.tsx';
import { keepInstallPrompt } from './register.ts';

// P7-F3 through the banner as the phone runs it: Install with a browser prompt that fails.

const app = { phone: true } as unknown as App;
type Prompt = Event & { prompt(): Promise<unknown> };

beforeEach(() => {
  setLanguage('en');
  vi.stubGlobal('navigator', {
    ...navigator,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    maxTouchPoints: 5,
  });
});
afterEach(() => {
  keepInstallPrompt(null);
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Install on the phone banner', () => {
  it('keeps the banner and gives the steps when the browser prompt fails, with no flick before', async () => {
    let fail: (e: Error) => void = () => undefined;
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: () =>
        new Promise((_ok, no) => {
          fail = no;
        }),
    }) as Prompt;
    const view = mount(
      <AppTestProvider value={app}>
        <InstallBanner />
      </AppTestProvider>,
    );
    act(() => keepInstallPrompt(event));
    expect(buttonNamed(view.root, 'Install')).toBeDefined();

    // The browser's dialog is open: the banner still shows Install, not the manual steps.
    await press(buttonNamed(view.root, 'Install'));
    expect(buttonNamed(view.root, 'Install')).toBeDefined();
    expect(view.root.querySelector('[role=status]')).toBeNull();

    // The prompt failed: the steps by hand, the banner still there.
    await act(async () => fail(new Error('no prompt')));
    await act(async () => undefined);
    expect(view.root.querySelector('[role=status]')?.textContent).toContain('by hand');
    expect(view.root.textContent).toContain('Add to Home screen');
    expect(buttonNamed(view.root, 'Install')).toBeUndefined();
    view.unmount();
  });
});
