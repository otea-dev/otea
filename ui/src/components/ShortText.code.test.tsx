// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { type Mounted, mount } from '../test-dom.tsx';
import { ShortText } from './ShortText.tsx';

// R2 left: a question or an answer line an agent wrote with `otea pending` in it showed the
// backticks as they were typed. Between backticks is code, drawn as code, with no marks.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
});

describe('code between backticks in an agent’s words', () => {
  it('is drawn as code in a question and its context, with no backticks left', () => {
    page = mount(
      <ShortText
        question
        leadClass="lead"
        text="Corrí `otea pending` y salió vacío. ¿Lo reviso con `otea board`?"
      />,
    );
    const codes = [...(page.root.querySelectorAll('code') ?? [])].map((c) => c.textContent);
    expect(codes).toEqual(['otea board']);
    expect(page.root.textContent).not.toContain('`');
  });

  it('keeps a backtick that has no mate', () => {
    page = mount(<ShortText leadClass="lead" text="Un ` suelto no es código." />);
    expect(page.root.querySelector('code')).toBeNull();
    expect(page.root.textContent).toContain('`');
  });
});
