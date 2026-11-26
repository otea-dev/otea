// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pending, PendingEntry } from '../../../../src/core/pending.ts';
import { AppTestProvider } from '../../app/context.tsx';
import { ago, NOW } from '../../derive/fixtures.ts';
import { renderIn, testApp } from '../../shell/test-app.ts';
import { mount, press, settle } from '../../test-dom.tsx';
import { TeEspera } from './TeEspera.tsx';

const none = () => undefined;

const question: PendingEntry = {
  kind: 'bandeja',
  ref: 'B-1',
  title: 'the Aprobar button is hidden',
  since: ago(40),
  by: 'lia',
  text: 'Which screen?',
  options: ['Te toca', 'Hablar'],
};
const reviews: PendingEntry[] = [
  { kind: 'review', ref: 'CAM-6', title: 'Sort by recent', since: ago(90) },
  { kind: 'review', ref: 'CAM-7', title: 'Undo delete', since: ago(20) },
];

const pending = (entries: PendingEntry[], over: Partial<Pending> = {}): Pending => ({
  count: entries.length,
  entries,
  blocks: [],
  secretary: null,
  ...over,
});

const render = (value: Pending | undefined, o: { phone?: boolean } = {}) =>
  renderIn(testApp({ phone: o.phone ?? false }), <TeEspera pending={value} onJump={none} />);

// F4 (field study 3): a pending question sat far up the thread, off screen on the phone, and a
// review waited 1.5 h without the secretary mentioning it. «Te espera» is pinned over the thread and
// computed by Otea, so it never depends on what the secretary remembers to say. F4 review round:
// it is an index, not a second place to answer.
describe('the «Te espera» strip of Hablar', () => {
  it('lists everything that waits for you, one line each, with how many', () => {
    const html = render(pending([question, ...reviews]));

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
      pending(reviews, {
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
    expect(render(pending([]))).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('opens when it holds what the conversation cannot answer, on the desk and the phone', () => {
    for (const phone of [false, true]) {
      const html = render(pending([question, ...reviews]), { phone });
      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('CAM-7');
    }
    const notice: PendingEntry = {
      kind: 'escalation',
      ref: 'CAM-1',
      title: 'Sort',
      since: ago(5),
      by: 'kiln',
      text: 'I pushed a branch by mistake',
    };
    expect(render(pending([notice]))).toContain('aria-expanded="true"');
    expect(render(pending([notice]))).toContain('kiln reports');
  });

  it('is one line when it only holds questions: the foot of the conversation answers them', () => {
    for (const phone of [false, true]) {
      const html = render(pending([question]), { phone });
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('1 question');
      expect(html).not.toContain('Which screen?');
    }
  });

  it('holds no form: a row is a button that jumps, never a field or an option to tap', () => {
    const html = render(pending([question, ...reviews]));

    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('hb-opt');
    expect(html).not.toContain('Te toca</button>');
  });

  describe('a row', () => {
    afterEach(() => vi.restoreAllMocks());

    it('jumps to where the thing is dealt with, with its entry', async () => {
      const jump = vi.fn();
      const page = mount(
        <AppTestProvider value={testApp({ now: NOW })}>
          <TeEspera pending={pending([question, ...reviews])} onJump={jump} />
        </AppTestProvider>,
      );
      await settle();

      const rows = [...page.root.querySelectorAll<HTMLElement>('.hb-te-row')];
      await press(rows[0]);
      await press(rows[1]);

      expect(jump.mock.calls.map(([entry]) => entry.ref)).toEqual(['B-1', 'CAM-6']);
      page.unmount();
    });
  });
});
