// The desktop app's own preferences, which only its window can reach: the preload exposes them as
// window.oteaDesktopPrefs (desktop/src/preload.ts) and the main process keeps them in its
// settings.json. A browser, or a phone, has none.
export type DesktopPrefs = {
  // Bring Otea to the front when an agent asks. Off unless chosen.
  bringToFront(): Promise<boolean>;
  setBringToFront(on: boolean): Promise<boolean>;
};

export function desktopPrefs(): DesktopPrefs | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { oteaDesktopPrefs?: DesktopPrefs }).oteaDesktopPrefs;
}
