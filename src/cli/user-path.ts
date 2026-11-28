import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The file a path names that a person or an agent typed in a command, from `cwd`. Git Bash writes
// drive D: as /d/...: its own commands print paths that way (pwd), and with MSYS_NO_PATHCONV=1,
// which Otea's agent text tells an agent to set, they reach otea unconverted, where resolve alone
// makes them D:\d\...: a file nobody has. A path that way is taken as the drive's when nothing is
// at D:\d\... and the file is at D:\...
export function userPath(cwd: string, path: string): string {
  const resolved = resolve(cwd, path);
  if (process.platform !== 'win32') return resolved;
  const msys = /^\/([a-zA-Z])\/(.+)$/.exec(path);
  if (!msys || existsSync(resolved)) return resolved;
  const onDrive = resolve(`${(msys[1] as string).toUpperCase()}:\\`, msys[2] as string);
  return existsSync(onDrive) ? onDrive : resolved;
}
