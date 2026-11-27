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
  queues: [],
  secretary: null,
  ...over,
});

const render = (value: Pending | undefined, o: { phone?: boolean; short?: boolean } = {}) =>
  renderIn(
    testApp({ phone: o.phone ?? false, short: o.short ?? false }),
    <TeEspera pending={value} onJump={none} />,
  );

// F4 (field study 3): a pending question sat far up the thread, off screen on the phone, and a
// review waited 1.5 h without the secretary mentioning it. «Te espera» is pinned over the thread and
// computed by Otea, so it never depends on what the secretary remembers to say. F4 review round:
// it is an index, not a second place to answer.
describe('the «Te espera» strip of Hablar', () => {
  it('lists everything that waits for you, one line each, with how many', () => {
    const html = render(pending([question, ...reviews]));

    expect(html).toContain('Your turn now');
    expect(html).toContain('>3<');
    for (const ref of ['B-1', 'CAM-6', 'CAM-7']) expect(html).toContain(ref);
    expect(html).toContain('Which screen?');
    expect(html).toContain('Sort by recent');
    expect(html).toContain('1 question');
    expect(html).toContain('2 reviews');
  });

  // U3 (field study 4): with no way to launch a worker, opening a session is the person's to do.
  it('lists a board nobody works as a thing to do, with the worker text to copy', () => {
    const html = render(
      pending([
        {
          kind: 'worker',
          ref: 'Documentos',
          title: 'Documentos',
          since: ago(30),
          items: ['PIE-1', 'PIE-2', 'PIE-3'],
        },
      ]),
    );

    expect(html).toContain('Documentos: 3 items wait and no agent works this board');
    expect(html).toContain('1 board with no agent');
    expect(html).toContain('Copy the agent’s text');
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
      const html = render(pending([question, reviews[1] as PendingEntry]), { phone });
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

  // E1: a phone on its side has no height to spare: the strip opened by itself over a review and
  // took what the conversation needed. On a short screen it is one line until the head is tapped.
  it('stays one line on a short screen, whatever it holds', () => {
    for (const phone of [false, true]) {
      const html = render(pending([question, ...reviews]), { phone, short: true });
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('Undo delete');
    }
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

  // G1: what an agent flagged can be set aside by the person; nothing else here can.
  it('offers to dismiss an agent’s notice, and nothing else', () => {
    const notice: PendingEntry = {
      kind: 'escalation',
      ref: 'CAM-5',
      title: 'Retry',
      since: ago(30),
      by: 'kiln',
      text: 'The push failed.',
      signal: 7,
    };

    const html = render(pending([notice, ...reviews]));

    expect(html.match(/hb-te-dismiss/g)).toHaveLength(1);
    expect(html).toContain('Dismiss');
  });

  // H3 (field study 4, U4, U5, U8): 7 or 8 reviews took half the desk and 40% of the phone, over the
  // conversation and the secretary's morning summary.
  describe('with many things waiting', () => {
    const many: PendingEntry[] = Array.from({ length: 8 }, (_, n) => ({
      kind: 'review' as const,
      ref: `CAM-${n + 10}`,
      title: `Change ${n + 10}`,
      since: ago(30 + n),
    }));
    const rowsOf = (root: HTMLElement) => root.querySelectorAll('.hb-te-row').length;

    it('shows three rows on the desk and the rest behind «See all»', async () => {
      const page = mount(
        <AppTestProvider value={testApp({ now: NOW, phone: false })}>
          <TeEspera pending={pending(many)} onJump={none} />
        </AppTestProvider>,
      );
      await settle();
      expect(rowsOf(page.root)).toBe(3);
      const more = page.root.querySelector<HTMLElement>('.hb-te-more');
      expect(more?.textContent).toContain('See all 8');

      await press(more);

      expect(rowsOf(page.root)).toBe(8);
      expect(page.root.querySelector('.hb-te-more')?.textContent).toContain('Fewer');
      page.unmount();
    });

    it('is one line on the phone beyond two rows, and opens to three with «See all»', async () => {
      const page = mount(
        <AppTestProvider value={testApp({ now: NOW, phone: true })}>
          <TeEspera pending={pending(many)} onJump={none} />
        </AppTestProvider>,
      );
      await settle();
      expect(page.root.querySelector('.hb-te-head')?.getAttribute('aria-expanded')).toBe('false');
      expect(rowsOf(page.root)).toBe(0);

      await press(page.root.querySelector('.hb-te-head'));

      expect(rowsOf(page.root)).toBe(3);
      page.unmount();
    });

    it('stays open on the phone for two rows or fewer', () => {
      const html = render(pending(many.slice(0, 2)), { phone: true });
      expect(html).toContain('aria-expanded="true"');
      expect(html.match(/hb-te-row/g)).toHaveLength(2);
    });
  });

  it('names a question by the question itself, not by the sentence it starts with', () => {
    const asked: PendingEntry = {
      ...question,
      kind: 'question',
      ref: 'CAM-1',
      by: 'quill',
      text: 'Aprobaste el arreglo. No hay remoto y solo puedo unir a main en tu copia. ¿La integro?',
    };
    const html = render(pending([asked, ...reviews]));
    expect(html).toContain('¿La integro?');
    expect(html).not.toContain('Aprobaste el arreglo.');
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
