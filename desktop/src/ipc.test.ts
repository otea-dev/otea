import { describe, expect, it, vi } from 'vitest';
import { type Desk, type Ipc, type Sender, wirePicker, wirePrefs } from './ipc.ts';
import type { Recent } from './recent.ts';

const PICKER = 'file:///app/dist/picker.html';
const DESK = 'http://127.0.0.1:4486/p/alpha-aaaaaa/';
const STRANGER = 'https://example.com/';

const a: Recent = { root: '/work/a', name: 'A', openedAt: 1 };
const state = { lang: 'en', recents: [a] } as never;

function fakeDesk() {
  return {
    pickerState: vi.fn(() => state),
    pickFolder: vi.fn(async () => state),
    recentProjects: () => [a],
    openRecent: vi.fn(() => state),
    forgetRecent: vi.fn(() => state),
    fromPickerPage: (url: string | undefined) => url === PICKER,
    fromServerPage: (url: string | undefined) => url?.startsWith('http://127.0.0.1:4486/') === true,
    actOnUpdate: vi.fn(),
    dismissNotice: vi.fn(),
    bringToFront: vi.fn(() => false),
    setBringToFront: vi.fn((on: boolean) => on),
  } satisfies Desk;
}

function fakeIpc() {
  const handlers = new Map<string, (event: Sender, arg?: unknown) => unknown>();
  const listeners = new Map<string, (event: Sender) => void>();
  const ipc: Ipc = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    on: (channel, listener) => void listeners.set(channel, listener),
  };
  const from = (url: string | undefined): Sender => ({ senderFrame: url ? { url } : null });
  return {
    ipc,
    // ipcMain.handle: a throw in the handler rejects the call.
    invoke: async (channel: string, url: string | undefined, arg?: unknown) =>
      handlers.get(channel)?.(from(url), arg),
    send: (channel: string, url: string | undefined) => listeners.get(channel)?.(from(url)),
    sendSync: (channel: string, url: string | undefined) => {
      const event = from(url);
      listeners.get(channel)?.(event);
      return event.returnValue;
    },
  };
}

describe('picker:open-recent and picker:forget', () => {
  it('act on a stored recent root, from the picker page', async () => {
    const desk = fakeDesk();
    const { ipc, invoke } = fakeIpc();
    wirePicker(ipc, desk);
    await invoke('picker:open-recent', PICKER, '/work/a');
    await invoke('picker:forget', PICKER, '/work/a');
    expect(desk.openRecent).toHaveBeenCalledWith('/work/a');
    expect(desk.forgetRecent).toHaveBeenCalledWith('/work/a');
  });

  it('refuse a folder that is not a recent one, and a value that is not a string', async () => {
    const desk = fakeDesk();
    const { ipc, invoke } = fakeIpc();
    wirePicker(ipc, desk);
    const args = ['C:\\Windows', '/work', undefined, null, 7, ['/work/a'], { root: '/work/a' }];
    for (const channel of ['picker:open-recent', 'picker:forget']) {
      for (const arg of args) {
        await expect(invoke(channel, PICKER, arg), `${channel} ${String(arg)}`).rejects.toThrow();
      }
    }
    expect(desk.openRecent).not.toHaveBeenCalled();
    expect(desk.forgetRecent).not.toHaveBeenCalled();
  });

  it('answer the picker page only', async () => {
    const desk = fakeDesk();
    const { ipc, invoke } = fakeIpc();
    wirePicker(ipc, desk);
    for (const url of [DESK, STRANGER, 'file:///C:/other.html', undefined]) {
      await expect(invoke('picker:open-recent', url, '/work/a')).rejects.toThrow();
      await expect(invoke('picker:state', url)).rejects.toThrow();
    }
    expect(desk.openRecent).not.toHaveBeenCalled();
  });
});

describe('the update notice calls', () => {
  it('act from the picker page and from the project server page', () => {
    const desk = fakeDesk();
    const { ipc, send } = fakeIpc();
    wirePicker(ipc, desk);
    send('desktop:notice-act', PICKER);
    send('desktop:notice-act', DESK);
    send('desktop:notice-dismiss', PICKER);
    send('desktop:notice-dismiss', DESK);
    expect(desk.actOnUpdate).toHaveBeenCalledTimes(2);
    expect(desk.dismissNotice).toHaveBeenCalledTimes(2);
  });

  it('do nothing for any other page', () => {
    const desk = fakeDesk();
    const { ipc, send } = fakeIpc();
    wirePicker(ipc, desk);
    for (const url of [STRANGER, 'file:///C:/other.html', undefined]) {
      send('desktop:notice-act', url);
      send('desktop:notice-dismiss', url);
    }
    expect(desk.actOnUpdate).not.toHaveBeenCalled();
    expect(desk.dismissNotice).not.toHaveBeenCalled();
  });
});

describe('the preferences calls', () => {
  it('answer the project server page only, with a boolean', async () => {
    const desk = fakeDesk();
    const { ipc, invoke } = fakeIpc();
    wirePrefs(ipc, desk);
    expect(await invoke('prefs:set-front', DESK, true)).toBe(true);
    await expect(invoke('prefs:set-front', DESK, 'yes')).rejects.toThrow();
    await expect(invoke('prefs:get-front', STRANGER)).rejects.toThrow();
    await expect(invoke('prefs:set-front', PICKER, true)).rejects.toThrow();
    expect(desk.setBringToFront).toHaveBeenCalledTimes(1);
  });

  it('tell the preload whether its page is the project server page', () => {
    const { ipc, sendSync } = fakeIpc();
    wirePrefs(ipc, fakeDesk());
    expect(sendSync('desktop:is-desk', DESK)).toBe(true);
    expect(sendSync('desktop:is-desk', STRANGER)).toBe(false);
    expect(sendSync('desktop:is-desk', PICKER)).toBe(false);
    expect(sendSync('desktop:is-desk', undefined)).toBe(false);
  });
});
