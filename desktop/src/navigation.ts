// Where the window may go. It shows two things: the project's page on the one otea serve, and the
// picker (a file of the app). Anything else is somebody else's page, and it must not get a window
// that carries the preload's bridge: a link, a redirect or `location=` that leaves for another
// origin is held, and a web link opens in the system browser instead.
import { fileURLToPath } from 'node:url';
import { samePath } from './pick.ts';

export type Verdict = 'allow' | 'external' | 'block';

// The one boundary for what leaves the app (a link, `window.open`, a navigation). It is a scheme
// check, not an allowlist of hosts: an item's content links anywhere, so a list of hosts would break
// ordinary links. What makes it safe is that only http(s) goes, without credentials, and that the
// system browser it goes to is another process with no preload, no bridge and no app privileges.
// `file:`, `javascript:`, `data:` and the OS's protocol handlers (`ms-msdt:`, `smb:`) never do.
export function externalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function sameFile(url: URL, file: string): boolean {
  try {
    return samePath(fileURLToPath(url), fileURLToPath(file));
  } catch {
    return false;
  }
}

// `serverUrl`: the open project's page, when there is one; `pickerUrl`: the picker's file URL.
export function navigationVerdict(
  target: string,
  where: { serverUrl?: string | undefined; pickerUrl: string },
): Verdict {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'block';
  }
  if (url.protocol === 'file:') return sameFile(url, where.pickerUrl) ? 'allow' : 'block';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'block';
  if (where.serverUrl !== undefined && url.origin === originOf(where.serverUrl)) return 'allow';
  return externalUrl(target) === undefined ? 'block' : 'external';
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
