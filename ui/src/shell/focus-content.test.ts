// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { focusContentSoon, livePlace } from './focus-content.ts';

// Field study s-final (D-ab7560): Enter on a rail row left the focus on the row, nine Tabs from the
// first thing to read. The page chosen takes it, once its heading is there.

let area: HTMLElement | undefined;
afterEach(() => area?.remove());
const page = (markup: string) => {
  area?.remove();
  area = document.createElement('div');
  area.innerHTML = markup;
  document.body.append(area);
};

// A frame that runs when the test says so.
const frames = () => {
  const queue: (() => void)[] = [];
  return {
    frame: (run: () => void) => queue.push(run),
    step: () => {
      for (const run of queue.splice(0)) run();
    },
  };
};

describe('the heading of the page', () => {
  it('is the one of the view on screen, never one that is leaving', () => {
    page(
      '<main class="main"><div class="view leaving" aria-hidden="true"><h1 id="old">Te toca</h1></div><div class="view"><h1 id="new">Hablar</h1></div></main>',
    );
    expect(livePlace('.main h1')?.id).toBe('new');
  });
});

describe('after a row of the rail is chosen with the keys', () => {
  it('puts the focus on the new view’s heading once it stands, not on the one that is leaving', () => {
    page('<main class="main"><div class="view"><h1 id="old">Te toca</h1></div></main>');
    const was = document.getElementById('old');
    const { frame, step } = frames();
    focusContentSoon(was, frame);
    step();
    // The new view is not there yet: nothing moved.
    expect(document.activeElement).toBe(document.body);

    page(
      '<main class="main"><div class="view leaving" aria-hidden="true"><h1 id="old2">Te toca</h1></div><div class="view"><h1 id="new">Hablar</h1></div></main>',
    );
    step();
    expect(document.activeElement?.id).toBe('new');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps to the same page’s heading when the same row is chosen again', () => {
    page('<main class="main"><div class="view"><h1 id="same">Te toca</h1></div></main>');
    const { frame, step } = frames();
    focusContentSoon(document.getElementById('same'), frame);
    for (let i = 0; i < 50; i++) step();
    expect(document.activeElement?.id).toBe('same');
  });

  it('stops waiting when told to', () => {
    page('<main class="main"><div class="view"><h1 id="old">Te toca</h1></div></main>');
    const { frame, step } = frames();
    const stop = focusContentSoon(document.getElementById('old'), frame);
    stop();
    for (let i = 0; i < 50; i++) step();
    expect(document.activeElement).toBe(document.body);
  });
});
