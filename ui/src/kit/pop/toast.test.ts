import { describe, expect, it } from 'vitest';
import {
  afterHold,
  dwellFor,
  holdsOn,
  itemOpened,
  reachesToast,
  seenAtMount,
  sentAway,
  toast,
  toastClass,
} from './toast.tsx';

// Field study 6 (D-1a3b09): a notice with Deshacer or Responder went before a slow finger or a
// screen reader reached it. The time it stands is for the person, not the page.
describe('how long a toast stands', () => {
  it('is at least ten seconds for any notice, and longer for one that offers a move', () => {
    expect(dwellFor({}, false)).toBeGreaterThanOrEqual(10_000);
    expect(dwellFor({ undo: () => undefined }, false)).toBeGreaterThan(dwellFor({}, false));
    expect(dwellFor({ action: { label: 'Abrirlo', run: () => undefined } }, false)).toBeGreaterThan(
      dwellFor({}, false),
    );
  });

  it('is longer again for a person on a finger or who asked for less motion', () => {
    expect(dwellFor({}, true)).toBeGreaterThanOrEqual(20_000);
    expect(dwellFor({ undo: () => undefined }, true)).toBeGreaterThanOrEqual(
      2 * dwellFor({ undo: () => undefined }, false),
    );
  });

  it('keeps a few seconds when a hold ends, however little was left', () => {
    expect(afterHold(500)).toBeGreaterThanOrEqual(4_000);
    expect(afterHold(9_000)).toBe(9_000);
  });
});

describe('the key that reaches the toast', () => {
  const press = (o: { altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean }) =>
    reachesToast({
      code: 'KeyZ',
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...o,
    });
  it('is Alt+Shift+Z, and nothing the browser or a text box already owns', () => {
    expect(press({ altKey: true, shiftKey: true })).toBe(true);
    expect(press({ altKey: true })).toBe(false);
    expect(press({ shiftKey: true })).toBe(false);
    expect(press({ ctrlKey: true })).toBe(false);
    expect(press({ altKey: true, shiftKey: true, ctrlKey: true })).toBe(false);
  });
});

describe('a toast host that mounts later', () => {
  it('starts past the toast already shown, so it never replays an old one', () => {
    toast({ msg: 'Aplicado' });
    const first = seenAtMount();
    toast({ msg: 'Movido' });
    expect(seenAtMount()).toBe(first + 1);
    expect(first).toBeGreaterThan(0);
  });
});

describe('where a toast sits', () => {
  it('at the foot by default, under the top bar when asked (the phone capture)', () => {
    expect(toastClass(undefined)).toBe('pop e-top toast');
    expect(toastClass('top')).toBe('pop e-top toast at-top');
  });
});

describe('what holds a toast up', () => {
  it('a mouse over it, never a finger: a tap left it paused for minutes (P7-4)', () => {
    expect(holdsOn('mouse')).toBe(true);
    expect(holdsOn('touch')).toBe(false);
    expect(holdsOn('pen')).toBe(false);
  });
});

describe('a toast when another item opens', () => {
  it('goes, so its Deshacer never sits over the next item’s moves (P7-R2-1)', () => {
    toast({ msg: 'Aprobaste IDE-19', id: 'IDE-19', undo: () => undefined });
    const shown = seenAtMount();
    itemOpened('IDE-19');
    expect(sentAway()).not.toBe(shown);
    itemOpened('IDE-5');
    expect(sentAway()).toBe(shown);
  });

  it('a toast with no item goes too; a newer toast stays until the next opening', () => {
    toast({ msg: 'Orden fijado' });
    const shown = seenAtMount();
    itemOpened('IDE-5');
    expect(sentAway()).toBe(shown);
    toast({ msg: 'Aprobaste IDE-5', id: 'IDE-5' });
    expect(sentAway()).toBe(shown);
  });
});
