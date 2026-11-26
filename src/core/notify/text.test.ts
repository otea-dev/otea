import { describe, expect, it } from 'vitest';
import type { Notice } from './planner.ts';
import { noticeText } from './text.ts';

const review: Notice = { kind: 'turn', item: 'TASKS-7', title: 'Ship the login' };

describe('noticeText', () => {
  it('names the item and opens it', () => {
    expect(noticeText(review, 'es')).toEqual({
      title: 'Te toca',
      body: 'TASKS-7 · Ship the login',
      tag: 'otea-item-TASKS-7',
      url: '/#/i/TASKS-7',
      item: 'TASKS-7',
    });
    expect(noticeText(review, 'en').title).toBe('Your turn');
  });

  describe('the options of a question', () => {
    const ask = {
      ...review,
      kind: 'ask',
      by: 'claude',
      text: '¿Caparazón liso o con musgo?',
      options: ['Liso', 'Con musgo'],
    } as Notice;

    it('follow the question when they all fit in the body', () => {
      expect(noticeText(ask, 'es').body).toBe(
        '¿Caparazón liso o con musgo?\n1) Liso  2) Con musgo',
      );
    });

    it('are left out when they would not fit, so the body keeps its budget', () => {
      const long = { ...ask, options: ['x'.repeat(60), 'y'.repeat(60)] } as Notice;
      expect(noticeText(long, 'en').body).toBe('¿Caparazón liso o con musgo?');
      const wordy = { ...ask, text: 'q '.repeat(60) } as Notice;
      for (const notice of [ask, long, wordy]) {
        expect(noticeText(notice, 'en').body.length).toBeLessThanOrEqual(140);
      }
    });

    it('lose their control characters and line breaks', () => {
      const messy = { ...ask, options: ['Li\u0007so\n\rx', 'Con‮ musgo'] } as Notice;
      expect(noticeText(messy, 'en').body).toBe(
        '¿Caparazón liso o con musgo?\n1) Li so x  2) Con musgo',
      );
    });

    it('are not said without the question: the person hid its words', () => {
      const { text: _hidden, ...hidden } = ask as Notice & { text: string };
      expect(noticeText(hidden, 'es').body).toBe('TASKS-7 · Ship the login');
    });

    it('belong to a question alone', () => {
      expect(noticeText({ ...ask, kind: 'turn' } as Notice, 'en').body).toBe(
        'TASKS-7 · Ship the login',
      );
    });
  });

  it.each([
    [{ kind: 'ask', by: 'claude' }, 'claude te pregunta', 'claude asks you'],
    [{ kind: 'aside', by: 'kiln' }, 'kiln lo dejó para después', 'kiln set it aside for later'],
    [{ kind: 'unheard' }, 'Nadie escucha', 'Nobody is listening'],
    [{ kind: 'replied', by: 'claude' }, 'claude contestó tu nota', 'claude answered your note'],
    [{ kind: 'stuck', by: 'codex' }, 'Se atascó · codex no responde', 'Stuck · codex went quiet'],
  ] as const)('says %j in Spanish and English', (what, es, en) => {
    const notice = { ...review, ...what } as Notice;
    expect(noticeText(notice, 'es').title).toBe(es);
    expect(noticeText(notice, 'en').title).toBe(en);
  });

  it('puts the question itself in a single ask, trimmed, and keeps the item id in the title', () => {
    const ask = {
      ...review,
      kind: 'ask',
      by: 'kiln',
      text: '¿El descuento se acumula con el cupón?',
    } as Notice;
    expect(noticeText(ask, 'es')).toMatchObject({
      title: 'kiln te pregunta · TASKS-7',
      body: '¿El descuento se acumula con el cupón?',
    });
    expect(noticeText(ask, 'en').title).toBe('kiln asks you · TASKS-7');
    const messy = { ...ask, text: 'Drop\u0007 it\u001b[31m?‮ ​now\r\n\tplease' } as Notice;
    expect(noticeText(messy, 'en').body).toBe('Drop it [31m? now please');
    const long = { ...ask, text: `line one\n${'word '.repeat(60)}` } as Notice;
    const body = noticeText(long, 'en').body;
    expect(body.length).toBeLessThanOrEqual(140);
    expect(body.startsWith('line one word')).toBe(true);
    expect(body.endsWith('…')).toBe(true);
  });

  it('counts a burst and opens Te toca', () => {
    const group: Notice = {
      kind: 'group',
      count: 3,
      of: 'turn',
      items: [
        { item: 'A-1', title: 'One', kind: 'turn' },
        { item: 'A-2', title: 'Two', kind: 'turn' },
        { item: 'A-3', title: 'Three', kind: 'turn' },
      ],
    };
    expect(noticeText(group, 'es')).toEqual({
      title: '3 cosas te tocan',
      body: 'One · Two · Three',
      tag: 'otea-group',
      url: '/#/',
      item: null,
    });
    expect(noticeText({ ...group, of: 'mixed' }, 'en').title).toBe('3 things wait for you');
    expect(noticeText({ ...group, of: 'stuck' }, 'es').title).toBe('3 cosas se atascaron');
    expect(noticeText({ ...group, of: 'replied' }, 'en').title).toBe('3 notes answered');
    expect(noticeText({ ...group, of: 'ask' }, 'es').title).toBe('3 preguntas te esperan');
    expect(noticeText({ ...group, of: 'aside' }, 'en').title).toBe('3 things set aside');
    expect(noticeText({ ...group, of: 'unheard' }, 'en').title).toBe(
      '3 things wait for an agent, and nobody is listening',
    );
  });

  it('names the project a burst comes from, and keeps one burst per project on screen', () => {
    const web = { id: 'tienda-web-x1', name: 'tienda-web' };
    const group: Notice = {
      kind: 'group',
      count: 3,
      of: 'mixed',
      items: [
        { item: 'A-1', title: 'One', kind: 'turn' },
        { item: 'A-2', title: 'Two', kind: 'stuck' },
        { item: 'A-3', title: 'Three', kind: 'ask' },
      ],
    };
    expect(noticeText(group, 'es', web)).toMatchObject({
      title: '3 cosas te esperan en tienda-web',
      tag: 'otea-group-tienda-web-x1',
    });
    expect(noticeText(group, 'en', web).title).toBe('3 things wait for you in tienda-web');
    expect(noticeText({ ...group, of: 'turn' }, 'es', { id: 'api-z9', name: 'api' }).title).toBe(
      '3 cosas te tocan en api',
    );
  });

  describe('the secretary', () => {
    const reply: Notice = {
      kind: 'secretary_reply',
      item: 'hablar:4',
      title: '',
      by: 'sage',
      turn: 4,
      text: 'Listo\u0007 el  pedido',
    };

    it('says it replied, with the first line cleaned, and opens Hablar at the turn', () => {
      expect(noticeText(reply, 'es')).toEqual({
        title: 'sage te respondió',
        body: 'Listo el pedido',
        tag: 'otea-hablar-reply',
        url: '/#/hablar/4',
        item: null,
      });
      expect(noticeText(reply, 'en').title).toBe('sage replied');
    });

    it('keeps the words out when the text was hidden', () => {
      const { text: _hidden, ...bare } = reply as Notice & { text?: string };
      expect(noticeText(bare as Notice, 'es').body).toBe('Abre Hablar para leerlo');
    });

    it('counts what waits for an offline secretary, in both languages', () => {
      const offline: Notice = {
        kind: 'secretary_offline',
        item: 'hablar:offline',
        title: '',
        count: 3,
      };
      expect(noticeText(offline, 'es')).toMatchObject({
        title: 'Tu secretario está desconectado',
        body: 'Te esperan 3 mensajes',
        url: '/#/hablar',
      });
      expect(noticeText({ ...offline, count: 1 }, 'en').body).toBe('1 message waits for you');
    });
  });

  it('keeps a long title short', () => {
    const long = noticeText({ ...review, title: 'x'.repeat(300) }, 'en');
    expect(long.body.length).toBeLessThanOrEqual(100);
    expect(long.body.endsWith('…')).toBe(true);
  });
});
