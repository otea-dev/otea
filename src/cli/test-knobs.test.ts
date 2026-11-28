import { describe, expect, it } from 'vitest';
import { ownerCheckMsOf } from './owner.ts';
import { probeTimeoutOf } from './probe.ts';

// Two waits a test may shorten for the processes it spawns (a server that never answers, a server
// outliving its starter) and nothing else may change: the product keeps its own, and no value in
// the environment can make either longer, or so short that it spins.
describe('the waits a test may shorten', () => {
  it('keeps the product’s wait when nothing, or nothing usable, is set', () => {
    for (const env of [{}, { OTEA_PROBE_TIMEOUT_MS: '' }, { OTEA_PROBE_TIMEOUT_MS: 'soon' }]) {
      expect(probeTimeoutOf(env)).toBe(2000);
    }
    for (const env of [{}, { OTEA_OWNER_CHECK_MS: '' }, { OTEA_OWNER_CHECK_MS: 'soon' }]) {
      expect(ownerCheckMsOf(env)).toBe(5000);
    }
  });

  it('shortens the wait to what is asked, down to a floor, and never lengthens it', () => {
    expect(probeTimeoutOf({ OTEA_PROBE_TIMEOUT_MS: '300' })).toBe(300);
    expect(probeTimeoutOf({ OTEA_PROBE_TIMEOUT_MS: '1' })).toBe(200);
    expect(probeTimeoutOf({ OTEA_PROBE_TIMEOUT_MS: '60000' })).toBe(2000);
    expect(ownerCheckMsOf({ OTEA_OWNER_CHECK_MS: '200' })).toBe(200);
    expect(ownerCheckMsOf({ OTEA_OWNER_CHECK_MS: '0' })).toBe(100);
    expect(ownerCheckMsOf({ OTEA_OWNER_CHECK_MS: '600000' })).toBe(5000);
  });
});
