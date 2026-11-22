import { describe, expect, it } from 'vitest';
import { NOTICE_MS, restartWithNotice } from './update-restart.ts';

const parts = (over: Partial<Parameters<typeof restartWithNotice>[0]> = {}) => {
  const calls: string[] = [];
  return {
    calls,
    o: {
      show: () => {
        calls.push('show');
      },
      sleep: async (ms: number) => {
        calls.push(`sleep ${ms}`);
      },
      install: () => {
        calls.push('install');
      },
      recover: () => {
        calls.push('recover');
      },
      ...over,
    },
  };
};

describe('restartWithNotice', () => {
  it('shows the notice, lets it be read, and only then installs', async () => {
    const { calls, o } = parts();
    await restartWithNotice(o);
    expect(calls).toEqual(['show', `sleep ${NOTICE_MS}`, 'install']);
  });

  it('installs even when the notice cannot be drawn', async () => {
    const { calls, o } = parts({
      show: () => {
        throw new Error('no window');
      },
    });
    await restartWithNotice(o);
    expect(calls).toEqual(['install']);
  });

  it('takes the notice down and gives the app back when the installer cannot be handed over', async () => {
    const { calls, o } = parts({
      install: () => {
        throw new Error('no installer');
      },
    });
    await restartWithNotice(o);
    expect(calls).toEqual(['show', `sleep ${NOTICE_MS}`, 'recover']);
  });
});
