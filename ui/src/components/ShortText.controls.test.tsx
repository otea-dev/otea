// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { type Mounted, mount, press } from '../test-dom.tsx';
import { ShortText } from './ShortText.tsx';

// «see more» says what it opens only while that is on the page: a folded rest is not there, and a
// reference to an element that is not there is worse than none.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
});

const LONG = [
  'Necesito que confirmes algo antes de seguir.',
  'Hay dos ramas posibles y la primera toca el contrato de la API que otros equipos usan hoy mismo.',
  'La segunda solo cambia código interno pero obliga a migrar los datos guardados en la base local.',
  'Si eliges la primera avisamos a quienes dependen de ella antes de publicar la versión nueva.',
].join(' ');

describe('the toggle of a folded text', () => {
  it('points at the rest only once the rest is on the page', async () => {
    page = mount(<ShortText text={LONG} leadClass="lead" />);
    const toggle = () => page?.root.querySelector<HTMLButtonElement>('.st-toggle');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle()?.hasAttribute('aria-controls')).toBe(false);

    await press(toggle());

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    const target = toggle()?.getAttribute('aria-controls');
    expect(target).toBeTruthy();
    expect(document.getElementById(target ?? '')).not.toBeNull();
  });
});
