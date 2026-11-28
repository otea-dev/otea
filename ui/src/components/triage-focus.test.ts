// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { focusNewCard, handedByKeys } from './triage-focus.ts';

// Field study 6 (D-2b60c9): after «Después» with Enter, the card that had the focus was gone and
// the next Tab (or the browser) put it on «Aprobar» of the next card: one more Enter approved a
// review that had not been read. The focus goes to the heading of the card that comes up, so the
// reader hears what it is, and Aprobar is a deliberate Tab away.

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-input');
});

const page = (html: string) => {
  document.body.innerHTML = `<div class="tri">${html}</div>`;
  return document.querySelector<HTMLElement>('.tri') as HTMLElement;
};

describe('where the focus goes when a new card comes up', () => {
  it('is its heading, not its Aprobar', () => {
    const root = page(`
      <article class="tcard under" inert><h2>Second</h2><button>Aprobar</button></article>
      <article class="tcard"><h2>First</h2><button>Aprobar</button></article>`);
    expect(focusNewCard(root)).toBe(true);
    expect(document.activeElement?.textContent).toBe('First');
    expect(document.activeElement?.tagName).toBe('H2');
  });

  it('is the heading of the closing page when no card is left', () => {
    const root = page('<div class="tdone"><h2>Todo al día</h2><button>Volver</button></div>');
    expect(focusNewCard(root)).toBe(true);
    expect(document.activeElement?.textContent).toBe('Todo al día');
  });

  it('is not a stop of Tab afterwards', () => {
    const root = page('<article class="tcard"><h2>First</h2></article>');
    focusNewCard(root);
    expect(document.querySelector('h2')?.getAttribute('tabindex')).toBe('-1');
  });

  it('does nothing when there is nothing to land on', () => {
    expect(focusNewCard(page(''))).toBe(false);
  });
});

describe('who decided', () => {
  it('is the keys unless the last hand on the page was a pointer', () => {
    expect(handedByKeys()).toBe(true);
    document.documentElement.setAttribute('data-input', 'key');
    expect(handedByKeys()).toBe(true);
    document.documentElement.setAttribute('data-input', 'pointer');
    expect(handedByKeys()).toBe(false);
  });
});
