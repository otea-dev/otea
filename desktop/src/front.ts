// When the window comes to the front. Nothing the app learns on its own raises it unless the
// person chose that (Preferencias › Avisos › "Traer Otea al frente cuando un agente pregunta"): a
// new thing that is yours only signals, with the system's notification and the taskbar or Dock
// count. What the person does always raises it: a click on a notification, the tray, the Dock.
import type { DeskNotice } from './live.ts';

// Something new became the person's (an agent asked): the window comes forward only when asked to.
export function whenAsked(settings: { bringToFront: boolean }, raise: () => void): void {
  if (settings.bringToFront) raise();
}

// The slice of Electron's Notification the app uses.
export type Toast = {
  on(event: 'click' | 'close', listener: () => void): unknown;
  show(): void;
  close(): void;
};

export type Toasts = {
  supported: boolean;
  create(options: { title: string; body: string }): Toast;
  // Opens the window on the place: a click is the person asking for it, whatever the preference.
  open(url: string): void;
  // The notifications shown, by tag: a later one about the same item takes the place of the
  // earlier, and holding them keeps their clicks alive.
  shown: Map<string, Toast>;
};

export function showNotice(toasts: Toasts, notice: DeskNotice): void {
  if (!toasts.supported) return;
  const key = notice.tag || notice.url;
  toasts.shown.get(key)?.close();
  const toast = toasts.create({ title: notice.title, body: notice.body });
  toast.on('click', () => toasts.open(notice.url));
  toast.on('close', () => {
    if (toasts.shown.get(key) === toast) toasts.shown.delete(key);
  });
  toasts.shown.set(key, toast);
  toast.show();
}
