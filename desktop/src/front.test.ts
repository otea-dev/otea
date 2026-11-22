import { describe, expect, it, vi } from 'vitest';
import { showNotice, type Toast, type Toasts, whenAsked } from './front.ts';
import { booleanArg, DEFAULT_SETTINGS, fromServer, parseSettings } from './settings.ts';

describe('an agent asks', () => {
  it('does not raise the window with the preference off, which is how the app starts', () => {
    const raise = vi.fn();
    whenAsked(parseSettings(undefined), raise);
    whenAsked(parseSettings({ askForAttention: true }), raise);
    expect(raise).not.toHaveBeenCalled();
  });

  it('raises the window once, with the preference on', () => {
    const raise = vi.fn();
    whenAsked(parseSettings({ bringToFront: true }), raise);
    expect(raise).toHaveBeenCalledTimes(1);
  });
});

function fakeToasts(): { toasts: Toasts; made: (Toast & { click(): void })[]; opened: string[] } {
  const made: (Toast & { click(): void })[] = [];
  const opened: string[] = [];
  const toasts: Toasts = {
    supported: true,
    create: () => {
      const listeners: Record<string, () => void> = {};
      const toast = {
        on: (event: string, listener: () => void) => {
          listeners[event] = listener;
        },
        show: () => {},
        close: () => listeners.close?.(),
        click: () => listeners.click?.(),
      };
      made.push(toast);
      return toast;
    },
    open: (url) => opened.push(url),
    shown: new Map(),
  };
  return { toasts, made, opened };
}

const notice = { title: 'Te toca', body: 'T-1', tag: 'T-1', url: '/#/i/T-1' };

describe('a notification', () => {
  it('opens the window on its place when clicked, with the preference off', () => {
    const { toasts, made, opened } = fakeToasts();
    showNotice(toasts, notice);
    expect(opened).toEqual([]);
    made[0]?.click();
    expect(opened).toEqual(['/#/i/T-1']);
  });

  it('shown on its own raises nothing', () => {
    const { toasts, opened } = fakeToasts();
    showNotice(toasts, notice);
    expect(opened).toEqual([]);
  });

  it('is replaced by a later one about the same item, and clicks still reach the new one', () => {
    const { toasts, made, opened } = fakeToasts();
    showNotice(toasts, notice);
    showNotice(toasts, { ...notice, body: 'T-1 again' });
    expect(toasts.shown.size).toBe(1);
    made[0]?.click();
    made[1]?.click();
    expect(opened).toEqual(['/#/i/T-1', '/#/i/T-1']);
  });
});

describe('the preferences', () => {
  it('keeps the window at the back by default', () => {
    expect(DEFAULT_SETTINGS.bringToFront).toBe(false);
  });

  it('takes a saved choice, and ignores what is not a boolean', () => {
    expect(parseSettings({ bringToFront: true }).bringToFront).toBe(true);
    expect(parseSettings({ bringToFront: 'yes', animateTray: 0 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the settings the file already had', () => {
    expect(parseSettings({ askForAttention: false, animateTray: false }).bringToFront).toBe(false);
    expect(parseSettings({ askForAttention: false }).askForAttention).toBe(false);
  });

  it('accepts only a real boolean from the page', () => {
    expect(booleanArg(true)).toBe(true);
    expect(booleanArg(false)).toBe(false);
    for (const bad of ['true', 1, 0, null, undefined, {}, []])
      expect(booleanArg(bad)).toBeUndefined();
  });

  it('answers the project’s own server and no other page', () => {
    const server = 'http://127.0.0.1:4400/p/web-1';
    expect(fromServer('http://127.0.0.1:4400/p/api-2/', server)).toBe(true);
    expect(fromServer('http://127.0.0.1:4401/', server)).toBe(false);
    expect(fromServer('https://example.com/', server)).toBe(false);
    expect(fromServer('file:///app/dist/picker.html', server)).toBe(false);
    expect(fromServer(undefined, server)).toBe(false);
    expect(fromServer('http://127.0.0.1:4400/', undefined)).toBe(false);
    expect(fromServer('not a url', server)).toBe(false);
  });
});
