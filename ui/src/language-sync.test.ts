import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOpening, keepLanguage } from './language-sync.ts';

// The desk tells the server its language: on opening only to fill a gap, on every switch for good.
describe('keeping the language on the server', () => {
  beforeEach(forgetOpening);

  it('offers the language on opening and states it on every switch after', async () => {
    const post = vi.fn(async () => {});

    await keepLanguage('es', post);
    await keepLanguage('en', post);
    await keepLanguage('es', post);

    expect(post.mock.calls).toEqual([
      ['es', true],
      ['en', false],
      ['es', false],
    ]);
  });

  it('leaves the screen alone when the server does not answer', async () => {
    const post = vi.fn(async () => {
      throw new Error('away');
    });

    await expect(keepLanguage('en', post)).resolves.toBeUndefined();
  });
});
