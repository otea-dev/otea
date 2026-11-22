import { describe, expect, it } from 'vitest';
import { NOTICE_MS, restartWithNotice } from './update-restart.ts';

describe('restartWithNotice', () => {
  it('shows the notice, lets it be read, and only then installs', async () => {
    const calls: string[] = [];
    await restartWithNotice({
      show: () => calls.push('show'),
      sleep: async (ms) => {
        calls.push(`sleep ${ms}`);
      },
      install: () => calls.push('install'),
    });
    expect(calls).toEqual(['show', `sleep ${NOTICE_MS}`, 'install']);
  });

  it('installs even when the notice cannot be drawn', async () => {
    let installed = false;
    await restartWithNotice({
      show: () => {
        throw new Error('no window');
      },
      sleep: async () => {},
      install: () => {
        installed = true;
      },
    });
    expect(installed).toBe(true);
  });
});
