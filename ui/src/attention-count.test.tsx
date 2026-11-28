// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { attentionTitle } from './attention.ts';
import { useAttention } from './hooks.ts';
import type { Pending } from './pending.ts';
import { type Mounted, mount } from './test-dom.tsx';
import type { Item } from './types.ts';

// s-real D-e84919: a question on a Bandeja note waits in Te toca (the rail counts it) and the tab's
// title said one fewer. The title reads the same count as the rail.

const item = (turn: Item['turn']) => ({ turn, lease: null, expiredLease: null }) as unknown as Item;

// `elsewhere` questions on Bandeja notes, as Otea counted them.
function pendingOf(elsewhere: number): Pending {
  const entries = Array.from({ length: elsewhere }, (_, i) => ({
    kind: 'bandeja' as const,
    ref: `B-${i + 1}`,
    title: 'a note',
    since: null,
  }));
  return { count: elsewhere, entries, blocks: [], queues: [], assistant: null };
}

function Title({ items, elsewhere }: { items: readonly Item[]; elsewhere: number }) {
  return <p>{attentionTitle(useAttention(items, pendingOf(elsewhere)), { project: 'repo' })}</p>;
}

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
});

describe('the count in the tab’s title', () => {
  it('counts what is no item beside the items on your turn', () => {
    page = mount(<Title items={[item('human'), item('agent')]} elsewhere={1} />);
    expect(page.root.textContent).toBe('Otea · repo (2)');
  });

  it('counts only the items when nothing else waits', () => {
    page = mount(<Title items={[item('human')]} elsewhere={0} />);
    expect(page.root.textContent).toBe('Otea · repo (1)');
  });
});
