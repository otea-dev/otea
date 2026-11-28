// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import { type Mounted, mount, typeInto } from '../test-dom.tsx';
import { Notes } from './Triage.tsx';

// Field study s-final (D-33d880): the notes of a send-back in Triage went only with the button.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  setLanguage('en');
});

describe('the notes of a send-back in Triage', () => {
  it('go on Ctrl+Enter or Cmd+Enter once there are words, and Enter alone writes a line', async () => {
    setLanguage('es');
    const onSend = vi.fn();
    page = mount(<Notes open onSend={onSend} onCancel={() => undefined} />);
    const box = page.root.querySelector('textarea') as HTMLTextAreaElement;
    const key = async (init: KeyboardEventInit) => {
      await act(async () => {
        box.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }),
        );
      });
    };
    await key({ ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();

    await typeInto(box, ' Falta el borde. ');
    await key({});
    expect(onSend).not.toHaveBeenCalled();
    await key({ ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Falta el borde.');
    await key({ metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
