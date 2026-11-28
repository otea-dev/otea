// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
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
