import { isBandejaRef } from '../bandeja.ts';
import type { Notice } from './planner.ts';
import type { NotifyKind } from './signals.ts';

// A notice in words, as a phone or the desktop shows it: short, the item's id and title and what
// happened, nothing else from the item (no notes, no evidence). Spanish de tú, as the UI.

export type NoticeLang = 'es' | 'en';

export type NoticeText = {
  title: string;
  body: string;
  // A later notice about the same item takes the place of the earlier one.
  tag: string;
  // Where tapping it opens the app: the item, or Te toca for a burst.
  url: string;
  item: string | null;
};

export const isNoticeLang = (value: unknown): value is NoticeLang =>
  value === 'es' || value === 'en';

const MAX_BODY = 100;
const MAX_QUESTION = 140;

const short = (text: string, max = MAX_BODY) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

// A question's options after it, numbered as the desk shows them, with no control characters, only
// when all of them fit in the body's budget: a half-said list would mislead.
function withOptions(question: string, options: readonly string[] | undefined): string {
  const clean = (options ?? []).map((option) => option.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim());
  if (clean.length === 0 || clean.some((option) => option === '')) return question;
  const list = clean.map((option, i) => `${i + 1}) ${option}`).join('  ');
  return question.length + 1 + list.length <= MAX_QUESTION ? `${question}\n${list}` : question;
}

export const itemUrl = (id: string) => `/#/i/${encodeURIComponent(id)}`;

// Hablar, open at a turn (the number of the person's message that began it) when there is one.
export const hablarUrl = (turn?: number) =>
  turn === undefined ? '/#/hablar' : `/#/hablar/${turn}`;

// Hablar, open at a Bandeja entry's row (B-3).
export const bandejaUrl = (ref: string) => `/#/hablar/${encodeURIComponent(ref)}`;

const clean = (text: string | undefined) => text?.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();

const WORDS = {
  es: {
    turn: 'Te toca',
    ask: (by: string) => `${by} te pregunta`,
    replied: (by: string) => `${by} contestó tu nota`,
    stuck: (by: string) => `Se atascó · ${by} no responde`,
    aside: (by: string) => `${by} lo dejó para después`,
    unheard: () => 'Nadie escucha',
    secretary_reply: (by: string) => `${by || 'Tu secretario'} te respondió`,
    secretary_offline: () => 'Tu secretario está desconectado',
    replyBody: 'Abre Hablar para leerlo',
    offlineBody: (n: number) => (n === 1 ? 'Te espera 1 mensaje' : `Te esperan ${n} mensajes`),
    hablar: 'Hablar',
    group: {
      turn: (n: number) => `${n} cosas te tocan`,
      ask: (n: number) => `${n} preguntas te esperan`,
      replied: (n: number) => `${n} notas contestadas`,
      stuck: (n: number) => `${n} cosas se atascaron`,
      aside: (n: number) => `${n} cosas apartadas`,
      unheard: (n: number) => `${n} cosas esperan a un agente y nadie escucha`,
      secretary_reply: (n: number) => `${n} respuestas de tu secretario`,
      secretary_offline: () => 'Tu secretario está desconectado',
      mixed: (n: number) => `${n} cosas te esperan`,
    },
    in: (title: string, project: string) => `${title} en ${project}`,
  },
  en: {
    turn: 'Your turn',
    ask: (by: string) => `${by} asks you`,
    replied: (by: string) => `${by} answered your note`,
    stuck: (by: string) => `Stuck · ${by} went quiet`,
    aside: (by: string) => `${by} set it aside for later`,
    unheard: () => 'Nobody is listening',
    secretary_reply: (by: string) => `${by || 'Your secretary'} replied`,
    secretary_offline: () => 'Your secretary is offline',
    replyBody: 'Open Hablar to read it',
    offlineBody: (n: number) =>
      n === 1 ? '1 message waits for you' : `${n} messages wait for you`,
    hablar: 'Hablar',
    group: {
      turn: (n: number) => `${n} things are yours`,
      ask: (n: number) => `${n} questions wait for you`,
      replied: (n: number) => `${n} notes answered`,
      stuck: (n: number) => `${n} things got stuck`,
      aside: (n: number) => `${n} things set aside`,
      unheard: (n: number) => `${n} things wait for an agent, and nobody is listening`,
      secretary_reply: (n: number) => `${n} replies from your secretary`,
      secretary_offline: () => 'Your secretary is offline',
      mixed: (n: number) => `${n} things wait for you`,
    },
    in: (title: string, project: string) => `${title} in ${project}`,
  },
} as const satisfies Record<
  NoticeLang,
  {
    turn: string;
    replyBody: string;
    offlineBody: (n: number) => string;
    hablar: string;
  } & Record<Exclude<NotifyKind, 'turn'>, (by: string) => string> & {
      group: Record<NotifyKind | 'mixed', (n: number) => string>;
      in: (title: string, project: string) => string;
    }
>;

// The project a notice comes from: a burst names it and takes the place of its own last burst.
export type NoticeProject = { id: string; name: string };

export function noticeText(notice: Notice, lang: NoticeLang, project?: NoticeProject): NoticeText {
  const words = WORDS[lang];
  if (notice.kind === 'group') {
    const title = words.group[notice.of](notice.count);
    return {
      title: project ? words.in(title, project.name) : title,
      body: short(notice.items.map(({ title }) => title || words.hablar).join(' · ')),
      tag: project ? `otea-group-${project.id}` : 'otea-group',
      url: '/#/',
      item: null,
    };
  }
  const by = notice.by ?? '';
  // What the secretary says is not an item's: Hablar opens, at the turn it answered.
  if (notice.kind === 'secretary_reply') {
    const line = clean(notice.text);
    return {
      title: words.secretary_reply(by),
      body: line ? short(line, MAX_QUESTION) : words.replyBody,
      tag: 'otea-hablar-reply',
      url: hablarUrl(notice.turn),
      item: null,
    };
  }
  if (notice.kind === 'secretary_offline') {
    return {
      title: words.secretary_offline(),
      body: words.offlineBody(notice.count ?? 0),
      tag: 'otea-hablar-offline',
      url: hablarUrl(),
      item: null,
    };
  }
  const said = notice.kind === 'turn' ? words.turn : words[notice.kind](by);
  // A question goes in the notice itself, with the item's id in the title.
  const question = notice.kind === 'ask' ? clean(notice.text) : undefined;
  const title = question ? `${said} · ${notice.item}` : said;
  // A question on a Bandeja note (B-3) is no item's: Hablar opens, at that note.
  if (notice.kind === 'ask' && isBandejaRef(notice.item)) {
    return {
      title,
      body: question
        ? withOptions(short(question, MAX_QUESTION), notice.options)
        : short(`${notice.item} · ${notice.title}`),
      tag: `otea-bandeja-${notice.item}`,
      url: bandejaUrl(notice.item),
      item: null,
    };
  }
  return {
    title,
    // Its options follow the question, only while the question is shown (the person may hide it).
    body: question
      ? withOptions(short(question, MAX_QUESTION), notice.options)
      : short(`${notice.item} · ${notice.title}`),
    tag: `otea-item-${notice.item}`,
    url: itemUrl(notice.item),
    item: notice.item,
  };
}
