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
    unheard: () => 'Hay trabajo y ningún agente conectado',
    assistant_reply: (by: string) => `${by || 'Tu asistente'} te respondió`,
    assistant_offline: () => 'Tu asistente está desconectado',
    replyBody: 'Abre Hablar para leerlo',
    offlineBody: (n: number) =>
      n === 1 ? 'Tu mensaje espera respuesta' : `Tus ${n} mensajes esperan respuesta`,
    hablar: 'Hablar',
    group: {
      // One is left when the others stopped waiting and the burst's notice is replaced.
      turn: (n: number) => (n === 1 ? '1 cosa te toca' : `${n} cosas te tocan`),
      ask: (n: number) => (n === 1 ? '1 pregunta te espera' : `${n} preguntas te esperan`),
      replied: (n: number) => `${n} notas contestadas`,
      stuck: (n: number) => (n === 1 ? '1 cosa se atascó' : `${n} cosas se atascaron`),
      aside: (n: number) => `${n} cosas apartadas`,
      unheard: (n: number) =>
        n === 1
          ? '1 cosa espera y no hay ningún agente conectado'
          : `${n} cosas esperan y no hay ningún agente conectado`,
      assistant_reply: (n: number) => `${n} respuestas de tu asistente`,
      assistant_offline: () => 'Tu asistente está desconectado',
      mixed: (n: number) => (n === 1 ? '1 cosa te espera' : `${n} cosas te esperan`),
    },
    // The assistant's replies in a burst, named apart from what waits.
    alsoReplies: (n: number) =>
      n === 1 ? ' y una respuesta de tu asistente' : ` y ${n} respuestas de tu asistente`,
    in: (title: string, project: string) => `${title} en ${project}`,
  },
  en: {
    turn: 'Your turn',
    ask: (by: string) => `${by} asks you`,
    replied: (by: string) => `${by} answered your note`,
    stuck: (by: string) => `Stuck · ${by} went quiet`,
    aside: (by: string) => `${by} set it aside for later`,
    unheard: () => 'Work is waiting and no agent is connected',
    assistant_reply: (by: string) => `${by || 'Your assistant'} replied`,
    assistant_offline: () => 'Your assistant is offline',
    replyBody: 'Open Talk to read it',
    offlineBody: (n: number) =>
      n === 1 ? 'Your message awaits a reply' : `Your ${n} messages await a reply`,
    hablar: 'Talk',
    group: {
      turn: (n: number) => (n === 1 ? '1 thing is yours' : `${n} things are yours`),
      ask: (n: number) => (n === 1 ? '1 question waits for you' : `${n} questions wait for you`),
      replied: (n: number) => `${n} notes answered`,
      stuck: (n: number) => (n === 1 ? '1 thing got stuck' : `${n} things got stuck`),
      aside: (n: number) => `${n} things set aside`,
      unheard: (n: number) =>
        n === 1
          ? '1 thing waits and no agent is connected'
          : `${n} things wait and no agent is connected`,
      assistant_reply: (n: number) => `${n} replies from your assistant`,
      assistant_offline: () => 'Your assistant is offline',
      mixed: (n: number) => (n === 1 ? '1 thing waits for you' : `${n} things wait for you`),
    },
    alsoReplies: (n: number) =>
      n === 1 ? ' and a reply from your assistant' : ` and ${n} replies from your assistant`,
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
      alsoReplies: (n: number) => string;
      in: (title: string, project: string) => string;
    }
>;

// The project a notice comes from: a burst names it and takes the place of its own last burst.
export type NoticeProject = { id: string; name: string };

export function noticeText(notice: Notice, lang: NoticeLang, project?: NoticeProject): NoticeText {
  const words = WORDS[lang];
  // A notice takes the place of the one with its tag on the person's screen: the tag names the
  // project and what the notice is about (a turn, a note, an item), so one project's notice never
  // wipes another's, nor a reply to one turn that to another.
  const tagOf = (...parts: (string | number | undefined)[]) =>
    [...parts.slice(0, 1), project?.id, ...parts.slice(1)]
      .filter((part) => part !== undefined)
      .join('-');
  if (notice.kind === 'group') {
    // A mixed burst says how many things wait for the person (what `otea pending` counts), not how
    // many notices it gathers; the assistant's replies are named apart, never counted as waiting.
    const replies = notice.items.filter(({ kind }) => kind === 'assistant_reply').length;
    const title =
      notice.of === 'mixed' && replies > 0 && replies < notice.items.length
        ? words.group.mixed(notice.waiting ?? notice.count - replies) + words.alsoReplies(replies)
        : words.group[notice.of](
            notice.of === 'mixed' ? (notice.waiting ?? notice.count) : notice.count,
          );
    return {
      title: project ? words.in(title, project.name) : title,
      // Items with no title of their own are the assistant talking: Hablar is named once.
      body: short([...new Set(notice.items.map(({ title }) => title || words.hablar))].join(' · ')),
      tag: project ? `otea-group-${project.id}` : 'otea-group',
      url: '/#/',
      item: null,
    };
  }
  const by = notice.by ?? '';
  // What the assistant says is not an item's: Hablar opens, at the turn it answered.
  if (notice.kind === 'assistant_reply') {
    const line = clean(notice.text);
    return {
      title: words.assistant_reply(by),
      body: line ? short(line, MAX_QUESTION) : words.replyBody,
      tag: tagOf('otea-hablar-reply', notice.turn),
      url: hablarUrl(notice.turn),
      item: null,
    };
  }
  if (notice.kind === 'assistant_offline') {
    return {
      title: words.assistant_offline(),
      body: words.offlineBody(notice.count ?? 0),
      tag: tagOf('otea-hablar-offline'),
      url: hablarUrl(),
      item: null,
    };
  }
  const said = notice.kind === 'turn' ? words.turn : words[notice.kind](by);
  // The assistant's own question with options (told as an item's is): Hablar opens at its turn.
  if (notice.kind === 'ask' && notice.item.startsWith('hablar:')) {
    const question = clean(notice.text);
    return {
      title: said,
      body: question ? withOptions(short(question, MAX_QUESTION), notice.options) : words.replyBody,
      tag: tagOf('otea-hablar-ask', notice.turn),
      url: hablarUrl(notice.turn),
      item: null,
    };
  }
  // A question goes in the notice itself, with the item's id in the title.
  const question = notice.kind === 'ask' ? clean(notice.text) : undefined;
  const title = question ? `${said} · ${notice.item}` : said;
  // A question on a Bandeja note (B-3) is no item's: Hablar opens, at that note.
  if (notice.kind === 'ask' && notice.bandeja === true) {
    return {
      title,
      body: question
        ? withOptions(short(question, MAX_QUESTION), notice.options)
        : short(`${notice.item} · ${notice.title}`),
      tag: tagOf('otea-bandeja', notice.item),
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
    tag: tagOf('otea-item', notice.item),
    url: itemUrl(notice.item),
    item: notice.item,
  };
}
