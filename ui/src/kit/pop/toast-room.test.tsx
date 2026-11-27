// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test-dom.tsx';
import { ToastHost, toast } from './toast.tsx';

const room = () => document.documentElement.style.getPropertyValue('--toast-room');

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--toast-room');
  vi.restoreAllMocks();
});

// Field study 4 (design): a toast at the foot lay over the last lines of Hablar's thread (the
// question just answered). It says how much room it takes so the page can make it.
describe('the room a toast at the foot takes', () => {
  it('is told to the page while it stands, and given back when it goes', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(52);
    const page = mount(<ToastHost />);
    expect(room()).toBe('');

    toast({ msg: 'Respuesta enviada.' });
    await settle();
    // Its height and a gap of 12 px.
    expect(room()).toBe('64px');

    page.unmount();
    expect(room()).toBe('');
  });

  it('takes none when it stands under the top bar', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(52);
    const page = mount(<ToastHost />);
    toast({ msg: 'Otea se actualizó', at: 'top' });
    await settle();
    expect(room()).toBe('');
    page.unmount();
  });
});
