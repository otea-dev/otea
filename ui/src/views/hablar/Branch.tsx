import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { optionsNeedingWords } from '../../../../src/core/own-words.ts';
import { type AnswerWords, postUnanswer } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { ShortText } from '../../components/ShortText.tsx';
import { Ticked } from '../../components/Ticked.tsx';
import { type Chip, splitQuestion } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { AgentMark, Button, Swap, toast } from '../../kit/index.ts';
import { NodeGlyph } from '../../lanes/NodeGlyph.tsx';
import { C } from '../../motion/curves.ts';
import { reduced } from '../../motion/reduced.ts';
import type { Item } from '../../types.ts';

// What a request produced, hanging from the assistant's reply: a branch of chips, each an item
// with its node as it looks now (working, queued, waiting for you, done), and the questions of
// agents that wait for your answer, answered in place.

// A look that changes restyles in place: the new node grows out of where the old one was, and its
// words swap; nothing moves and nothing blinks. Reduced motion: a 160 ms crossfade.
function useRestyle(node: RefObject<HTMLElement | null>, look: string) {
  const was = useRef(look);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the look changes
  useLayoutEffect(() => {
    if (was.current === look) return;
    was.current = look;
    const el = node.current;
    if (!el) return;
    if (reduced()) {
      el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 160, easing: C.drift });
      return;
    }
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.55)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 420, easing: C.glide },
    );
  }, [look]);
}

function ItemChip({ chip }: { chip: Chip }) {
  const app = useApp();
  const glyph = useRef<HTMLSpanElement>(null);
  useRestyle(glyph, chip.look ?? 'draft');
  const body = (
    <>
      <span className="hb-nd" ref={glyph} aria-hidden="true">
        {chip.look ? <NodeGlyph look={chip.look} size={22} /> : <i className="hb-draft" />}
      </span>
      <span className="hb-id">{chip.id}</span>
      <span className="hb-ttl">{chip.title}</span>
      <Swap k={chip.state} className="hb-st" as="span">
        <span data-state={chip.state}>
          {chip.agent ? <AgentMark name={chip.agent} decorative /> : null}
          {t(chip.state, { first: chip.first ?? '' })}
        </span>
      </Swap>
    </>
  );
  // A board draft has no item to open yet: it is named, not linked.
  if (!chip.look) return <div className="hb-chip">{body}</div>;
  return (
    <button type="button" className="hb-chip" onClick={() => app.openItem(chip.id)}>
      {body}
    </button>
  );
}

// The branch: it draws with ink from the reply down, a chip after another; a chip that comes later
// draws its own elbow when it arrives (`fresh`).
export function Branch({
  chips,
  fresh,
}: {
  chips: readonly Chip[];
  fresh: (id: string) => boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className="hb-branch" aria-label={t('hablar.branch')}>
      {chips.map((chip, position) => (
        <Leaf key={chip.id} chip={chip} position={position} fresh={fresh(chip.id)} />
      ))}
    </ul>
  );
}

// A chip on the branch. Whether it draws in is decided once, when it appears: a later render never
// takes its ink away half-way.
function Leaf({ chip, position, fresh }: { chip: Chip; position: number; fresh: boolean }) {
  const [draws] = useState(fresh);
  return (
    <li style={{ '--i': position } as CSSProperties} data-fresh={draws || undefined}>
      <ItemChip chip={chip} />
    </li>
  );
}

// An agent's question on an item the turn produced (otea ask): its options to tap, your own words,
// or the decision left to it. Answering is the item page's own write; the card says what you
// answered until the live feed takes the question away.
export function AskCard({ item, gone = false }: { item: Item; gone?: boolean }) {
  const app = useApp();
  const asks = item.asks;
  if (!asks) return null;
  return (
    <AskBody
      // A new question on the item is a new card: what was answered before is not this answer.
      key={asks.question}
      by={asks.by}
      about={item.id}
      text={asks.text}
      options={asks.options ?? []}
      recommended={asks.recommended}
      optionText={asks.optionText ?? []}
      joined
      gone={gone}
      // The card says what you answered, with its Deshacer, until the live feed takes the question.
      retract={() => postUnanswer(item.id)}
      send={(given) => app.answer(item.id, { ...given, question: asks.question })}
    />
  );
}

// A question to you with its options to tap, your own words, or the decision left to whoever asked:
// what an item's question and a Bandeja entry's question both look like. `send` records the answer
// (the item's or the entry's own write); the card says what you answered until its question goes.
export function AskBody({
  by,
  about,
  text,
  options,
  recommended,
  gone = false,
  bare = false,
  action,
  optionText = [],
  joined = false,
  retract,
  send,
}: {
  by: string;
  // What it is about: the item's id, the entry's.
  about: string;
  text: string;
  options: readonly string[];
  recommended: number | undefined;
  gone?: boolean;
  // Only the buttons: the question is the words just above (the assistant's own question).
  bare?: boolean;
  // The question sends an item back for you when you tap its first option, with this note: the card
  // shows the note, lets you edit it, and never leaves the decision to the assistant.
  action?: { kind: 'send_back' | 'drop'; item: string; note: string; to: string };
  // The numbers (from 1) of the options that need your own words: tapping one opens the text box
  // instead of answering at once.
  optionText?: readonly number[];
  // The answer to an option that needs words goes as one text (the option, a dash, your words): an
  // item's question and a note's have no field for what you add to an option.
  joined?: boolean;
  // Takes the answer back (Deshacer), while the assistant has not heard it: the question asks again.
  retract?: () => Promise<void>;
  send: (given: AnswerWords) => Promise<void>;
}) {
  const app = useApp();
  const [free, setFree] = useState<string | null>(null);
  // The options that need your words: the ones marked, and any that promises them (a label that
  // says «te escribo…» is never sent as it reads).
  const words = optionsNeedingWords(options, optionText);
  // The option picked that needs words: the text box is its explanation.
  const [picked, setPicked] = useState<number | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = busy || gone || app.sync.offline || !app.session.canWrite;
  const answer = (given: AnswerWords, shown: string) => {
    setBusy(true);
    send(given).then(
      () => {
        setSaid(shown);
        if (retract === undefined || action) return;
        toast({
          msg: shown,
          undo: () =>
            void retract().then(
              () => {
                setSaid(null);
                setBusy(false);
                setFree(null);
                setPicked(null);
              },
              (error: unknown) =>
                toast({ msg: error instanceof Error ? error.message : String(error) }),
            ),
        });
      },
      (error: unknown) => {
        setBusy(false);
        toast({ msg: error instanceof Error ? error.message : String(error) });
      },
    );
  };
  return (
    // A fieldset is a group: its accessible name is the question the buttons answer, by its first
    // sentence (the whole of a long one is read in the page, not at every focus), and what it is
    // about when it is about something: three «¿Cómo seguimos?» are three names.
    <fieldset
      className="hb-ask"
      aria-label={about ? `${splitQuestion(text).lead} · ${about}` : splitQuestion(text).lead}
      data-answered={said !== null ? '' : undefined}
      data-bare={bare ? '' : undefined}
    >
      {bare ? null : (
        <>
          <div className="hb-who">
            <AgentMark name={by} decorative />
            <span>
              {t('sheet.qa.asks', { agent: by })} · {about}
            </span>
          </div>
          <ShortText text={text} leadClass="hb-q" question />
        </>
      )}
      {said !== null || gone ? (
        <p className="hb-said">
          <Ticked text={said ?? t('hablar.ask.gone')} />
        </p>
      ) : (
        <>
          {action ? (
            <p className="hb-does">
              {action.kind === 'drop'
                ? t(action.to === '' ? 'hablar.act.does.drop' : 'hablar.act.does.dropAs', {
                    item: action.item,
                    to: action.to,
                  })
                : t('hablar.act.does', { item: action.item, to: action.to })}
            </p>
          ) : null}
          {action && free === null ? (
            <blockquote className="hb-note" aria-label={t('hablar.act.note')}>
              {action.note}
            </blockquote>
          ) : null}
          {options.length > 0 && !(action && free !== null) && picked === null ? (
            <div className="hb-opts">
              {options.map((text, index) => (
                <button
                  key={text}
                  type="button"
                  className="hb-opt"
                  data-rec={recommended === index + 1 ? '' : undefined}
                  data-words={words.includes(index + 1) ? '' : undefined}
                  disabled={blocked}
                  onClick={() => {
                    // An option that needs your words opens the box: nothing is sent yet.
                    if (words.includes(index + 1)) {
                      setPicked(index + 1);
                      setFree('');
                      return;
                    }
                    answer({ option: index + 1 }, t('hablar.ask.answered', { text }));
                  }}
                >
                  <span>
                    <Ticked text={text} />
                  </span>
                  {recommended === index + 1 ? (
                    <span className="hb-rec">{t('pick.recommended')}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {free === null ? (
            <div className="hb-foot">
              {action ? (
                <button type="button" disabled={blocked} onClick={() => setFree(action.note)}>
                  {t('hablar.act.edit')}
                </button>
              ) : (
                <>
                  <button type="button" disabled={blocked} onClick={() => setFree('')}>
                    {t('hablar.ask.other')}
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => answer({ delegate: true }, t('sheet.qa.delegated'))}
                  >
                    {t('sheet.qa.delegate')}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="hb-own">
              {picked === null ? null : (
                <p className="hb-does">
                  {t('hablar.ask.explain', { text: options[picked - 1] ?? '' })}
                </p>
              )}
              <textarea
                rows={2}
                value={free}
                aria-label={action ? t('hablar.act.note') : t('hablar.ask.other')}
                placeholder={t('sheet.qa.placeholder')}
                onChange={(event) => setFree(event.target.value)}
              />
              <div className="hb-foot">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={blocked || free.trim() === ''}
                  onClick={() =>
                    picked !== null
                      ? answer(
                          // The assistant's question takes the option and what you add apart; an
                          // item's or a note's takes them as one text.
                          joined
                            ? { text: `${options[picked - 1] ?? ''} — ${free.trim()}` }
                            : { option: picked, explain: free.trim() },
                          t('hablar.ask.answered', {
                            text: `${options[picked - 1] ?? ''} — ${free.trim()}`,
                          }),
                        )
                      : action
                        ? answer(
                            { option: 1, note: free.trim() },
                            t('hablar.ask.answered', { text: options[0] ?? '' }),
                          )
                        : answer(
                            { text: free.trim() },
                            t('hablar.ask.answered', { text: free.trim() }),
                          )
                  }
                >
                  {action
                    ? t(action.kind === 'drop' ? 'hablar.act.send.drop' : 'hablar.act.send', {
                        item: action.item,
                      })
                    : t('sheet.qa.send')}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setFree(null);
                    setPicked(null);
                  }}
                >
                  {t('topics.convert.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
