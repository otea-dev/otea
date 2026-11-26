import { describe, expect, it } from 'vitest';
import type { Pending, PendingEntry } from '../../../../src/core/pending.ts';
import { ago } from '../../derive/fixtures.ts';
import { renderIn, testApp } from '../../shell/test-app.ts';
import { TeEspera } from './TeEspera.tsx';

const none = () => undefined;

const entries: PendingEntry[] = [
  {
    kind: 'bandeja',
    ref: 'B-1',
    title: 'the Aprobar button is hidden',
    since: ago(40),
    by: 'lia',
    text: 'Which screen?',
    options: ['Te toca', 'Hablar'],
  },
  { kind: 'review', ref: 'CAM-6', title: 'Sort by recent', since: ago(90) },
  { kind: 'review', ref: 'CAM-7', title: 'Undo delete', since: ago(20) },
];

const pending = (over: Partial<Pending> = {}): Pending => ({
  count: entries.length,
  entries,
  blocks: [],
  secretary: null,
  ...over,
});

const render = (value: Pending | undefined, o: { phone?: boolean } = {}) =>
  renderIn(
    testApp({ phone: o.phone ?? false }),
    <TeEspera pending={value} onNote={none} onTurn={none} />,
  );

// F4 (field study 3): a pending question sat far up the thread, off screen on the phone, and a
// review waited 1.5 h without the secretary mentioning it. «Te espera» is pinned over the thread and
// computed by Otea, so it never depends on what the secretary remembers to say.
describe('the «Te espera» strip of Hablar', () => {
  it('lists everything that waits for you, with how many, never from the thread', () => {
    const html = render(pending());

    expect(html).toContain('Waiting for you');
    expect(html).toContain('>3<');
    for (const ref of ['B-1', 'CAM-6', 'CAM-7']) expect(html).toContain(ref);
    expect(html).toContain('Which screen?');
    expect(html).toContain('Sort by recent');
    expect(html).toContain('1 question');
    expect(html).toContain('2 reviews');
  });

  it('says which review holds the queue of a board, and what waits behind it', () => {
    const html = render(
      pending({
        blocks: [
          {
            first: 'CAM-6',
            title: 'Sort by recent',
            waitsFor: 'review',
            since: ago(90),
            waiting: ['CAM-8', 'CAM-9'],
          },
        ],
      }),
    );

    expect(html).toContain('CAM-6 waits for your review');
    expect(html).toContain('CAM-8 and CAM-9 wait behind it');
  });

  it('shows nothing when nothing waits, and nothing before Otea has told', () => {
    expect(render(pending({ count: 0, entries: [] }))).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('is open on the desk and one line on the phone, which opens with a tap', () => {
    const desk = render(pending());
    expect(desk).toContain('aria-expanded="true"');
    expect(desk).toContain('CAM-7');

    const phone = render(pending(), { phone: true });
    expect(phone).toContain('aria-expanded="false"');
    expect(phone).toContain('2 reviews');
    expect(phone).not.toContain('CAM-7');
  });
});
