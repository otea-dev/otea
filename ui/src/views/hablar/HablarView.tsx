import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type AnswerWords,
  answerSecretaryQuestion,
  correctTurn,
  fetchRolePrompt,
  unanswerSecretaryQuestion,
} from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import { askingCount } from '../../bandeja.ts';
import { useCopy } from '../../components/AgentPrompt.tsx';
import { CopyCommand, CopyGlyph } from '../../components/CopyCommand.tsx';
import {
  awayOf,
  cardCounts,
  cardsOf,
  type Filter,
  type Message,
  type MessageKind,
  rowsOf,
  type Turn,
  thinkingRoot,
  turnAt,
  turnsOf,
} from '../../conversation.ts';
import { momentLabel } from '../../format.ts';
import { useRemote } from '../../hooks.ts';
import { t } from '../../i18n/i18n.ts';
import { Button, toast } from '../../kit/index.ts';
import { F, lerp } from '../../motion/curves.ts';
import { drive } from '../../motion/drive.ts';
import { reduced } from '../../motion/reduced.ts';
import type { PendingEntry } from '../../pending.ts';
import { useMedia } from '../../shell/use-media.ts';
import type { Item } from '../../types.ts';
import { useBandeja } from './Bandeja.tsx';
import { Composer } from './Composer.tsx';
import { SecretaryMark } from './SecretaryMark.tsx';
import { Side } from './Side.tsx';
import { TeEspera } from './TeEspera.tsx';
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
  const app = useApp();
  // The text is read before the tap, so the copy is the tap's own (a browser lends the clipboard
  // to a click, not to what a request answers later).
  const load = useCallback((signal: AbortSignal) => fetchRolePrompt('secretary', {}, signal), []);
  const prompt = useRemote(load, app.version, 'live');
  const text = prompt.status === 'ready' ? prompt.value.prompt : '';
  const [copied, copy] = useCopy(text);
  return (
    <div className="hb-nosec" data-enter="fade">
      <div className="hb-nohead">
        <SecretaryMark />
        <h2 className="hb-h">{t('hablar.none.title')}</h2>
      </div>
      <p>{t('hablar.none.text')}</p>
      <Button variant="primary" disabled={text === ''} onClick={copy}>
        <CopyGlyph />
        {copied ? t('hablar.none.copied') : t('hablar.none.copy')}
      </Button>
      <p className="hb-or">{t('hablar.none.orRun')}</p>
      <CopyCommand command="otea prompt --role secretary" />
      <p className="hb-after">{t('hablar.none.after')}</p>
    </div>
  );
}

export function HablarView({
  turn,
  topic,
  bandeja,
}: {
  turn?: number | undefined;
  topic?: string | undefined;
  // A Bandeja note to open at (B-3): the column or the tab shows, and the note lights.
  bandeja?: string | undefined;
}) {
  const app = useApp();
  const convo = useConversation();
  const notes = useBandeja();
  // What needs you in the Bandeja counts beside what came out: a question waits for your tap.
  const asking = askingCount(notes.entries ?? []);
  const [tab, setTab] = useState<'chat' | 'out'>(bandeja === undefined ? 'chat' : 'out');
  // Where a question is answered: at the foot of the conversation, whenever it shows (always from
  // 1240 px, on the phone's Conversación tab). The list of what came out then only says where each
  // question stands; with the conversation hidden (the phone's other tab) the list holds the form.
  // A question never has two forms.
  const wide = useMedia('(min-width: 1240px)');
  const threadShows = wide || tab === 'chat';
  // The notes a refiner asked you about: their questions stand at the foot of the thread.
  const noteAsks = useMemo(
    () => (threadShows ? (notes.entries ?? []).filter(({ state }) => state === 'asking') : []),
    [notes.entries, threadShows],
  );
  const [litAsk, setLitAsk] = useState<string | undefined>();
  const [litNote, setLitNote] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
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
  const rows = useMemo(() => rowsOf(messages ?? [], turns), [messages, turns]);
  const thinking = thinkingRoot(turns, secretary);
  const cards = useMemo(
    () => cardsOf(turns, items, app.now, filter),
    [turns, items, app.now, filter],
  );
  const counts = useMemo(() => cardCounts(turns, items, app.now), [turns, items, app.now]);
  const away = awayOf(secretary);

  // A link to a Bandeja note (a notice): the tab that holds it shows, the note scrolls into view and
  // lights for a moment, once its entries are read.
  const noteAsked = useRef<string | undefined>(undefined);
  const notesReady = notes.entries !== undefined;
  // With the conversation beside (from 1240 px) the question is answered at its foot, which is
  // there once the conversation is read too: the link waits for both.
  const convoReady = convo.status === 'ready';
  const linkReady = notesReady && (!wide || convoReady);
  useEffect(() => {
    if (bandeja === undefined) noteAsked.current = undefined;
    if (!linkReady || bandeja === undefined || noteAsked.current === bandeja) return;
    noteAsked.current = bandeja;
    setTab('out');
    setLitNote(bandeja);
    // The page goes to the question at the foot; else the note's row scrolls into view.
    const frame = requestAnimationFrame(() => {
      if (wide && toAskRef.current(bandeja)) return;
      document.getElementById(`bn-${bandeja}`)?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [bandeja, linkReady, wide]);
  // A light goes out a moment after it came on, whatever else the page did meanwhile.
  useEffect(() => {
    if (litNote === undefined) return;
    const timer = setTimeout(() => setLitNote(undefined), 2400);
    return () => clearTimeout(timer);
  }, [litNote]);
  useEffect(() => {
    if (litAsk === undefined) return;
    const timer = setTimeout(() => setLitAsk(undefined), 2400);
    return () => clearTimeout(timer);
  }, [litAsk]);

  // Goes to a turn: the conversation shows, scrolls there and the turn lights for a moment.
  const goTo = useCallback((root: number) => {
    setTab('chat');
    setTarget((was) => ({ root, n: (was?.n ?? 0) + 1 }));
  }, []);

  // Opens a turn the search found: here when it is on the page, else through its address, which
  // reads earlier pages until it is.
  const openHit = useCallback(
    (root: number) => {
      if (turns.some((each) => each.root === root)) goTo(root);
      else app.go({ view: 'hablar', turn: root });
    },
    [turns, goTo, app.go],
  );

  // Goes to the question at the foot of the conversation (an item's, or a note's), where it is
  // answered. False when it is not there (the conversation does not hold it): the caller opens the
  // item or the note instead.
  const toAsk = useCallback((ref: string): boolean => {
    const box = scroller.current;
    const el = document.getElementById(`hb-ask-${ref}`);
    if (!box || !el) return false;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    near.current = false;
    scrollBox(box, top - 16);
    setLitAsk(ref);
    return true;
  }, []);

  const toAskRef = useRef(toAsk);
  toAskRef.current = toAsk;

  // What «Te espera» points at: the question where it is answered, else the item, else the note.
  const jump = (entry: PendingEntry) => {
    if (entry.kind === 'secretary' && entry.turn !== undefined) return goTo(entry.turn);
    if (entry.kind === 'question' || entry.kind === 'bandeja') {
      if (toAsk(entry.ref)) return;
    }
    if (/^B-\d+$/i.test(entry.ref)) return app.go({ view: 'hablar', bandeja: entry.ref });
    return app.openItem(entry.ref);
  };

  useLayoutEffect(() => {
    if (!target) return;
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`#hb-turn-${target.root}`);
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    // Leaving the foot on purpose: the page does not pull the person back to it while it settles,
    // and once it has, where they stand says whether it follows the foot again.
    near.current = false;
    scrollBox(box, top - 16);
    setFound(target.root);
    const arrived = setTimeout(() => {
      near.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
    }, 1100);
    const timer = setTimeout(() => setFound(undefined), 2400);
    return () => {
      clearTimeout(arrived);
      clearTimeout(timer);
    };
  }, [target]);

  // A link that asks for a turn (an item's backlink, a topic) is followed once the turn is read:
  // earlier pages are read until it is there.
  const asked = useRef<string | undefined>(undefined);
  const wanted =
    turn !== undefined || topic !== undefined ? `${turn ?? ''}:${topic ?? ''}` : undefined;
  const ready = convo.status === 'ready';
  const earlier = convo.status === 'ready' && convo.earlier;
  const loadingEarlier = convo.status === 'ready' && convo.loadingEarlier;
  const earlierFailed = convo.status === 'ready' && convo.earlierFailed;
  const loadEarlier = convo.status === 'ready' ? convo.loadEarlier : undefined;
  useEffect(() => {
    if (wanted === undefined) asked.current = undefined;
    if (!ready || wanted === undefined || asked.current === wanted) return;
    const at = turnAt(turns, { turn, topic });
    if (at) {
      asked.current = wanted;
      goTo(at.root);
      // The link has done its work: the address is the conversation's again, so the page follows
      // its foot as before.
      app.go({ view: 'hablar' });
    } else if (earlier && !loadingEarlier && !earlierFailed) loadEarlier?.();
    else if (!earlier || earlierFailed) {
      // Nothing more to read, or a page that did not come: it is not asked for again on its own
      // (the button beside the conversation asks for it).
      asked.current = wanted;
      app.go({ view: 'hablar' });
    }
  }, [
    ready,
    wanted,
    turns,
    turn,
    topic,
    earlier,
    loadingEarlier,
    earlierFailed,
    loadEarlier,
    goTo,
    app.go,
  ]);

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

  const onKind = (each: Turn, kind: MessageKind, quiet = false) => {
    if (convo.status !== 'ready') return;
    const was = each.kind;
    convo.corrected(each.root, kind);
    correctTurn(each.root, kind).then(
      () => {
        convo.reload();
        // What the tap did, and the way back: the secretary is woken by it.
        if (!quiet) {
          toast({
            msg: t('hablar.kind.done', { kind: t(`hablar.kind.${kind}`) }),
            ...(was === null ? {} : { undo: () => onKind(each, was, true) }),
          });
        }
      },
      (error: unknown) => {
        convo.uncorrected(each.root);
        toast({
          msg: t('hablar.kind.failed', {
            message: error instanceof Error ? error.message : String(error),
          }),
        });
      },
    );
  };

  // A tap on a question of the secretary's goes back to it as your own message; the page reads the
  // conversation again so what you chose is in the thread at once.
  const onAnswer = (message: Message, given: AnswerWords) =>
    answerSecretaryQuestion(message.id, given).then(() => {
      near.current = true;
      if (convo.status === 'ready') convo.reload();
    });
  // Deshacer: the answer goes, and the question asks again.
  const onRetract = (message: Message) =>
    unanswerSecretaryQuestion(message.id).then(() => {
      if (convo.status === 'ready') convo.reload();
    });

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
        <div
          className="hb-tabs"
          role="tablist"
          aria-label={t('hablar.tabs')}
          data-enter="fade"
          onKeyDown={(event) => {
            const to =
              event.key === 'ArrowRight' || event.key === 'ArrowLeft'
                ? tab === 'chat'
                  ? 'out'
                  : 'chat'
                : event.key === 'Home'
                  ? 'chat'
                  : event.key === 'End'
                    ? 'out'
                    : undefined;
            if (to === undefined) return;
            event.preventDefault();
            setTab(to);
            document.getElementById(`hb-tab-${to}`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="hb-tab-chat"
            aria-selected={tab === 'chat'}
            aria-controls="hb-panel-chat"
            tabIndex={tab === 'chat' ? 0 : -1}
            onClick={() => setTab('chat')}
          >
            {t('hablar.tab.chat')}
          </button>
          <button
            type="button"
            role="tab"
            id="hb-tab-out"
            aria-selected={tab === 'out'}
            aria-controls="hb-panel-out"
            tabIndex={tab === 'out' ? 0 : -1}
            onClick={() => setTab('out')}
          >
            {t('hablar.out.count', { count: counts.all + asking })}
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
            {secretary ? (
              <>
                <p className="hb-back">
                  {t('hablar.away.back', {
                    command: `otea wait --secretary --as ${secretary.name}`,
                  })}
                </p>
                <CopyCommand command={`otea prompt --role secretary --as ${secretary.name}`} />
              </>
            ) : null}
          </div>
        ) : null}
        <TeEspera pending={app.pending} onJump={jump} />
        <div className="hb-chat" id="hb-panel-chat" ref={scroller}>
          {convo.status === 'loading' ? (
            <p className="hb-pane">{t('hablar.loading')}</p>
          ) : convo.status === 'failed' ? (
            <p className="hb-pane action-error">{convo.message}</p>
          ) : (
            <div className="hb-flow" ref={flow} role="log" aria-label={t('hablar.conversation')}>
              {turns.length === 0 && noteAsks.length === 0 ? (
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
                    rows={rows}
                    thinking={thinking}
                    items={items}
                    found={found}
                    onKind={onKind}
                    onGo={goTo}
                    onAnswer={onAnswer}
                    onRetract={onRetract}
                    noteAsks={noteAsks}
                    onNoteAnswered={notes.reload}
                    litAsk={litAsk}
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
        <Composer
          onSent={() => {
            // What you just said is where you are now: the page follows it to the foot.
            near.current = true;
            if (convo.status === 'ready') convo.reload();
          }}
        />
      </section>
      <aside className="hb-side" id="hb-panel-out" aria-label={t('hablar.out')}>
        <Side
          cards={cards}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          onGo={goTo}
          onHit={openHit}
          now={app.now}
          bandeja={{ ...notes, lit: litNote, answerBelow: threadShows }}
          search={search}
          onSearch={setSearch}
        />
      </aside>
    </div>
  );
}
