// «Restart» on an update: the app quits and the installer replaces it silently, which takes several
// seconds with no window at all, so it looked like a crash. Before it quits, a small window says
// «Updating Otea…» and that it reopens by itself, and stays up long enough to be read. Pure: main.ts
// draws the window and hands over the installer.

// How long the notice is up before the app quits: time to read one line, short enough not to feel
// like a delay.
export const NOTICE_MS = 2200;

export async function restartWithNotice(o: {
  // Draws the notice; what it throws never stops the update.
  show: () => void;
  sleep: (ms: number) => Promise<void>;
  // Quits and installs.
  install: () => void;
  // The installer could not be handed over: take the notice down and give the app back, so the
  // person is not left with a notice that never ends and a window that never returns.
  recover: () => void;
}): Promise<void> {
  try {
    o.show();
    await o.sleep(NOTICE_MS);
  } catch {
    // A window that could not be drawn is no reason to leave the update undone.
  }
  try {
    o.install();
  } catch {
    o.recover();
  }
}
