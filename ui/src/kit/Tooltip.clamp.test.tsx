// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../test-dom.tsx';
import { isCut, Tooltip } from './Tooltip.tsx';

// Field study 5 (D2): a long title in a list (the board's rows, the projects page) took as many
// lines as it had words. Every list holds a title to two lines and an ellipsis (lanes.css); the
// whole title is its themed tooltip, said only while it is cut.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const el of document.querySelectorAll('.tip, .row')) el.remove();
});

function row(title: string, box: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = '<div class="main-c"><div class="t"><span class="tt"></span></div></div>';
  const t = el.querySelector<HTMLElement>('.t') as HTMLElement;
  (t.querySelector('.tt') as HTMLElement).textContent = title;
  Object.defineProperty(t, 'scrollHeight', { value: box.scrollHeight });
  Object.defineProperty(t, 'clientHeight', { value: box.clientHeight });
  document.body.append(el);
  return t;
}

const hover = (el: HTMLElement) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(400);
  });
};

describe('the tooltip of a clamped title', () => {
  it('knows when text goes past its box', () => {
    expect(isCut({ scrollHeight: 60, clientHeight: 40 })).toBe(true);
    expect(isCut({ scrollHeight: 41, clientHeight: 40 })).toBe(false);
  });

  it('says the whole title while it is cut', () => {
    const view = mount(<Tooltip />);
    const long = 'Contador de tareas con un título largo que ocupa dos líneas o más';
    hover(row(long, { scrollHeight: 80, clientHeight: 44 }));
    expect(document.querySelector('.tip')?.textContent).toBe(long);
    view.unmount();
  });

  it('keeps quiet while the title fits', () => {
    const view = mount(<Tooltip />);
    hover(row('Modo oscuro', { scrollHeight: 22, clientHeight: 22 }));
    expect(document.querySelector('.tip')).toBeNull();
    view.unmount();
  });
});
