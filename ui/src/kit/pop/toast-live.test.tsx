// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test-dom.tsx';
import { ToastHost, toast } from './toast.tsx';

// Pilot 1 (a1): a notice said again while it stands is the same notice. It restarts its time and is
// not set down a second time in the live region, where a reader would say it twice.

afterEach(() => {
  document.body.innerHTML = '';
});

const said = () =>
  [...document.querySelectorAll('[role="status"] .tmsg:not(.out)')].map((p) => p.textContent);

describe('a notice repeated', () => {
  it('is set in the live region once, and a different one replaces it', async () => {
    const page = mount(<ToastHost />);
    toast({ msg: 'Anotado en la Bandeja' });
    await settle();
    expect(said()).toEqual(['Anotado en la Bandeja']);

    const first = document.querySelector('.tmsg');
    toast({ msg: 'Anotado en la Bandeja' });
    await settle();
    expect(said()).toEqual(['Anotado en la Bandeja']);
    // The very paragraph the reader already has: nothing was added to be announced.
    expect(document.querySelector('.tmsg')).toBe(first);
    expect(document.querySelectorAll('.tmsg')).toHaveLength(1);

    toast({ msg: 'Respuesta enviada' });
    await settle();
    expect(said()).toEqual(['Respuesta enviada']);
    page.unmount();
  });
});

// Field study 6 (D-1a3b09): a reader hears a live region that was there before its words came, not
// one that is made with them in it; and a toast with a move says how to reach it by the keys.
describe('a notice for a screen reader', () => {
  const announcer = () => document.querySelector('[data-toast-say]');

  it('goes into a live region that is already on the page when the toast is made', async () => {
    const page = mount(<ToastHost />);
    const before = announcer();
    expect(before?.getAttribute('aria-live')).toBe('polite');
    expect(before?.textContent).toBe('');

    toast({ msg: 'Aprobaste IDE-4', undo: () => undefined });
    await settle();
    // The very region that stood there, now holding the words and the way to the move.
    expect(announcer()).toBe(before);
    expect(announcer()?.textContent).toContain('Aprobaste IDE-4');
    expect(announcer()?.textContent).toMatch(/Alt\+(Mayús|Shift)\+Z/);
    page.unmount();
  });

  it('does not tell of a key when there is nothing to reach', async () => {
    const page = mount(<ToastHost />);
    toast({ msg: 'Anotado en la Bandeja' });
    await settle();
    expect(announcer()?.textContent).toBe('Anotado en la Bandeja');
    page.unmount();
  });
});

// Field study s-final (D-befe9d): while the Deshacer toast is up, the key everyone presses to undo
// does the undoing; a text box keeps its own Ctrl+Z.
describe('Ctrl+Z while a toast offers Deshacer', () => {
  const press = (target: EventTarget, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(e);
    return e;
  };

  it('undoes the move once and closes the toast', async () => {
    const undo = vi.fn();
    const page = mount(<ToastHost />);
    toast({ msg: 'Aprobaste IDE-4', undo });
    await settle();
    const e = press(document.body);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    press(document.body);
    expect(undo).toHaveBeenCalledTimes(1);
    page.unmount();
  });

  it('answers to Cmd+Z too, and not to Shift or Alt with it', async () => {
    const undo = vi.fn();
    const page = mount(<ToastHost />);
    toast({ msg: 'Aprobaste IDE-4', undo });
    await settle();
    press(document.body, { ctrlKey: true, shiftKey: true });
    press(document.body, { ctrlKey: true, altKey: true });
    expect(undo).not.toHaveBeenCalled();
    press(document.body, { ctrlKey: false, metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    page.unmount();
  });

  it('leaves the text box its own undo', async () => {
    const undo = vi.fn();
    const page = mount(
      <>
        <textarea id="note" />
        <ToastHost />
      </>,
    );
    toast({ msg: 'Aprobaste IDE-4', undo });
    await settle();
    const e = press(document.getElementById('note') as HTMLElement);
    expect(undo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    page.unmount();
  });

  it('does nothing for a toast with no move to undo', async () => {
    const page = mount(<ToastHost />);
    toast({ msg: 'Anotado en la Bandeja' });
    await settle();
    expect(press(document.body).defaultPrevented).toBe(false);
    page.unmount();
  });
});

describe('reaching the toast by the keys', () => {
  const alt = (init: KeyboardEventInit = {}) =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyZ', altKey: true, shiftKey: true, ...init }),
    );

  it('puts the focus on Deshacer', async () => {
    const undo = vi.fn();
    const page = mount(<ToastHost />);
    toast({ msg: 'Aprobaste IDE-4', undo });
    await settle();
    alt();
    const button = document.querySelector<HTMLButtonElement>('[data-undo]');
    expect(document.activeElement).toBe(button);
    page.unmount();
  });

  it('prefers the move over Deshacer when the toast offers one', async () => {
    const page = mount(<ToastHost />);
    toast({
      msg: 'Te hicieron una pregunta',
      action: { label: 'Responder', run: () => undefined },
    });
    await settle();
    alt();
    expect(document.activeElement?.textContent).toBe('Responder');
    page.unmount();
  });

  it('leaves the focus where it is when no toast stands', async () => {
    const page = mount(
      <>
        <button type="button" id="here">
          here
        </button>
        <ToastHost />
      </>,
    );
    document.getElementById('here')?.focus();
    alt();
    expect(document.activeElement?.id).toBe('here');
    page.unmount();
  });
});
