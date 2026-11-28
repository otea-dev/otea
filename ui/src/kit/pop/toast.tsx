import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n/i18n.ts';
import { Choreo, part } from '../../motion/choreo.ts';
import { C } from '../../motion/curves.ts';
import { reduced } from '../../motion/reduced.ts';
import { GLINT, glint } from './glint.ts';
import { layerEl } from './Pop.tsx';

// Toasts (mock:3423-3469, MOTION §3.3): one surface at the foot of the page. A second message
// replaces the first in place (the old one up, the new from below) and restarts the dwell; a
// glint runs along the line on both, the opening and the replace. 12 s, paused while hovered or
// focused. Deshacer closes it and undoes at once; an action (Abrirlo) closes it and acts.

export type ToastAction = { label: string; run: () => void };

export type ToastOptions = {
  msg: ReactNode;
  id?: string;
  undo?: () => void;
  action?: ToastAction;
  node?: boolean;
  // Under the top bar instead of at the foot: on the phone, where the foot is the thumb's.
  at?: 'top';
};

export function toastClass(at: ToastOptions['at']): string {
  return at === 'top' ? 'pop e-top toast at-top' : 'pop e-top toast';
}

type Shown = ToastOptions & { seq: number };

// How long a toast stands (field study 6): never under ten seconds, since a slow finger or a screen
// reader needs the time; a notice that offers a move (Deshacer, Responder) stays longer, and so
// does any for a person on a finger or who asked for less motion (the calm). Hover and focus hold
// it besides.
const DWELL = 10_000;
const DWELL_MOVE = 15_000;
// What is left when a hold ends: a person who looked away for a moment is not rushed.
const RESUME = 4_000;

export function dwellFor(o: Pick<ToastOptions, 'undo' | 'action'>, calm: boolean): number {
  const base = o.undo || o.action ? DWELL_MOVE : DWELL;
  return calm ? base * 2 : base;
}

export const afterHold = (left: number): number => Math.max(RESUME, left);

const isCalm = (): boolean =>
  reduced() || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

// How long a notice that goes with a toast stands, for this person now: the one rule, for whatever
// says the same thing as its toast (the bulk tray's receipt).
export const noticeDwell = (o: Pick<ToastOptions, 'undo' | 'action'>): number =>
  dwellFor(o, isCalm());

// The key that goes to the toast's move from wherever the focus is (the toast stands at the end of
// the page, past the rail and the thread). Alt+Shift+Z: «Z» for Deshacer, and no text box or
// browser menu owns it.
export const reachesToast = (
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean => e.code === 'KeyZ' && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;

// The ordinary undo key: Ctrl+Z, or Cmd+Z, with no Shift (redo) and no Alt.
export const undoesToast = (
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean => e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;

const inTextBox = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches('input, textarea, select'));

// A mouse resting on the toast holds it up; a finger never does: a tap fires mouseenter with no
// mouseleave after it, and the toast stayed over Triage's buttons for minutes (P7-4).
export const holdsOn = (pointerType: string): boolean => pointerType === 'mouse';
let seqN = 0;
let latest: Shown | null = null;
const listeners = new Set<() => void>();

export function toast(o: ToastOptions): void {
  latest = { ...o, seq: ++seqN };
  for (const fn of listeners) fn();
}

// The last toast sent so far. A host that mounts later (after a page without one)
// starts past it, so it shows only what is sent from then on.
export const seenAtMount = (): number => latest?.seq ?? 0;

// An item page opened: a toast about another item (or none) goes. Its Deshacer undoes a move
// made on the page just left, and on the phone it sat over the next item's Aprobar: a tap meant
// for it undid the move before (P7-R2-1).
let away = 0;
export function itemOpened(id: string): void {
  if (!latest || latest.id === id || away === latest.seq) return;
  away = latest.seq;
  for (const fn of listeners) fn();
}

// The toast last sent away by an opening, by its seq.
export const sentAway = (): number => away;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

type Msg = { seq: number; msg: ReactNode; id?: string | undefined; out?: boolean };

export function ToastHost() {
  const next = useSyncExternalStore(
    subscribe,
    () => latest,
    () => null,
  );
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [undo, setUndo] = useState<(() => void) | undefined>(undefined);
  const [action, setAction] = useState<ToastAction | undefined>(undefined);
  const [at, setAt] = useState<ToastOptions['at']>(undefined);
  const [mounted, setMounted] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const choreo = useRef<Choreo | null>(null);
  // Sweeps the outgoing message; cleared when the host goes.
  const sweep = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(sweep.current), []);
  const seen = useRef(seenAtMount());
  // What a screen reader is told: set into a live region that is on the page before it is needed.
  const [say, setSay] = useState('');
  const dwell = useRef({ left: DWELL, t0: 0, timer: 0, due: Number.POSITIVE_INFINITY });
  const replaced = useRef(false);
  const pendingNode = useRef(false);

  const close = () => {
    clearTimeout(dwell.current.timer);
    const ch = choreo.current;
    if (!ch) return;
    ch.go(0).then((cur) => {
      if (cur && ch.dir === 0) {
        choreo.current = null;
        setMounted(false);
        setMsgs([]);
        setSay('');
      }
    });
  };
  const arm = () => {
    clearTimeout(dwell.current.timer);
    dwell.current.t0 = performance.now();
    dwell.current.due = dwell.current.t0 + dwell.current.left;
    dwell.current.timer = window.setTimeout(close, dwell.current.left);
  };
  const pause = () => {
    clearTimeout(dwell.current.timer);
    dwell.current.due = Number.POSITIVE_INFINITY;
    dwell.current.left = afterHold(dwell.current.left - (performance.now() - dwell.current.t0));
  };

  // A new toast: open the surface, or replace the message in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new toast only
  useEffect(() => {
    if (!next || next.seq === seen.current) return;
    seen.current = next.seq;
    setUndo(() => next.undo);
    setAction(next.action);
    setAt(next.at);
    const showing = mounted && choreo.current?.dir === 1;
    // The same words said again while they stand are the same notice: it keeps its time running
    // anew and is not set down a second time, where a screen reader would say it twice.
    const current = msgs.filter((m) => !m.out).at(-1);
    if (
      showing &&
      current &&
      typeof next.msg === 'string' &&
      current.msg === next.msg &&
      current.id === next.id
    ) {
      dwell.current.left = dwellFor(next, isCalm());
      arm();
      return;
    }
    replaced.current = showing;
    pendingNode.current = !!next.node;
    setMsgs((was) =>
      showing
        ? [
            ...was.filter((m) => !m.out).map((m) => ({ ...m, out: true })),
            { seq: next.seq, msg: next.msg, id: next.id },
          ]
        : [{ seq: next.seq, msg: next.msg, id: next.id }],
    );
    setMounted(true);
    dwell.current.left = dwellFor(next, isCalm());
    arm();
  }, [next]);

  // What the surface says, handed to the live region once it is drawn: the words, and for a toast
  // with a move the key that reaches it.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !msgs.length) return;
    const words = [...node.querySelectorAll('.tmsg:not(.out)')]
      .map((p) =>
        [...p.childNodes]
          .map((n) => n.textContent)
          .join(' ')
          .trim(),
      )
      .join(' ');
    const move = action?.label ?? (undo ? t('toast.undo') : undefined);
    setSay(move ? `${words} ${t('toast.reach', { move })}` : words);
  }, [msgs, undo, action]);

  // The key that reaches the toast's move from wherever the focus is.
  useEffect(() => {
    const reach = (e: KeyboardEvent) => {
      if (!reachesToast(e)) return;
      const button = el.current?.querySelector<HTMLButtonElement>('.tbtns button:not([hidden])');
      if (!button) return;
      e.preventDefault();
      button.focus();
    };
    document.addEventListener('keydown', reach);
    return () => document.removeEventListener('keydown', reach);
  }, []);

  // Ctrl+Z (Cmd+Z) undoes the move while its toast stands (D-befe9d). A text box keeps its own undo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close reads refs only
  useEffect(() => {
    if (!undo || !mounted) return;
    let spent = false;
    const press = (e: KeyboardEvent) => {
      if (spent || !undoesToast(e) || inTextBox(e.target)) return;
      spent = true;
      e.preventDefault();
      const f = undo;
      setUndo(undefined);
      close();
      f();
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, [undo, mounted]);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !msgs.length) return;
    const R = reduced();
    const box = node.querySelector<HTMLElement>('.msgs');
    const ub = node.querySelector<HTMLElement>('.tbtns');
    if (!choreo.current) {
      const fades = [box, ub].flatMap((x, i) => {
        const d = i ? 164 : 130;
        return [
          part(x, { opacity: 0 }, { opacity: 1 }, 360, 'drift', d),
          part(x, { filter: 'blur(1px)' }, { filter: 'blur(0px)' }, 300, 'drift', d),
          part(
            x,
            { transform: 'translateY(-3px)' },
            { transform: 'translateY(0px)' },
            400,
            'glide',
            d,
          ),
        ];
      });
      choreo.current = new Choreo([
        part(
          node.querySelector('.pline'),
          { transform: 'scaleX(0.001)' },
          { transform: 'scaleX(1)' },
          300,
          'glide',
          0,
        ),
        part(
          node.querySelector('.psurf'),
          { clipPath: 'inset(0px -40px 100% -40px)' },
          { clipPath: 'inset(0px -40px -40px -40px)' },
          460,
          'settle',
          50,
        ),
        part(
          node.querySelector('.pin'),
          { transform: 'translateY(-8px)' },
          { transform: 'translateY(0px)' },
          460,
          'settle',
          50,
        ),
        ...fades,
        part(node, { opacity: 0 }, { opacity: 1 }, 1, 'drift', 0, { ronly: true }),
      ]);
      choreo.current.go(1);
      glint(node, GLINT.open);
    } else if (choreo.current.dir === 0) choreo.current.go(1);
    if (replaced.current) {
      replaced.current = false;
      const old =
        node.querySelector<HTMLElement>('.tmsg.out:last-of-type') ??
        node.querySelector<HTMLElement>('.tmsg.out');
      const nw = node.querySelector<HTMLElement>('.tmsg:not(.out)');
      if (R) {
        old?.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 160,
          easing: C.drift,
          fill: 'forwards',
        });
        nw?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: C.drift });
      } else {
        old?.animate(
          [
            { transform: 'translateY(0px)', filter: 'blur(0px)', opacity: 1 },
            { transform: 'translateY(-6px)', filter: 'blur(1px)', opacity: 0 },
          ],
          { duration: 260, easing: C.glide, fill: 'forwards' },
        );
        nw?.animate(
          [
            { transform: 'translateY(6px)', filter: 'blur(1px)', opacity: 0 },
            { transform: 'translateY(0px)', filter: 'blur(0px)', opacity: 1 },
          ],
          { duration: 380, delay: 90, easing: C.glide, fill: 'backwards' },
        );
        glint(node, GLINT.replace);
      }
      clearTimeout(sweep.current);
      sweep.current = window.setTimeout(() => setMsgs((was) => was.filter((m) => !m.out)), 400);
    }
    if (pendingNode.current && !R) {
      pendingNode.current = false;
      const n = node.querySelector<HTMLElement>('.tnode');
      const W = node.offsetWidth;
      n?.animate(
        [
          { transform: 'translateX(0px)', opacity: 0 },
          { opacity: 1, offset: 0.15 },
          { transform: `translateX(${W - 12}px)`, opacity: 1, offset: 0.85 },
          { transform: `translateX(${W - 12}px)`, opacity: 0 },
        ],
        { duration: 760, delay: 120, easing: C.ink, fill: 'both' },
      );
    }
  }, [msgs]);

  useEffect(() => () => clearTimeout(dwell.current.timer), []);

  // The room a toast at the foot takes, for a page whose own last lines would lie under it (Hablar's
  // thread: the question just answered) to make: `--toast-room`, its height and a gap. Gone with it.
  useEffect(() => {
    const node = el.current;
    const root = document.documentElement;
    if (!mounted || !node || at === 'top') return;
    const measure = () => root.style.setProperty('--toast-room', `${node.offsetHeight + 12}px`);
    measure();
    const seen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    seen?.observe(node);
    return () => {
      seen?.disconnect();
      root.style.removeProperty('--toast-room');
    };
  }, [mounted, at]);

  // A page that was in the background (a phone locked, a hidden tab) throttles its timers: its
  // toast sat there an hour over Te toca (field study 4). Back in view, a toast past its time goes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close reads refs only
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible' && performance.now() > dwell.current.due) close();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const gone = useSyncExternalStore(subscribe, sentAway, () => 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: when an opening sends one away only
  useEffect(() => {
    if (gone && gone === seen.current) close();
  }, [gone]);

  // The reader's own region stands on the page always, empty until a toast comes (a region made with
  // its words already in it is not announced); the surface it mirrors does not speak twice.
  const announcer = (
    <p className="visually-hidden" role="status" aria-live="polite" data-toast-say="">
      {say}
    </p>
  );
  if (!mounted) return announcer;
  const surface = (
    <div
      ref={el}
      className={toastClass(at)}
      role="status"
      aria-live="off"
      onPointerEnter={(e) => holdsOn(e.pointerType) && pause()}
      onPointerLeave={(e) => holdsOn(e.pointerType) && arm()}
      // Only a keyboard's focus holds it: a tap focuses Deshacer too.
      onFocus={(e) => e.target.matches(':focus-visible') && pause()}
      onBlur={arm}
    >
      <i className="pline">
        <i className="glint" />
      </i>
      <div className="psurf">
        <div className="pin">
          <span className="msgs">
            {msgs.map((m) => (
              <p key={m.seq} className={m.out ? 'tmsg out' : 'tmsg'}>
                {m.id ? <span className="id">{m.id}</span> : null}
                {m.msg}
              </p>
            ))}
          </span>
          <span className="tbtns">
            <button
              type="button"
              className="btn quiet sm"
              data-act=""
              hidden={!action}
              onClick={() => {
                const f = action?.run;
                close();
                f?.();
              }}
            >
              {action?.label}
            </button>
            <button
              type="button"
              className="btn quiet sm"
              data-undo=""
              hidden={!undo}
              onClick={() => {
                const f = undo;
                close();
                f?.();
              }}
            >
              {t('toast.undo')}
            </button>
          </span>
        </div>
      </div>
      <i className="tnode" aria-hidden="true">
        <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
          <circle r="4" fill="var(--you)" />
        </svg>
      </i>
    </div>
  );
  const layer = layerEl();
  return (
    <>
      {announcer}
      {layer ? createPortal(surface, layer) : surface}
    </>
  );
}
