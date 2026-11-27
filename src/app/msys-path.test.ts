import { tmpdir } from 'node:os';
import { parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oteaHome } from './home.ts';
import { msysDrive } from './msys-path.ts';

// Field study 4, T1c: Git Bash writes drive D: as /d/...; with MSYS_NO_PATHCONV=1 (which Otea's
// agent text tells an agent to set) OTEA_HOME=/d/otea-home reached Otea unconverted, and node on
// Windows read it as D:\d\otea-home, a second home on the current drive.
describe('a Git Bash path for the Otea home', () => {
  const has =
    (...drives: string[]) =>
    (root: string) =>
      drives.includes(root.toLowerCase());

  it('is the same folder on its drive, when the drive is there', () => {
    expect(msysDrive('/d/otea-home', 'win32', has('d:\\'))).toBe('D:\\otea-home');
    expect(msysDrive('/c/Users/me/.otea', 'win32', has('c:\\'))).toBe('C:\\Users\\me\\.otea');
    expect(msysDrive('/d', 'win32', has('d:\\'))).toBe('D:\\');
  });

  it('is left alone where it is no such path: no such drive, another system, another shape', () => {
    expect(msysDrive('/x/otea-home', 'win32', has('d:\\'))).toBeUndefined();
    expect(msysDrive('/d/otea-home', 'linux', has('d:\\'))).toBeUndefined();
    expect(msysDrive('/data/otea-home', 'win32', has('d:\\'))).toBeUndefined();
    expect(msysDrive('D:\\otea-home', 'win32', has('d:\\'))).toBeUndefined();
    expect(msysDrive('relative/home', 'win32', has('d:\\'))).toBeUndefined();
  });

  // Where it runs on Windows: the home Otea opens is the one on the drive.
  it.skipIf(process.platform !== 'win32')('is the home oteaHome gives', () => {
    const drive = parse(tmpdir()).root.slice(0, 1).toLowerCase();

    expect(oteaHome({ OTEA_HOME: `/${drive}/otea-home` }).toLowerCase()).toBe(
      `${drive}:\\otea-home`,
    );
  });
});
