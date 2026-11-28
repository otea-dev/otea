import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useApp } from '../app/context.tsx';
import { useWorkspace, workspace } from '../app/workspace.ts';
import type { BoardSummary } from '../board-studio/api.ts';
import { useBoards } from '../board-studio/home/boards-store.ts';
import { freshlyLive } from '../board-studio/home/home-model.ts';
import { openNewBoard } from '../board-studio/home/studio-dialogs.ts';
import type { SecretaryStatus } from '../conversation.ts';
import { stuckCount, tocaCount } from '../derive/toca.ts';
import { t } from '../i18n/i18n.ts';
import { TypeIcon } from '../icons/TypeIcon.tsx';
import { IconButton } from '../kit/Button.tsx';
import { Count } from '../kit/Count.tsx';
import { Icon } from '../kit/Icon.tsx';
import { C, F, lerp } from '../motion/curves.ts';
import { type Drive, drive } from '../motion/drive.ts';
import { reduced } from '../motion/reduced.ts';
import { offItemCount } from '../pending.ts';
import { studioHash, type ViewRoute } from '../selection.ts';
import { SecretaryMark } from '../views/hablar/SecretaryMark.tsx';
import { useSecretary } from '../views/hablar/use-conversation.ts';
import { focusContentSoon, livePlace } from './focus-content.ts';
import { PrefsButton } from './Preferences.tsx';
import { type BoardIcon, boardEntries, foldClip, type RailKey, railKey } from './rail-model.ts';

// The rail (SPEC §7.2, mock:159-198, 1420-1458, 4038-4069): the head (fold, + Nuevo ítem, named so
// it never reads as a new view, P7-14), vistas with Hablar (the secretary's mark, lit while it
// listens), Te toca and Atasco (what waits for you),
// the boards with yours / open, Nuevo tablero, the project's Studio, settings and performance (set
// up and reviewed now and then), one selection pill that slides to the row in view, and
// Preferences at the foot. It folds to a 60 px strip of icons: the rail clips, the labels fade, badges come up, and the main
// pane slides from where it was, so nothing reflows. A tablet (768 px) or a desk at 150% zoom keeps
// the labels like any desk, and folds when the person says so (s-real D-3874e1: below 1024 px it was
// always folded, with the button disabled, and nobody found "Hablar" or "Te toca").

// The secretary's state on its row: a dot in its colour while it is there, a ring while it is away;
// nothing while the project has none. The colour is for the eye; the state is also said in words.
export function SecretaryDot({ status }: { status: SecretaryStatus | null | undefined }) {
  if (!status) return null;
  return (
    <>
      <i className="sec-dot" data-state={status.state} aria-hidden="true" />
      <span className="visually-hidden">
        {t(`hablar.status.${status.state}`, { name: status.name })}
      </span>
    </>
  );
}

export function RowIcon({ icon }: { icon: BoardIcon }) {
  return icon.kind === 'mock' ? <Icon name={icon.name} /> : <TypeIcon name={icon.name} size={16} />;
}

type RowProps = {
  k: Exclude<RailKey, null>;
  on: boolean;
  icon: ReactNode;
  label: string;
  to: ViewRoute | string;
  pair?: ReactNode;
  // What the pair counts, when its numbers alone do not say (a board's yours / open): the row's tip
  // says it after the label, even unfolded, since the + covers the pair under the pointer.
  pairTip?: string;
  badge?: { n: number; warn?: boolean };
  plus?: ReactNode;
  // What the row's numbers say in words, after its label («1 pendiente»): its name is its label and
  // this, never the digits drawn beside it.
  say?: string | undefined;
  // What more is known of the row (the secretary's state), read after its name.
  hint?: string | undefined;
  // A small gap above it, no heading: a row of another kind in the same list (Temas under the views).
  apart?: boolean;
};

// A row is one control, a button laid over the whole row, named by its label and what it says; the
// icon, the counts and the badge are the eye's and are hidden from a reader. Its «+» is a second
// control beside it, never inside it.
function Row({ k, on, icon, label, to, pair, pairTip, badge, plus, say, hint, apart }: RowProps) {
  const app = useApp();
  const go = () => {
    if (typeof to === 'string') window.location.hash = to;
    else app.go(to);
  };
  const hintId = `nrow-hint-${k}`;
  return (
    <div
      className={['nrow', on ? 'on' : '', apart ? 'apart' : ''].filter(Boolean).join(' ')}
      data-k={k}
      data-tip={pairTip ? `${label} · ${pairTip}` : label}
      data-tip-more={pairTip ? '' : undefined}
    >
      <button
        type="button"
        className="ngo"
        aria-current={on ? 'page' : undefined}
        aria-describedby={hint ? hintId : undefined}
        // Enter or Space on a row (a click with no pointer, detail 0) takes the focus to the page
        // chosen, past the rest of the rail and Preferencias (D-ab7560).
        onClick={(e) => {
          const heading = livePlace('.main h1');
          go();
          if (e.detail === 0) focusContentSoon(heading);
        }}
      >
        <span className="visually-hidden">{say ? `${label}, ${say}` : label}</span>
      </button>
      {hint ? (
        // Kept out of the page and still its description: a reader says it after the name.
        <span id={hintId} hidden>
          {hint}
        </span>
      ) : null}
      <span className="ic" aria-hidden="true">
        {icon}
      </span>
      <span className="lb" aria-hidden="true">
        {label}
      </span>
      {pair === undefined ? (
        <span />
      ) : (
        <span className="pair" aria-hidden="true">
          {pair}
        </span>
      )}
      {badge ? (
        <i
          className={['badge', badge.warn ? 'warn' : '', badge.n ? 'has' : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {badge.n}
        </i>
      ) : null}
      {plus}
    </div>
  );
}

// The selection pill under the row in view (mock:1439-1449): it slides there, 360 settle, and
// follows the row if the rows move under it (the Studio tree folding) while it slides.
function useSelPill(navs: React.RefObject<HTMLDivElement | null>, key: RailKey) {
  const sliding = useRef<Drive | null>(null);
  const lastKey = useRef<RailKey | undefined>(undefined);
  const place = (animate: boolean) => {
    const box = navs.current;
    const sel = box?.querySelector<HTMLElement>(':scope > .rsel');
    const on = box?.querySelector<HTMLElement>('.nrow.on');
    if (!box || !sel) return;
    if (!on) {
      sel.style.opacity = '0';
      return;
    }
    // The row's top inside .navs (rows sit in a .nav, itself placed in .navs).
    const target = () => {
      const parent = on.offsetParent as HTMLElement | null;
      return on.offsetTop + (parent && parent !== box ? parent.offsetTop : 0);
    };
    const from = Number.parseFloat(sel.style.transform.replace('translateY(', '')) || 0;
    const shown = sel.style.opacity === '1';
    sel.style.opacity = '1';
    sliding.current?.cancel();
    sliding.current = null;
    if (!animate || !shown || reduced()) {
      sel.style.transform = `translateY(${target()}px)`;
      return;
    }
    sliding.current = drive(360, (k) => {
      sel.style.transform = `translateY(${lerp(from, target(), F.settle(k))}px)`;
      if (k >= 1) sliding.current = null;
    });
  };
  // A new row in view: the pill slides there. Any other commit: it keeps its place under the row,
  // unless it is on its way (its slide follows the row by itself).
  useLayoutEffect(() => {
    const moved = lastKey.current !== undefined && lastKey.current !== key;
    lastKey.current = key;
    if (moved || !sliding.current) place(moved);
  });
  useEffect(() => {
    const box = navs.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    // A row moved under the pill (the tree folding, a board added): it follows, unless it slides.
    const ro = new ResizeObserver(() => {
      if (!sliding.current) place(false);
    });
    for (const nav of box.querySelectorAll('.nav')) ro.observe(nav);
    return () => ro.disconnect();
  });
  useEffect(() => () => sliding.current?.cancel(), []);
}

// A board published while you are here comes into the rail once it is listed (the mock's
// publish()): it resolves from a little above, 420 glide after 120; reduced motion fades it in.
function useBoardEntrance(navs: React.RefObject<HTMLDivElement | null>, version: number) {
  const state = useBoards(version);
  const before = useRef<BoardSummary[] | null>(null);
  const pending = useRef(new Set<string>());
  const flush = () => {
    for (const name of [...pending.current]) {
      const row = navs.current?.querySelector<HTMLElement>(
        `.nrow[data-k="board:${CSS.escape(name)}"]`,
      );
      if (!row) continue;
      pending.current.delete(name);
      const R = reduced();
      row.animate(
        R
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(1px)' },
              { opacity: 1, transform: 'none', filter: 'blur(0px)' },
            ],
        R
          ? { duration: 160, easing: C.drift }
          : { duration: 420, delay: 120, easing: C.glide, fill: 'backwards' },
      );
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new list of boards
  useEffect(() => {
    if (state.status !== 'ready') return;
    for (const name of freshlyLive(before.current, state.boards)) pending.current.add(name);
    before.current = state.boards;
    flush();
  }, [state]);
  useLayoutEffect(flush);
}

export function Rail() {
  const app = useApp();
  const ws = useWorkspace();
  const folded = ws.folded;
  const railRef = useRef<HTMLElement>(null);
  const navs = useRef<HTMLDivElement>(null);
  const key = railKey(app.route);
  const { canWrite, canConfigure } = app.session;
  const yours = tocaCount(app.all, { now: app.now }, offItemCount(app.pending));
  const stuck = stuckCount(app.all, { now: app.now });
  const boards = boardEntries(app.collections, app.all);
  const secretary = useSecretary();
  const foldLabel = folded ? t('nav.show') : t('nav.hide');

  useSelPill(navs, key);
  useBoardEntrance(navs, app.version);

  // The fold (mock:4039-4054): the main pane slides from its old left, the rail clips, both 560
  // settle; a second press mid-way turns them back from where they are.
  const toggleFold = () => {
    const rail = railRef.current;
    const main = rail?.closest('.app')?.querySelector<HTMLElement>(':scope > .main');
    if (!rail || !main) {
      workspace.set({ folded: !ws.folded });
      return;
    }
    const a = main.getBoundingClientRect().left;
    const clip = getComputedStyle(rail).clipPath;
    for (const x of [...rail.getAnimations(), ...main.getAnimations()]) {
      if (x.id === 'fold') x.cancel();
    }
    const next = !ws.folded;
    flushSync(() => workspace.set({ folded: next }));
    if (reduced()) return;
    const b = main.getBoundingClientRect().left;
    const opts = { duration: 560, easing: C.settle, id: 'fold' };
    if (a !== b)
      main.animate([{ transform: `translateX(${a - b}px)` }, { transform: 'none' }], opts);
    rail.animate(
      [
        { clipPath: clip && clip !== 'none' ? clip : foldClip(!next) },
        { clipPath: foldClip(next) },
      ],
      opts,
    );
  };

  const plus = (board: string) => (
    <button
      type="button"
      className="plus"
      aria-label={t('nav.newItemIn', { board })}
      data-tip={t('nav.newItemIn', { board })}
      onClick={(e) => {
        e.stopPropagation();
        app.newItem({ board });
      }}
    >
      <Icon name="plus" />
    </button>
  );

  return (
    <aside className="rail" ref={railRef} aria-label={t('nav.views')}>
      <div className="rhead">
        <IconButton
          aria-expanded={!folded}
          aria-label={foldLabel}
          data-tip={foldLabel}
          onClick={toggleFold}
        >
          <Icon name="side" />
        </IconButton>
        {canWrite ? (
          <button type="button" className="rnew" onClick={() => app.newItem()}>
            <Icon name="plus" />
            <span className="lbl">{t('nav.newItem')}</span>
          </button>
        ) : null}
      </div>
      <div className="navs" ref={navs}>
        <i className="rsel" aria-hidden="true" />
        <div className="rail-label first">{t('nav.views')}</div>
        <nav className="nav">
          <Row
            k="hablar"
            on={key === 'hablar'}
            icon={<SecretaryMark />}
            label={t('hablar.nav')}
            to={{ view: 'hablar' }}
            pair={<SecretaryDot status={secretary} />}
            hint={
              secretary
                ? t(`hablar.status.${secretary.state}`, { name: secretary.name })
                : undefined
            }
          />
          <Row
            k="toca"
            on={key === 'toca'}
            icon={<Icon name="toca" />}
            label={t('nav.toca')}
            to={{ view: 'toca' }}
            pair={<Count value={yours} tone="you" hold />}
            badge={{ n: yours }}
            say={yours > 0 ? t('nav.pending', { count: yours }) : undefined}
          />
          <Row
            k="atasco"
            on={key === 'atasco'}
            icon={<Icon name="atasco" />}
            label={t('nav.atasco')}
            to={{ view: 'atasco' }}
            pair={<Count value={stuck} tone="warn" hold />}
            badge={{ n: stuck, warn: true }}
            say={stuck > 0 ? t('nav.stuckCount', { count: stuck }) : undefined}
          />
          {canWrite ? (
            // The quick note, named for what it does: in s-real nobody on a tablet or at 150% zoom
            // found where to jot an idea (D-a0b4a2). The form opens on the note.
            <button
              type="button"
              className="add jot"
              data-tip={t('nav.jot')}
              onClick={() => app.newItem()}
            >
              <span className="ic">
                <Icon name="note" />
              </span>
              <span className="lb">{t('nav.jot')}</span>
            </button>
          ) : null}
        </nav>
        <div className="rail-label">{t('nav.boards')}</div>
        <nav className="nav boards">
          {boards.map((b) => (
            <Row
              key={b.name}
              k={`board:${b.name}`}
              on={key === `board:${b.name}`}
              icon={
                <>
                  <RowIcon icon={b.icon} />
                  {b.letter ? <i className="ltr">{b.letter}</i> : null}
                </>
              }
              label={b.name}
              to={{ view: 'board', board: b.name }}
              pair={
                <>
                  <Count value={b.yours} tone="you" hold /> / <Count value={b.open} hold />
                </>
              }
              pairTip={t('nav.boardPair', { yours: b.yours, open: b.open })}
              say={t('nav.boardPair', { yours: b.yours, open: b.open })}
              badge={{ n: b.yours }}
              plus={canWrite ? plus(b.name) : undefined}
            />
          ))}
          {canConfigure ? (
            <button
              type="button"
              className="add"
              data-tip={t('nav.newBoard')}
              onClick={() => openNewBoard()}
            >
              <span className="ic">
                <Icon name="plus" />
              </span>
              <span className="lb">{t('nav.newBoard')}</span>
            </button>
          ) : null}
        </nav>
        <div className="rail-label">{t('nav.project')}</div>
        <nav className="nav proj">
          <Row
            k="studio"
            on={key === 'studio'}
            icon={<TypeIcon name="ruler" size={16} />}
            label={t('nav.studio')}
            to={studioHash()}
          />
          {/* Always here: without a session its page says how to sign in (it changes nothing). */}
          <Row
            k="settings"
            on={key === 'settings'}
            icon={<TypeIcon name="gear" size={16} />}
            label={t('nav.settings')}
            to={{ view: 'settings' }}
          />
          <Row
            k="performance"
            on={key === 'performance'}
            icon={<Icon name="perf" />}
            label={t('nav.performance')}
            to={{ view: 'performance' }}
          />
        </nav>
      </div>
      <div className="rail-foot">
        <PrefsButton />
      </div>
    </aside>
  );
}
