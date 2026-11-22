// The window's preload (sandboxed, bundled to preload.cjs): it draws the update notice over any page
// and gives the project picker (file:) and the project's own server page, each only its own few calls
// into the main process.
import { contextBridge, ipcRenderer } from 'electron';
import { clearNotice, drawNotice, type NoticeView } from './notice.ts';

ipcRenderer.on('desktop:notice', (_event, view: NoticeView | null) => {
  const draw = () => {
    if (!view) return clearNotice(document);
    drawNotice(document, view, {
      act: () => ipcRenderer.send('desktop:notice-act'),
      dismiss: () => ipcRenderer.send('desktop:notice-dismiss'),
    });
  };
  if (document.body) draw();
  else window.addEventListener('DOMContentLoaded', draw, { once: true });
});

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('oteaDesktop', {
    state: () => ipcRenderer.invoke('picker:state'),
    openFolder: () => ipcRenderer.invoke('picker:open-folder'),
    createProject: () => ipcRenderer.invoke('picker:create'),
    openRecent: (root: string) => ipcRenderer.invoke('picker:open-recent', root),
    forget: (root: string) => ipcRenderer.invoke('picker:forget', root),
  });
} else if (ipcRenderer.sendSync('desktop:is-desk') === true) {
  // The desk's Preferencias › Avisos: the one desktop preference it shows. Exposed only on the
  // page of the project's own server (main says so, from the frame's URL): any other page the
  // window might reach gets no bridge. The calls themselves are checked again in main.
  contextBridge.exposeInMainWorld('oteaDesktopPrefs', {
    bringToFront: (): Promise<boolean> => ipcRenderer.invoke('prefs:get-front'),
    setBringToFront: (on: boolean): Promise<boolean> => ipcRenderer.invoke('prefs:set-front', on),
  });
}
