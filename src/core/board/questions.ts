import { timeText } from '../time.ts';

// An agent's question to the person (otea ask): asking hands the turn to the person without moving
// the item (the step, its round and the lease stay as they are); the person's answer hands it back
// to the agent, which reads it in next and show, as a send-back note, in the same round. A question
// is open while unanswered in the round of the step it was asked in. The thread is the item's
// question_asked and question_answered events; this module reads it and writes what agents read of
// it, in English, as the rest of what agents read (core/board/next.ts). Doubts never go in the
// person's notes thread (core/board/notes.ts): that one is the person's, and changes no turn.

export const QUESTION_ASKED = 'question_asked';
export const QUESTION_ANSWERED = 'question_answered';

// How a question was answered: one of the options the agent gave (`option`, its 1-based number, and
// `text` its words), the person's own words, or the person leaving the decision to the agent
// (`text` is then 'delegated').
export type AnswerMode = 'option' | 'text' | 'delegated';

export const DELEGATED = 'delegated';

// `via`: the agent that noted an answer the person gave in the chat (otea answer).
export type QuestionAnswer = {
  text: string;
  at: string;
  by: string;
  via?: string;
  mode: AnswerMode;
  option?: number;
};

// A question and the moment it was asked in: the step (by id and by name then) and its round.
// `options`: what the agent offers to pick with one tap (2 to 4), `recommended` the 1-based number
// of the one it would choose; a question with none is answered in words only.
export type ItemQuestion = {
  question: number;
  text: string;
  at: string;
  by: string;
  step: string;
  stepName: string;
  round: number;
  options?: string[];
  recommended?: number;
  // The numbers (from 1) of the options that need the person's own words: tapping one opens the
  // text box instead of answering at once (ask --option-text).
  optionText?: number[];
  answer?: QuestionAnswer;
};

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_OPTION_LENGTH = 120;

// The options an agent offers, trimmed, or what is wrong with them: a count outside 2 to 4, an
// empty or long one, a repeat, a recommendation that is no option's number (or one with no options).
export function checkOptions(
  options: readonly string[] | undefined,
  recommended: number | undefined,
): { options: string[]; recommended?: number } | { problem: string } {
  // An option is one line: control and format characters and line breaks become one space, so it
  // cannot break the layout of what next and show print, nor of a notice.
  const given = (options ?? []).map((option) => option.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim());
  if (given.length === 0)
    return recommended === undefined
      ? { options: [] }
      : { problem: 'a recommendation needs options to point at: give 2 to 4 --option' };
  if (given.length < MIN_OPTIONS || given.length > MAX_OPTIONS)
    return { problem: `give ${MIN_OPTIONS} to ${MAX_OPTIONS} options, not ${given.length}` };
  if (given.some((option) => option === '')) return { problem: 'an option is empty' };
  const long = given.find((option) => option.length > MAX_OPTION_LENGTH);
  if (long !== undefined)
    return {
      problem: `an option is over ${MAX_OPTION_LENGTH} characters ("${long.slice(0, 20)}…"): make it short`,
    };
  const keys = given.map((option) => option.toLowerCase());
  if (new Set(keys).size !== keys.length) return { problem: 'two options are the same' };
  if (recommended === undefined) return { options: given };
  if (!Number.isInteger(recommended) || recommended < 1 || recommended > given.length)
    return { problem: `the recommendation is a number from 1 to ${given.length}` };
  return { options: given, recommended };
}

export type QuestionEvent = {
  id?: number;
  type: string;
  actor: { kind: 'human' | 'agent'; name: string };
  at: string;
  data: Record<string, unknown>;
};

// The events as they stand once the moves the person took back are gone, as the item's history
// reads them (core/board/history.ts withoutUndone): a move and its undo (which names it by id) are
// dropped, and with them every question asked or answered between them, in a round that never
// happened. Needs the events' ids: an undo among events without them is no history to read, so it
// fails loudly rather than leaving a question open or closed by a move that was undone.
function liveEvents(events: readonly QuestionEvent[]): readonly QuestionEvent[] {
  const spans: Array<[number, number]> = [];
  for (const { id, data } of events) {
    if (typeof data.undoes !== 'number') continue;
    if (id === undefined) throw new Error('an undo event without its id cannot be read');
    spans.push([data.undoes, id]);
  }
  if (spans.length === 0) return events;
  return events.filter(({ id, type }) => {
    if (id === undefined) throw new Error('an event without its id cannot be read next to an undo');
    return !spans.some(
      ([from, to]) =>
        id === from || id === to || (id > from && id < to && type.startsWith('question_')),
    );
  });
}

// The options a question was asked with, as its event kept them.
function optionsOf(
  data: Record<string, unknown>,
): Pick<ItemQuestion, 'options' | 'recommended' | 'optionText'> {
  const options = Array.isArray(data.options)
    ? data.options.filter((option): option is string => typeof option === 'string')
    : [];
  if (options.length === 0) return {};
  const { recommended } = data;
  const words = Array.isArray(data.optionText)
    ? data.optionText.filter((n): n is number => typeof n === 'number')
    : [];
  return {
    options,
    ...(typeof recommended === 'number' ? { recommended } : {}),
    ...(words.length === 0 ? {} : { optionText: words }),
  };
}

// The item's questions, oldest first, each with its answer once there is one.
export function questionsOf(all: readonly QuestionEvent[]): ItemQuestion[] {
  const events = liveEvents(all);
  const out = new Map<number, ItemQuestion>();
  for (const { type, actor, at, data } of events) {
    if (typeof data.question !== 'number') continue;
    if (type === QUESTION_ASKED) {
      out.set(data.question, {
        question: data.question,
        text: String(data.text ?? ''),
        at,
        by: actor.name,
        step: String(data.step ?? ''),
        stepName: String(data.stepName ?? data.step ?? ''),
        round: typeof data.round === 'number' ? data.round : 1,
        ...optionsOf(data),
      });
    } else if (type === QUESTION_ANSWERED) {
      const asked = out.get(data.question);
      if (!asked || asked.answer) continue;
      const mode = data.mode === 'option' || data.mode === 'delegated' ? data.mode : 'text';
      asked.answer = {
        text: String(data.text ?? ''),
        at,
        by: actor.name,
        mode,
        ...(mode === 'option' && typeof data.option === 'number' ? { option: data.option } : {}),
        ...(typeof data.via === 'string' ? { via: data.via } : {}),
      };
    }
  }
  return [...out.values()];
}

// The question an item's events leave open (oldest first): asked, not answered, and the item not
// moved since. A move ends the round it was asked in, and with it the question.
export function openQuestion(all: readonly QuestionEvent[]): ItemQuestion | undefined {
  const events = liveEvents(all);
  let open: number | undefined;
  for (const { type, data } of events) {
    if (type === 'transitioned') open = undefined;
    else if (type === QUESTION_ASKED && typeof data.question === 'number') open = data.question;
    else if (type === QUESTION_ANSWERED && data.question === open) open = undefined;
  }
  if (open === undefined) return undefined;
  return questionsOf(events).find(({ question }) => question === open);
}

// The text quoted: its first line opens the quote, later lines indented under it.
function quoted(head: string, text: string, indent: string): string[] {
  const [first = '', ...rest] = text.trim().split(/\r?\n/);
  const lines = [`${head}"${first}`, ...rest.map((line) => `${indent}${line}`)];
  lines[lines.length - 1] += '"';
  return lines;
}

const WAKE = 'otea wait --turn agent wakes you when they answer';

// What otea ask says once the question is asked.
export function askedText(id: string): string {
  return `Asked the person on ${id}: the turn is theirs until they answer; the step, round and lease stay as they are. They answer it in Otea (on the item page or the phone); if they answer in the chat instead, put their words on it: otea answer ${id} "<their words>". ${WAKE}; read it then: otea show ${id}`;
}

// What otea answer says once the person's answer from the chat is on the question. `asker`: the
// agent that asked, when another agent noted the answer, and whether its session ended: the item
// then waits for whoever claims it (P3C-R3-11).
export function chatAnswerText(id: string, asker?: { name: string; gone: boolean }): string {
  const noted = `Noted the person's answer on ${id}, as given in the chat.`;
  if (asker?.gone)
    return `${noted} ${asker.name}, which asked, is gone (its session ended): claim it to carry on: otea claim ${id}; then address it and hand off as the step says.`;
  if (asker)
    return `${noted} It goes back to ${asker.name}, which asked, in the same round; its wait wakes it.`;
  return `${noted} The turn is yours again in the same round: address it, then hand off as the step says.`;
}

// What next and show say of an item whose question waits for the person.
export function waitingAnswerText(question: ItemQuestion, me?: string): string[] {
  const who = question.by === me ? 'your' : `${question.by}'s`;
  return [
    ...quoted(`Waiting for the person to answer ${who} question: `, question.text, '  '),
    ...optionsLine(question),
    `  The turn is theirs: do not hand it off yet; ${WAKE}.`,
  ];
}

// The options of a question that waits, numbered as the person sees them.
function optionsLine(question: ItemQuestion): string[] {
  const { options, recommended } = question;
  if (options === undefined) return [];
  const list = options.map(
    (option, i) => `${i + 1}. ${option}${recommended === i + 1 ? ' (recommended)' : ''}`,
  );
  return [`  Options: ${list.join(' · ')}`];
}

// What the agent reads of the person's answer: the option they chose, their own words, or the
// decision left to it, with the option it recommended when it gave one.
function answerLines(question: ItemQuestion, answer: QuestionAnswer): string[] {
  if (answer.mode === 'delegated') {
    const { options, recommended } = question;
    const pick = recommended === undefined ? undefined : options?.[recommended - 1];
    return [
      pick === undefined
        ? 'The person left the decision to you (you recommended nothing): decide it yourself and say what you chose in your handoff.'
        : `The person left the decision to you: go with your recommendation, option ${recommended} "${pick}", unless you know better, and say what you chose in your handoff.`,
    ];
  }
  if (answer.mode === 'option')
    return quoted(`The person chose option ${answer.option ?? ''}: `, answer.text, '  ');
  const head =
    question.options === undefined
      ? 'The person answered: '
      : 'The person answered in their own words: ';
  return quoted(head, answer.text, '  ');
}

// next's and show's block for the round's answered questions, in the order they were asked (a
// conversation reads forward): each question and the person's answer, which the agent addresses as
// a send-back note.
export function answersBlock(questions: readonly ItemQuestion[], me?: string): string[] {
  return questions.flatMap((question) => {
    const { text, by, answer } = question;
    if (!answer) return [];
    const who = by === me ? 'You' : by;
    return [
      '',
      ...quoted(`${who} asked the person: `, text, '  '),
      ...answerLines(question, answer),
      `  ${timeText(answer.at)}; address it in this round.`,
    ];
  });
}

// What otea wait says when an answer wakes it.
export function waitAnswerText(id: string): string {
  return `${id}: the person answered your question. Read it: otea show ${id}`;
}

// Whether a handoff's words ask the person something: how an agent asked before otea ask, kept only
// to read old events that way.
export function legacyAsks(reason: string | undefined): boolean {
  return (reason ?? '').trim().endsWith('?');
}
