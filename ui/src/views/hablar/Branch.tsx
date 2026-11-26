import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type { AnswerWords } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import type { Chip } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { AgentMark, Button, Swap, toast } from '../../kit/index.ts';
import { NodeGlyph } from '../../lanes/NodeGlyph.tsx';
import { C } from '../../motion/curves.ts';
import { reduced } from '../../motion/reduced.ts';
import type { Item } from '../../types.ts';

// What a request produced, hanging from the secretary's reply: a branch of chips, each an item
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
        {chip.look ? <NodeGlyph look={chip.look} size={16} /> : <i className="hb-draft" />}
      </span>
      <span className="hb-id">{chip.id}</span>
      <span className="hb-ttl">{chip.title}</span>
      <Swap k={chip.state} className="hb-st" as="span">
        <span data-state={chip.state}>
          {chip.agent ? <AgentMark name={chip.agent} decorative /> : null}
          {t(chip.state)}
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
      by={asks.by}
      about={item.id}
      text={asks.text}
      options={asks.options ?? []}
      recommended={asks.recommended}
      gone={gone}
      send={(given) =>
        app.answer(item.id, { ...given, question: asks.question }, t('hablar.ask.sent'))
      }
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
  send,
}: {
  by: string;
  // What it is about: the item's id, the entry's.
  about: string;
  text: string;
  options: readonly string[];
  recommended: number | undefined;
  gone?: boolean;
  // Only the buttons: the question is the words just above (the secretary's own question).
  bare?: boolean;
  send: (given: AnswerWords) => Promise<void>;
}) {
  const app = useApp();
  const [free, setFree] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = busy || gone || app.sync.offline || !app.session.canWrite;
  const answer = (given: AnswerWords, shown: string) => {
    setBusy(true);
    send(given).then(
      () => setSaid(shown),
      (error: unknown) => {
        setBusy(false);
        toast({ msg: error instanceof Error ? error.message : String(error) });
      },
    );
  };
  return (
    <div
      className="hb-ask"
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
          <p className="hb-q">{text}</p>
        </>
      )}
      {said !== null || gone ? (
        <p className="hb-said">{said ?? t('hablar.ask.gone')}</p>
      ) : (
        <>
          {options.length > 0 ? (
            <div className="hb-opts">
              {options.map((text, index) => (
                <button
                  key={text}
                  type="button"
                  className="hb-opt"
                  data-rec={recommended === index + 1 ? '' : undefined}
                  disabled={blocked}
                  onClick={() => answer({ option: index + 1 }, t('hablar.ask.answered', { text }))}
                >
                  <span>{text}</span>
                  {recommended === index + 1 ? (
                    <span className="hb-rec">{t('pick.recommended')}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {free === null ? (
            <div className="hb-foot">
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
            </div>
          ) : (
            <div className="hb-own">
              <textarea
                rows={2}
                value={free}
                aria-label={t('hablar.ask.other')}
                placeholder={t('sheet.qa.placeholder')}
                onChange={(event) => setFree(event.target.value)}
              />
              <div className="hb-foot">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={blocked || free.trim() === ''}
                  onClick={() =>
                    answer({ text: free.trim() }, t('hablar.ask.answered', { text: free.trim() }))
                  }
                >
                  {t('sheet.qa.send')}
                </Button>
                <button type="button" onClick={() => setFree(null)}>
                  {t('topics.convert.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
