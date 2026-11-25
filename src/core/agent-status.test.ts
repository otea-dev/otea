import { describe, expect, it } from 'vitest';
import { itemUnheard } from './agent-status.ts';

const waiting = { turn: 'agent', setAside: false, anyoneWaits: false, holderWorking: false };

describe('itemUnheard', () => {
  it('is an item on the agent turn that no agent waits for or works on', () => {
    expect(itemUnheard(waiting)).toBe(true);
  });

  it.each([
    ['an agent waits', { anyoneWaits: true }],
    ['its holder is at work', { holderWorking: true }],
    ['an agent set it aside for later', { setAside: true }],
    ['it is the person’s turn', { turn: 'human' }],
    ['it is closed', { turn: 'none' }],
  ])('is not when %s', (_why, over) => {
    expect(itemUnheard({ ...waiting, ...over })).toBe(false);
  });
});
