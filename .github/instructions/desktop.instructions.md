---
applyTo: "desktop/**"
---

# Electron app (HIGH)

`desktop/` is its own package (own `package.json`, lockfile and `electron-builder.yml`); it shows the desk of `otea serve` in a window and carries the CLI. Read `desktop/README.md` first. Flag:

- **Window security** (`desktop/src/main.ts`, `BrowserWindow`): `contextIsolation: true` and `sandbox: true` stay, `nodeIntegration` stays off, no `webSecurity: false`, `allowRunningInsecureContent`, `enableRemoteModule` or `nodeIntegrationInSubFrames`. Every new window (`raster.ts` too) sets them.
- **Preload** (`desktop/src/preload.ts`): it exposes a small named API through `contextBridge` (`oteaDesktop` for the picker, `oteaDesktopPrefs` for the desk). Flag exposing `ipcRenderer`, a generic `invoke(channel, ...)`, `require`, file or shell access, or a new method that does more than one named thing.
- **IPC in main** (`wirePicker`, `wirePrefs`): every `ipcMain.handle` or `.on` checks the sender (`event.senderFrame.url`: the picker's `file:` page, or the project's own server page via `fromServerPage`) and validates its argument (`booleanArg`, a known path) before acting. Never `String(arg)` into a path, command or URL. Never evaluate a string from the renderer (`eval`, `new Function`, `executeJavaScript` built from renderer data).
- **Navigation:** `shell.openExternal` and `loadURL` only on a URL the app built (the server's sign-in URL, the fixed `RELEASES_URL`), or on `http(s):` links after `setWindowOpenHandler`. Flag `openExternal` on a path, a `file:` or custom scheme, or anything from the page without a scheme check. A new `will-navigate` or redirect path must not leave the project's server origin.
- **Auto-update** (`updates.ts`, `electron-builder.yml`): the feed stays GitHub Releases of `otea-dev/otea`. Flag a changed `publish` provider, owner, repo or URL, a disabled signature or checksum check, `autoDownload` turned on, an update applied without the person's action, or a generic feed URL.
- **Child processes** (`server.ts`, `main.ts`): `execFile` or `spawn` with an argument array, no shell. The CLI runs on Electron as Node (`ELECTRON_RUN_AS_NODE`); do not pass renderer data into its arguments or environment without validation.
- **Installer** (`build/`, `scripts/`, `desktop/README.md` says what is supported): Windows adds `resourcesin` to the user's PATH only, never the machine's, and the uninstaller removes it. Linux: the deb links `/usr/bin/otea` and removes it with the package. macOS: the `/usr/local/bin/otea` link is opt-in, from the tray menu, after asking. Those are fine. Flag any other write outside the user's profile or the app, a change that happens without the person's action, a missing undo, or a download at install time.
- **Settings and recents** (`settings.ts`, `recent.ts`): written only under Electron's `userData`; read back defensively.
- **Tests:** a new pure part of the shell should have a unit test next to it (`desktop/src/*.test.ts`); these run in the root `vitest`. UI changes in the window need a real-window check, which CI does not do: ask for a capture or a note on how it was tried.
