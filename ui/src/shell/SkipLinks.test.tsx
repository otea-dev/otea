// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { type Mounted, mount, press } from '../test-dom.tsx';
import { SkipLinks } from './SkipLinks.tsx';
import { testApp } from './test-app.ts';

// Pilot 1 (a2): no way to the message box or to the next review but Tab through the rail and the
// conversation. The first stops of the page jump past them.

let page: Mounted | undefined;
let area: HTMLElement | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  area?.remove();
  setLanguage('en');
});

// What the view draws: the places a skip can land on.
const view = (markup: string) => {
  area = document.createElement('div');
  area.innerHTML = markup;
  document.body.append(area);
};

const links = (route: object) => {
  page = mount(
    <AppTestProvider value={testApp({ route: route as never })}>
      <SkipLinks />
    </AppTestProvider>,
  );
  return [...page.root.querySelectorAll<HTMLElement>('button')];
};

describe('the skip links', () => {
  it('in Hablar jump to the message box, and to the content', async () => {
    view(
      '<main class="main"><h1>Hablar</h1><form class="hb-composer"><textarea></textarea></form></main>',
    );
    const found = links({ view: 'hablar' });
    await Promise.resolve();
    expect(found.map((b) => b.textContent)).toEqual(['Ir al contenido', 'Ir al cuadro de mensaje']);
    await press(found[1]);
    expect(document.activeElement).toBe(document.querySelector('.hb-composer textarea'));
  });

  it('in Te toca jump to the next review, when there is one', async () => {
    view(
      '<main class="main"><h1>Te toca</h1><div class="row" data-sec="preguntas" tabindex="0"></div><div class="row" data-sec="revisiones" tabindex="0" id="rev"></div></main>',
    );
    const found = links({ view: 'toca' });
    expect(found.map((b) => b.textContent)).toEqual([
      'Ir al contenido',
      'Ir a la siguiente revisión',
    ]);
    await press(found[1]);
    expect(document.activeElement?.id).toBe('rev');
  });

  it('offers no jump to a place the page does not have', () => {
    view('<main class="main"><h1>Te toca</h1></main>');
    expect(links({ view: 'toca' }).map((b) => b.textContent)).toEqual(['Ir al contenido']);
  });

  it('takes the content jump to the page’s heading, which it lets hold the focus', async () => {
    view('<main class="main"><h1>Hablar</h1></main>');
    const found = links({ view: 'hablar' });
    await press(found[0]);
    expect(document.activeElement).toBe(document.querySelector('.main h1'));
  });
});
