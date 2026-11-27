import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { longPathNote } from './long-path.ts';
import { cliAt } from './testing.ts';

// Field study 4, T1c: from about 190 characters of repo path, git on Windows fails every push from
// a worktree under .otea/worktrees/<id> ("fatal: '$GIT_DIR' too big"), which the agent text tells
// agents to use. Otea says so before an agent gets there.
const CONNECT = ['connect', '--cli', '--as', 'ana', '--model', 'm', '--effort', 'high'] as const;

describe('a repo path too long for git worktrees on Windows', () => {
  const long = (bytes: number) => `D:\\${'a'.repeat(bytes - 3)}`;

  it('is said in plain words, with what to do, on Windows only', () => {
    const note = longPathNote(long(180), 'win32');

    expect(note).toContain('180');
    expect(note).toContain('worktree');
    expect(note).toContain('shorter');
    expect(longPathNote(long(180), 'linux')).toBeUndefined();
    expect(longPathNote(long(120), 'win32')).toBeUndefined();
  });

  it('counts bytes, not letters: accents take two', () => {
    const accents = `D:\\${'ñ'.repeat(90)}`;

    expect(longPathNote(accents, 'win32')).toContain('183');
  });

  describe('from otea connect', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
      dir = undefined;
    });

    const deep = (bytes: number): string => {
      const base = mkdtempSync(join(tmpdir(), 'otea-long-'));
      dir = base;
      let path = base;
      while (Buffer.byteLength(path) < bytes) path = join(path, 'carpeta-larga-xxxxxxxxxxxx');
      mkdirSync(path, { recursive: true });
      execFileSync('git', ['init', '-q', path]);
      return path;
    };

    it.skipIf(process.platform !== 'win32')('warns on stderr and still connects', async () => {
      const repo = deep(185);
      const otea = cliAt(repo);
      expect((await otea('init', '--local', '--template', 'none')).code).toBe(0);

      const connected = await otea(...CONNECT);

      expect(connected.code, connected.err).toBe(0);
      expect(connected.err).toContain('shorter path');
    });

    it.skipIf(process.platform !== 'win32')('says nothing for a short path', async () => {
      const repo = deep(60);
      const otea = cliAt(repo);
      await otea('init', '--local', '--template', 'none');

      const connected = await otea(...CONNECT);

      expect(connected.err).not.toContain('shorter path');
    });
  });
});
