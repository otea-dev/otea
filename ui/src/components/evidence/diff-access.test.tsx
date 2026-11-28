// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { type Mounted, mount, settle } from '../../test-dom.tsx';
import type { Evidence } from '../../types.ts';
import { EvidenceReader, EvidenceViewer } from './EvidenceViewer.tsx';
import { keepEvidenceText } from './TextViews.tsx';

// The diff as a person who does not see it, or does not point at it, reads it (pilot 1, a1 and a2):
// each line says whether it is added or removed, a line can be picked for a note with the keys, and
// the layout choice says which one is on.

afterEach(() => {
  page?.unmount();
  page = undefined;
  // The layout chosen in one test is remembered by the browser: the next one starts from nothing.
  globalThis.localStorage?.clear();
  setLanguage('en');
});

let page: Mounted | undefined;
let seq = 900;
const diff = (text: string): Evidence => {
  const id = ++seq;
  keepEvidenceText(`/api/evidence/${id}/file`, text);
  return {
    id,
    itemId: 'CAM-5',
    role: 'single',
    module: null,
    kind: 'diff',
    filename: 'cambios.diff',
    contentType: 'text/x-diff',
    size: 100,
    sha256: '',
    caption: null,
    createdAt: '2026-01-01T00:00:00Z',
    actor: { kind: 'agent', name: 'brush' },
    channel: 'cli',
  };
};

const PATCH =
  'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n';

const q = (selector: string) => page?.root.querySelector<HTMLElement>(selector) ?? null;
const all = (selector: string) => [...(page?.root.querySelectorAll<HTMLElement>(selector) ?? [])];
// What a screen reader reads of a line: its text without what is hidden from it.
const heard = (el: Element): string =>
  [...el.childNodes]
    .map((node) =>
      node instanceof Element
        ? node.getAttribute('aria-hidden') === 'true'
          ? ''
          : heard(node)
        : (node.textContent ?? ''),
    )
    .join('');

describe('a diff read without seeing it', () => {
  it('says on each line whether it was added or removed, in the reader’s words', async () => {
    setLanguage('es');
    page = mount(<EvidenceViewer evidence={diff(PATCH)} />);
    await settle();
    const added = q('.ev-line[data-kind="add"]') as HTMLElement;
    const removed = q('.ev-line[data-kind="del"]') as HTMLElement;
    const kept = q('.ev-line[data-kind="ctx"]') as HTMLElement;
    expect(heard(added)).toContain('añadida');
    expect(heard(removed)).toContain('quitada');
    expect(heard(removed)).not.toContain('añadida');
    expect(heard(kept)).not.toMatch(/añadida|quitada/);
  });

  it('says it on each side of a diff side by side too', async () => {
    page = mount(<EvidenceViewer evidence={diff(PATCH)} split />);
    await settle();
    expect(heard(q('[data-side="old"][data-kind="del"]') as HTMLElement)).toContain('removed');
    expect(heard(q('[data-side="new"][data-kind="add"]') as HTMLElement)).toContain('added');
  });

  // axe: a box that scrolls sideways must be reachable with the keys, or its long lines are not.
  it('can be reached with the keys where it scrolls, named by its file', async () => {
    page = mount(<EvidenceViewer evidence={diff(PATCH)} />);
    await settle();
    const box = q('.ev-code') as HTMLElement;
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toBe('x.ts');
  });

  it('says which layout is on', async () => {
    page = mount(<EvidenceViewer evidence={diff(PATCH)} />);
    await settle();
    const [unified, side] = all('[aria-label="How the diff reads"] button');
    expect(unified?.getAttribute('aria-pressed')).toBe('true');
    expect(side?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => side?.click());
    expect(unified?.getAttribute('aria-pressed')).toBe('false');
    expect(side?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a line picked for a note with the keys', () => {
  const read = async () => {
    const file = diff(PATCH);
    page = mount(
      <EvidenceReader
        evidence={[file]}
        at={0}
        onAt={() => {}}
        note={{ onSend: async () => true }}
      />,
    );
    await settle();
    return file;
  };
  const key = async (el: Element, name: string) =>
    act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });

  it('makes the lines reachable: one stop for the diff, the arrows move between its lines', async () => {
    await read();
    const lines = all(
      '.ev-line[data-kind="ctx"], .ev-line[data-kind="del"], .ev-line[data-kind="add"]',
    );
    expect(lines).toHaveLength(3);
    // One Tab stop, not a stop per line.
    expect(lines.filter((line) => line.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(lines.every((line) => line.hasAttribute('tabindex'))).toBe(true);
    const first = lines[0] as HTMLElement;
    first.focus();
    await key(first, 'ArrowDown');
    expect(document.activeElement).toBe(lines[1]);
    await key(lines[1] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(lines[2]);
    await key(lines[2] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(lines[1]);
  });

  it('Enter on a line takes the note to that line and puts the focus in the note box', async () => {
    await read();
    const removed = q('.ev-line[data-kind="del"]') as HTMLElement;
    removed.focus();
    await key(removed, 'Enter');
    const box = q('textarea') as HTMLTextAreaElement;
    expect(box.getAttribute('aria-label')).toBe('Note on line 2');
    expect(document.activeElement).toBe(box);
  });

  it('leaves a diff read without a note alone: no stops, no roles', async () => {
    page = mount(<EvidenceViewer evidence={diff(PATCH)} />);
    await settle();
    expect(all('.ev-line[tabindex]')).toHaveLength(0);
  });
});
