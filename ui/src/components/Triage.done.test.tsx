// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import { type Mounted, mount } from '../test-dom.tsx';
import { Done } from './Triage.tsx';

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage('en');
});

// D-14cde0 (s-real2): a tall card was scrolled down to its buttons; deciding the last one swapped it
// for the short «No reviews left», at the top of the page, and the screen stayed on blank space.
describe('the end of a Triage pass', () => {
  let mounted: Mounted | undefined;
  afterEach(() => mounted?.unmount());

  it('brings «No reviews left» into view once the last card is decided', () => {
    const scrolled = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrolled);

    mounted = mount(<Done decided={2} onBack={() => undefined} />);

    expect(mounted.root.textContent).toContain('No reviews left.');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(mounted.root.querySelector('.tdone'));
  });

  it('leaves the page alone when nothing was waiting to begin with', () => {
    const scrolled = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrolled);

    mounted = mount(<Done decided={0} onBack={() => undefined} />);

    expect(scrolled).not.toHaveBeenCalled();
  });
});
