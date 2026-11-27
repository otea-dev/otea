// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Mounted, mount, settle } from '../../test-dom.tsx';
import { useLocalBehind } from './local-behind.ts';

// G3: the banner «your local base is behind» stayed after the person ran git pull, and a PC that
// stopped answering left the last word on the screen.

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
});

function Banner() {
  const behind = useLocalBehind('CAM-1', true, '2026-11-11T12:00:00Z');
  return <p id="said">{behind ? `behind ${behind.behind}` : 'nothing'}</p>;
}

const said = () => document.getElementById('said')?.textContent;

// What the PC answers to «is the local base behind»: a number of commits, none, or a failure.
function pc(first: number | null) {
  const answer: { now: number | null | 'down' } = { now: first };
  vi.stubGlobal('fetch', async () => {
    if (answer.now === 'down') {
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    }
    const behind =
      answer.now === null
        ? null
        : { base: 'main', remote: 'origin/main', behind: answer.now, checkout: '/w', state: 'ready' };
    return new Response(JSON.stringify({ behind }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  return answer;
}

describe('the banner of a local base that is behind', () => {
  it('asks again when the person comes back to the window, so a git pull takes it away', async () => {
    const answer = pc(2);
    page = mount(<Banner />);
    await settle();
    expect(said()).toBe('behind 2');

    answer.now = null;
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(said()).toBe('nothing');
  });

  it('asks again when the page becomes visible', async () => {
    const answer = pc(2);
    page = mount(<Banner />);
    await settle();

    answer.now = 1;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(said()).toBe('behind 1');
  });

  it('does not keep saying what it last heard when the PC stops answering', async () => {
    const answer = pc(2);
    page = mount(<Banner />);
    await settle();
    expect(said()).toBe('behind 2');

    answer.now = 'down';
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(said()).toBe('nothing');
  });
});
