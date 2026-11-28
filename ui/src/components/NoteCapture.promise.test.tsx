// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import type { SecretaryView } from '../conversation.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { type Mounted, mount, settle } from '../test-dom.tsx';
import { NoteCapture } from './NoteCapture.tsx';

// Field study s-final (D-20f47b): in a project with no secretary a quick note promised «tu secretario
// lo convierte en ítem», and then it never showed in Te toca. The line under the box says where the
// note goes and what picks it up.

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  setLanguage('en');
});

async function hintWith(secretary: SecretaryView | null | undefined): Promise<string> {
  return (await shown(secretary)).hint;
}

// `secretary`: the one the desk holds (app.secretary): null, the project has none; undefined, not
// read yet.
async function shown(
  secretary: SecretaryView | null | undefined,
): Promise<{ hint: string; placeholder: string }> {
  page = mount(
    <AppTestProvider
      value={testApp({
        project: { id: 'p1', name: 'P', icon: null },
        canCapture: true,
        secretary,
      })}
    >
      <NoteCapture onSent={() => undefined} />
    </AppTestProvider>,
  );
  await settle();
  return {
    hint: page.root.querySelector('.bn-hint')?.textContent ?? '',
    placeholder: page.root.querySelector('textarea')?.getAttribute('placeholder') ?? '',
  };
}

describe('what a quick note says it will do', () => {
  it('says the note waits in the Bandeja and that a refiner takes it once one runs, with no secretary', async () => {
    const { hint, placeholder } = await shown(null);
    expect(hint).toContain('Bandeja');
    expect(hint).toMatch(/no hay secretario/i);
    expect(hint).toContain('refinador');
    expect(hint).not.toContain('tu secretario lo convierte');
    // The box itself promises nothing a secretary would do.
    expect(placeholder).not.toMatch(/secretario/i);
  });

  it('keeps the plain promise while a secretary is declared, or before it is known', async () => {
    const withOne = await hintWith({
      name: 'sec',
      state: 'listening',
      since: null,
      pending: 0,
      waiting: { count: 0, since: null, messages: 0, notes: 0, reports: 0 },
    });
    expect(withOne).toContain('tu secretario lo convierte');
    page?.unmount();
    expect(await hintWith(undefined)).toContain('tu secretario lo convierte');
  });
});
