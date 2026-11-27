import { describe, expect, it } from 'vitest';
import type { Pending } from '../../../../src/core/pending.ts';
import { ago } from '../../derive/fixtures.ts';
import { renderIn, testApp } from '../../shell/test-app.ts';
import { QueueHold } from './QueueHold.tsx';

const pending = (blocks: Pending['blocks']): Pending => ({
  count: 1,
  entries: [],
  blocks,
  queues: [],
  secretary: null,
});

const hold = {
  first: 'CAM-2',
  title: 'Sort by recent',
  waitsFor: 'review' as const,
  since: ago(60),
  waiting: ['CAM-3', 'CAM-4', 'CAM-5'],
};

// F4 (field study 3): on a board that works straight on main, one review held the whole queue for
// 17 to 25 minutes and nothing said so but «lands after CAM-2» on each row.
describe('what holds a board’s queue', () => {
  it('says on the board which review holds it, and what waits behind it', () => {
    const html = renderIn(
      testApp({ pending: pending([hold]) }),
      <QueueHold ids={['CAM-2', 'CAM-3', 'CAM-4', 'CAM-5']} />,
    );

    expect(html).toContain('CAM-2 waits for your review');
    expect(html).toContain('CAM-3, CAM-4, and CAM-5 wait behind it');
    expect(html).toContain('this board takes one change at a time');
  });

  it('says nothing on a board that holds none of the items', () => {
    const html = renderIn(
      testApp({ pending: pending([hold]) }),
      <QueueHold ids={['ART-1', 'ART-2']} />,
    );

    expect(html).toBe('');
  });

  it('says nothing before Otea has told, or when nothing holds a queue', () => {
    expect(renderIn(testApp(), <QueueHold ids={['CAM-2']} />)).toBe('');
    expect(renderIn(testApp({ pending: pending([]) }), <QueueHold ids={['CAM-2']} />)).toBe('');
  });
});
