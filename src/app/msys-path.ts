import { existsSync } from 'node:fs';

// Git Bash writes drive D: as /d/...: its own commands print paths that way (pwd), and with
// MSYS_NO_PATHCONV=1, which Otea's agent text tells an agent to set, they reach otea unconverted,
// where node on Windows reads /d/x as D:\d\x on the current drive. The path on its drive, when it is
// one of those and that drive is there; undefined for anything else (another system, a path of
// another shape, a drive that does not exist).
export function msysDrive(
  path: string,
  platform: string = process.platform,
  driveExists: (root: string) => boolean = existsSync,
): string | undefined {
  if (platform !== 'win32') return undefined;
  const match = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(path);
  if (!match) return undefined;
  const root = `${(match[1] as string).toUpperCase()}:\\`;
  if (!driveExists(root)) return undefined;
  return `${root}${(match[2] ?? '').replaceAll('/', '\\')}`;
}
