// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keepFocus } from './keep-focus.ts';

// Pilot 1 (a2): after answering, approving, sending back or dismissing a notice the focus was gone
// and the next Tab started from the top of the page. The control that held it is taken away; the
// focus goes to the next sensible one, and never to the page's body.

let stop: (() => void) | undefined;

beforeEach(() => {
  document.body.innerHTML = '';
  stop = keepFocus();
});
afterEach(() => {
  stop?.();
  document.body.innerHTML = '';
});

const html = (markup: string) => {
  document.body.innerHTML = markup;
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

describe('keepFocus', () => {
  it('moves the focus to what follows when the control that held it goes away', async () => {
    html(
      `<main><section id="ask"><button id="a">Sí</button><button id="b">No</button></section>
       <p id="said" hidden></p><button id="next">Siguiente</button></main>`,
    );
    el('a').focus();
    // Answering takes the options away.
    el('ask').replaceChildren();
    await settle();
    expect(document.activeElement).toBe(el('next'));
  });

  it('prefers a control left in the place the old one was (a Deshacer where Aprobar stood)', async () => {
    html(
      `<main><button id="before">Antes</button><div id="moves"><button id="approve">Aprobar</button></div>
       <button id="after">Después</button></main>`,
    );
    el('approve').focus();
    el('moves').innerHTML = '<button id="undo">Deshacer</button>';
    await settle();
    expect(document.activeElement).toBe(el('undo'));
  });

  it('goes back to the last control before when nothing follows', async () => {
    html(
      `<main><button id="first">Uno</button><div id="gone"><button id="x">Quitar</button></div></main>`,
    );
    el('x').focus();
    el('gone').remove();
    await settle();
    expect(document.activeElement).toBe(el('first'));
  });

  it('leaves the focus alone when it went somewhere on its own', async () => {
    html(
      `<main><button id="a">A</button><button id="b">B</button><button id="c">C</button></main>`,
    );
    el('a').focus();
    el('b').focus();
    el('a').remove();
    await settle();
    expect(document.activeElement).toBe(el('b'));
  });

  it('does not take the focus from a dialog that hands it back itself', async () => {
    html(
      `<button id="trigger">Abrir</button><div role="dialog" id="dlg"><button id="in">Cerrar</button></div>`,
    );
    el('in').focus();
    el('dlg').remove();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing for a focus that was never lost', async () => {
    html(`<main><button id="a">A</button><button id="b">B</button></main>`);
    el('a').focus();
    el('b').remove();
    await settle();
    expect(document.activeElement).toBe(el('a'));
  });
});
