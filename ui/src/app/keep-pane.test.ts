// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { keepSideways } from './keep-pane.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the main pane never scrolls sideways', () => {
  it('puts a view back when something pushed it sideways, and leaves its vertical scroll alone', () => {
    const main = document.createElement('main');
    const view = document.createElement('div');
    view.className = 'view narrow';
    main.append(view);
    document.body.append(main);
    const stop = keepSideways(main);

    view.scrollLeft = 170;
    view.scrollTop = 40;
    view.dispatchEvent(new Event('scroll'));
    expect(view.scrollLeft).toBe(0);
    expect(view.scrollTop).toBe(40);

    main.scrollLeft = 90;
    main.dispatchEvent(new Event('scroll'));
    expect(main.scrollLeft).toBe(0);

    // A box inside that scrolls sideways on purpose (a table, a diff) is not touched.
    const table = document.createElement('div');
    view.append(table);
    table.scrollLeft = 60;
    table.dispatchEvent(new Event('scroll'));
    expect(table.scrollLeft).toBe(60);

    stop();
    view.scrollLeft = 30;
    view.dispatchEvent(new Event('scroll'));
    expect(view.scrollLeft).toBe(30);
  });
});
