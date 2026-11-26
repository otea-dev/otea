import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { correctTurn } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { CopyCommand } from '../../components/CopyCommand.tsx';
import {
  awayOf,
  cardCounts,
  cardsOf,
  type Filter,
  type MessageKind,
  type Turn,
  thinkingRoot,
  turnAt,
  turnsOf,
} from '../../conversation.ts';
import { momentLabel } from '../../format.ts';
import { t } from '../../i18n/i18n.ts';
import { toast } from '../../kit/index.ts';
import { F, lerp } from '../../motion/curves.ts';
import { drive } from '../../motion/drive.ts';
import { reduced } from '../../motion/reduced.ts';
import type { Item } from '../../types.ts';
import { Composer } from './Composer.tsx';
import { SecretaryMark } from './SecretaryMark.tsx';
import { Side } from './Side.tsx';
import { Turns } from './Turns.tsx';
import { useConversation } from './use-conversation.ts';

// Hablar (#/hablar): the conversation with the project's secretary on the two lanes, its composer
// below, «Lo que salió» beside it (a column from 1240 px, a tab before that), and a line when the
// secretary is away. The person writes here; the secretary answers from its own session.

const NEAR_BOTTOM = 160;

// Until when a box is settling to a place: what the page does about its height waits for it.
const settling = new WeakMap<HTMLElement, number>();

// Puts a box at a place at once (the page's own move).
function putBox(box: HTMLElement, top: number) {
  box.scrollTop = top;
}

// Scrolls a box to a place the way the app moves things: it settles, never jumps. The foot is
// followed as it moves: the page can grow under the newest message while it settles.
function scrollBox(box: HTMLElement, top: number | 'foot') {
  const from = box.scrollTop;
  const place = () => Math.max(0, top === 'foot' ? box.scrollHeight : top);
  const to = place();
  if (reduced() || Math.abs(to - from) < 8) {
    putBox(box, to);
    return;
  }
  const duration = Math.min(900, 360 + 36 * Math.sqrt(Math.abs(to - from)));
  settling.set(box, performance.now() + duration + 60);
  drive(duration, (k) => {
    box.scrollTop = lerp(from, place(), F.settle(k));
  });
}

// The project has no secretary: what to ask of an agent, and the one command it runs. It stays in
// sight above the conversation, whatever has been written, since nothing answers until there is one.
function NoSecretary() {
  return (
    <div className="hb-nosec" data-enter="fade">
      <div className="hb-nohead">
        <SecretaryMark />
        <h2 className="hb-h">{t('hablar.none.title')}</h2>
      </div>
      <p>{t('hablar.none.text')}</p>
      <CopyCommand command="otea profile --role secretary" />
      <p className="hb-after">{t('hablar.none.after')}</p>
    </div>
  );
}

export function HablarView({
  turn,
  topic,
}: {
  turn?: number | undefined;
  topic?: string | undefined;
}) {
  const app = useApp();
  const convo = useConversation();
  const [tab, setTab] = useState<'chat' | 'out'>('chat');
  const [filter, setFilter] = useState<Filter>('all');
  const [found, setFound] = useState<number | undefined>();
  const [target, setTarget] = useState<{ root: number; n: number } | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const messages = convo.status === 'ready' ? convo.messages : undefined;
  const secretary = convo.status === 'ready' ? convo.secretary : null;
  const items = useMemo(
    () => new Map<string, Item>(app.all.map((item) => [item.id, item])),
    [app.all],
  );
  const turns = useMemo(() => turnsOf(messages ?? []), [messages]);
  const thinking = thinkingRoot(turns, secretary);
  const cards = useMemo(
    () => cardsOf(turns, items, app.now, filter),
    [turns, items, app.now, filter],
  );
  const counts = useMemo(() => cardCounts(turns, items, app.now), [turns, items, app.now]);
  const away = awayOf(secretary);

  // Goes to a turn: the conversation shows, scrolls there and the turn lights for a moment.
  const goTo = useCallback((root: number) => {
    setTab('chat');
    setTarget((was) => ({ root, n: (was?.n ?? 0) + 1 }));
  }, []);

  useLayoutEffect(() => {
    if (!target) return;
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`#hb-turn-${target.root}`);
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    scrollBox(box, top - 16);
    setFound(target.root);
    const timer = setTimeout(() => setFound(undefined), 2400);
    return () => clearTimeout(timer);
  }, [target]);

  // A link that asks for a turn (an item's backlink, a topic) is followed once the turn is read:
  // earlier pages are read until it is there.
  const asked = useRef<string | undefined>(undefined);
  const wanted =
    turn !== undefined || topic !== undefined ? `${turn ?? ''}:${topic ?? ''}` : undefined;
  const ready = convo.status === 'ready';
  const earlier = convo.status === 'ready' && convo.earlier;
  const loadingEarlier = convo.status === 'ready' && convo.loadingEarlier;
  const loadEarlier = convo.status === 'ready' ? convo.loadEarlier : undefined;
  useEffect(() => {
    if (wanted === undefined) asked.current = undefined;
    if (!ready || wanted === undefined || asked.current === wanted) return;
    const at = turnAt(turns, { turn, topic });
    if (at) {
      asked.current = wanted;
      goTo(at.root);
    } else if (earlier && !loadingEarlier) loadEarlier?.();
    else if (!earlier) asked.current = wanted;
  }, [ready, wanted, turns, turn, topic, earlier, loadingEarlier, loadEarlier, goTo]);

  // The newest message stays in sight as it arrives, unless the person scrolled up to read.
  const last = messages?.at(-1)?.id;
  const lastSeen = useRef<number | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a message arrives or the secretary starts thinking
  useLayoutEffect(() => {
    const box = scroller.current;
    // The first read of the conversation is placed at its foot at once (the lanes draw there).
    const first = lastSeen.current === undefined;
    lastSeen.current = last;
    if (!box || first || !near.current || wanted !== undefined) return;
    scrollBox(box, 'foot');
  }, [last, thinking]);

  // Whether the person is at the foot, read from their own scrolling only: the page growing under
  // them (a picture loads, a fold opens) moves the scroll too, and says nothing about where they are.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let touched = Number.NEGATIVE_INFINITY;
    const touch = () => {
      touched = performance.now();
    };
    const scrolled = () => {
      if (performance.now() - touched > 1200) return;
      near.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
    };
    const inputs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const name of inputs) box.addEventListener(name, touch, { passive: true });
    box.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      for (const name of inputs) box.removeEventListener(name, touch);
      box.removeEventListener('scroll', scrolled);
    };
  }, []);

  // The page grows under the newest message as it settles (a picture, a font, a fold): while the
  // person is at the foot, the foot stays in sight.
  const flow = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: observes again once the page is there (ready)
  useEffect(() => {
    const box = scroller.current;
    const inner = flow.current;
    if (!box || !inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!near.current || wanted !== undefined) return;
      if (performance.now() < (settling.get(box) ?? 0)) return;
      putBox(box, box.scrollHeight);
    });
    observer.observe(inner);
    // The box itself too: the composer growing under it takes room from the foot.
    observer.observe(box);
    return () => observer.disconnect();
  }, [wanted, ready]);

  const onKind = (each: Turn, kind: MessageKind) => {
    if (convo.status !== 'ready') return;
    convo.corrected(each.root, kind);
    correctTurn(each.root, kind).then(convo.reload, (error: unknown) => {
      if (each.kind) convo.corrected(each.root, each.kind);
      toast({
        msg: t('hablar.kind.failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    });
  };

  const name = app.project?.name ?? '';
  const none = convo.status === 'ready' && secretary === null;
  const status = secretary && secretary.state !== 'offline' ? secretary : null;
  return (
    <div className="hb" data-tab={tab} data-empty={turns.length === 0 || undefined}>
      <section className="hb-main">
        <header className="head" data-enter="head">
          <div className="kicker">
            <b>{t('hablar.kicker')}</b> &nbsp;·&nbsp; {name}
          </div>
          <h1 className="display">{t('hablar.display')}</h1>
          <p className="dek">{t('hablar.dek')}</p>
          {status ? (
            <p className="hb-status" data-state={status.state}>
              <i aria-hidden="true" />
              {t(`hablar.status.${status.state}`, { name: status.name })}
            </p>
          ) : null}
        </header>
        <div className="hb-tabs" role="tablist" aria-label={t('hablar.tabs')} data-enter="fade">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            onClick={() => setTab('chat')}
          >
            {t('hablar.tab.chat')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'out'}
            onClick={() => setTab('out')}
          >
            {t('hablar.out.count', { count: counts.all })}
          </button>
        </div>
        {none ? <NoSecretary /> : null}
        {away ? (
          <div className="hb-away" role="status" data-enter="fade">
            <i aria-hidden="true" />
            <span>
              {away.since
                ? t('hablar.away', { since: momentLabel(away.since, app.now) })
                : t('hablar.awayUnknown')}
            </span>
            {convo.status === 'ready' && convo.waiting.count > 0 ? (
              <b className="hb-wait">{t('hablar.waiting', { count: convo.waiting.count })}</b>
            ) : null}
          </div>
        ) : null}
        <div className="hb-chat" ref={scroller}>
          {convo.status === 'loading' ? (
            <p className="hb-pane">{t('hablar.loading')}</p>
          ) : convo.status === 'failed' ? (
            <p className="hb-pane action-error">{convo.message}</p>
          ) : (
            <div className="hb-flow" ref={flow} role="log" aria-label={t('hablar.conversation')}>
              {turns.length === 0 ? (
                none ? null : (
                  <p className="hb-pane">{t('hablar.empty')}</p>
                )
              ) : (
                <>
                  {convo.earlier ? (
                    <button
                      type="button"
                      className="hb-earlier"
                      disabled={convo.loadingEarlier}
                      onClick={convo.loadEarlier}
                    >
                      {convo.loadingEarlier ? t('hablar.olderLoading') : t('hablar.older')}
                    </button>
                  ) : null}
                  <Turns
                    turns={turns}
                    thinking={thinking}
                    items={items}
                    found={found}
                    onKind={onKind}
                    scroller={scroller}
                    onFirst={() => {
                      const box = scroller.current;
                      if (box && wanted === undefined) putBox(box, box.scrollHeight);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
        <Composer onSent={convo.status === 'ready' ? convo.reload : () => undefined} />
      </section>
      <aside className="hb-side" aria-label={t('hablar.out')}>
        <Side
          cards={cards}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          onGo={goTo}
          now={app.now}
        />
      </aside>
    </div>
  );
}
