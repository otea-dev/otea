// The desktop app's own preferences, kept in settings.json in Electron's user data folder. The
// file is read as untrusted: a value of the wrong type never replaces a default.
export type Settings = {
  // One flash of the taskbar button or bounce of the Dock icon when something new is yours.
  askForAttention: boolean;
  animateTray: boolean;
  // Bring the window to the front when something new is yours (an agent asks). Off by default: the
  // app then only signals, with a notification and the taskbar or Dock count.
  bringToFront: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  askForAttention: true,
  animateTray: true,
  bringToFront: false,
};

export function parseSettings(raw: unknown): Settings {
  const read = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof Settings): boolean =>
    typeof read[key] === 'boolean' ? read[key] : DEFAULT_SETTINGS[key];
  return {
    askForAttention: pick('askForAttention'),
    animateTray: pick('animateTray'),
    bringToFront: pick('bringToFront'),
  };
}

// An argument from the page: only a real boolean counts, never a string or a number.
export function booleanArg(arg: unknown): boolean | undefined {
  return typeof arg === 'boolean' ? arg : undefined;
}

// The calls that read and change the preferences answer the page of the project's own server and
// no other: the window may be sent elsewhere, and a page of another origin has no say here.
export function fromServer(senderUrl: string | undefined, serverUrl: string | undefined): boolean {
  if (senderUrl === undefined || serverUrl === undefined) return false;
  try {
    return new URL(senderUrl).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}
