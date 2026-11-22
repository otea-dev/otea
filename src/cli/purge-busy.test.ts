import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeData } from './uninstall.ts';

// A folder something still holds open cannot be deleted (EBUSY on Windows): said, not a crash.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    rmSync: (path: Parameters<typeof fs.rmSync>[0], options?: Parameters<typeof fs.rmSync>[1]) => {
      if (String(path).endsWith('busy')) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${path}'`), {
          code: 'EBUSY',
        });
      }
      return fs.rmSync(path, options);
    },
  };
});

describe('purgeData', () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-busy-')));
    mkdirSync(join(dir, 'busy'));
    mkdirSync(join(dir, 'free'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a folder in use and still deletes the next one, without throwing', () => {
    const steps = purgeData([join(dir, 'busy'), join(dir, 'free')], false);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ changed: false, failed: true });
    expect(steps[0]?.text).toContain('Could not delete the Otea data in');
    expect(steps[0]?.text).toContain('EBUSY');
    expect(steps[1]).toMatchObject({ changed: true });
  });
});
