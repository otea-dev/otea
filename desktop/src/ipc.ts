// The main process's side of the preload's calls. Every handler checks who is asking (the frame's
// URL) and what it was asked (the argument's type and value) before it does anything: the window
// may be sent to a page that is not the app's, and a page's argument is never trusted.
import type { PickerState } from './picker.ts';
import { type Recent, recentRoot } from './recent.ts';
import { booleanArg } from './settings.ts';

// The slice of Electron's IpcMainEvent and IpcMainInvokeEvent the handlers read.
export type Sender = { senderFrame?: { url: string } | null; returnValue?: unknown };

// The slice of Electron's ipcMain the handlers use.
export type Ipc = {
  handle(channel: string, listener: (event: Sender, arg?: unknown) => unknown): void;
  on(channel: string, listener: (event: Sender) => void): void;
};

// What the calls reach in the shell.
export type Desk = {
  pickerState(): PickerState;
  pickFolder(create: boolean): Promise<PickerState>;
  recentProjects(): readonly Recent[];
  openRecent(root: string): PickerState;
  forgetRecent(root: string): PickerState;
  // Whether a frame's URL is the picker's page, or the page of the project's own server.
  fromPickerPage(url: string | undefined): boolean;
  fromServerPage(url: string | undefined): boolean;
  actOnUpdate(): void;
  dismissNotice(): void;
  bringToFront(): boolean;
  setBringToFront(on: boolean): boolean;
  // The desktop app's own version (its package's), for the report Settings lets a person copy.
  appVersion(): string;
};

// The picker's calls, answered only for the picker's own page.
export function wirePicker(ipc: Ipc, desk: Desk): void {
  const handle = (channel: string, run: (arg: unknown) => PickerState | Promise<PickerState>) =>
    ipc.handle(channel, (event, arg) => {
      if (!desk.fromPickerPage(event.senderFrame?.url)) throw new Error('not the picker');
      return run(arg);
    });
  // The recent projects' calls name a folder: one the picker lists, never any other.
  const recent = (channel: string, run: (root: string) => PickerState) =>
    handle(channel, (arg) => {
      const root = recentRoot(arg, desk.recentProjects());
      if (root === undefined) throw new Error('not a recent project');
      return run(root);
    });
  handle('picker:state', () => desk.pickerState());
  handle('picker:open-folder', () => desk.pickFolder(false));
  handle('picker:create', () => desk.pickFolder(true));
  recent('picker:open-recent', (root) => desk.openRecent(root));
  recent('picker:forget', (root) => desk.forgetRecent(root));

  // The update notice is drawn over the picker and over the project's page, and over no other.
  const notice = (channel: string, run: () => void) =>
    ipc.on(channel, (event) => {
      const url = event.senderFrame?.url;
      if (desk.fromPickerPage(url) || desk.fromServerPage(url)) run();
    });
  notice('desktop:notice-act', () => desk.actOnUpdate());
  notice('desktop:notice-dismiss', () => desk.dismissNotice());
}

// Preferencias › Avisos asks for the one desktop preference the page shows, and changes it. The
// page of the project's own server only; the argument must be a boolean.
export function wirePrefs(ipc: Ipc, desk: Desk): void {
  const guard = (event: Sender) => {
    if (!desk.fromServerPage(event.senderFrame?.url)) throw new Error('not the desk');
  };
  ipc.handle('prefs:get-front', (event) => {
    guard(event);
    return desk.bringToFront();
  });
  ipc.handle('prefs:set-front', (event, arg) => {
    guard(event);
    const on = booleanArg(arg);
    if (on === undefined) throw new Error('a boolean is expected');
    return desk.setBringToFront(on);
  });
  // Which desktop app this is: a version string, nothing about the machine. Takes no argument.
  ipc.handle('prefs:get-version', (event) => {
    guard(event);
    return desk.appVersion();
  });
  // The preload asks, once per page, whether to expose the preferences bridge: it does only on the
  // page of the project's own server. The answer is a boolean, never the server's address.
  ipc.on('desktop:is-desk', (event) => {
    event.returnValue = desk.fromServerPage(event.senderFrame?.url);
  });
}
