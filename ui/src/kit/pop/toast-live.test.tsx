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
