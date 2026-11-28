// @vitest-environment happy-dom
import { act, useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { type Mounted, mount } from '../../test-dom.tsx';
import { useSheetFocus } from './sheet-focus.ts';

// Pilot 1 (a2): opening a sheet beside the list left the focus on the row, and Tab went through the
// page. The focus goes into the sheet, to its headline, when it opens, and back to what opened it
// when it closes.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
});

function Page() {
  const sheet = useRef<HTMLElement>(null);
  const [shown, setShown] = useState<string | null>(null);
  const { keepNav } = useSheetFocus(sheet, shown, shown ?? '');
  return (
    <>
      <button type="button" id="row" onClick={() => setShown('CAM-1')}>
        CAM-1
      </button>
      {shown === null ? null : (
        <article ref={sheet} aria-label="sheet" key="sheet">
          <div key={shown}>
            <button
              type="button"
              id="next"
              data-nav="1"
              onClick={() => {
                keepNav(1);
                setShown('CAM-2');
              }}
            >
              next
            </button>
            <h1 className="headline">{shown}</h1>
            <button type="button" id="close" onClick={() => setShown(null)}>
              close
            </button>
          </div>
        </article>
      )}
    </>
  );
}

const at = (id: string) => document.getElementById(id) as HTMLElement;
const pressed = async (id: string, byKeyboard = true) => {
  if (byKeyboard) at(id).focus();
  await act(async () => at(id).click());
};

describe('useSheetFocus', () => {
  it('takes the focus to the headline when the sheet opens from a control, and gives it back on close', async () => {
    page = mount(<Page />);
    await pressed('row');
    expect(document.activeElement).toBe(document.querySelector('h1.headline'));
    expect(document.activeElement?.textContent).toBe('CAM-1');
    await pressed('close', false);
    expect(document.activeElement).toBe(at('row'));
  });

  it('leaves the focus alone when the sheet opens with none to take from (a deep link, a pointer)', async () => {
    page = mount(<Page />);
    await pressed('row', false);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the focus on Siguiente when the next item takes the sheet', async () => {
    page = mount(<Page />);
    await pressed('row');
    await pressed('next');
    expect(document.querySelector('h1.headline')?.textContent).toBe('CAM-2');
    expect(document.activeElement).toBe(at('next'));
  });
});
