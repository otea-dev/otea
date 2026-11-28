import { useEffect } from 'react';

// The main pane and its views scroll up and down, never sideways: their overflow is hidden, but a
// script (a `scrollIntoView` on something wider than the column, a focus) can still push them
// sideways, and the list beside an open item then sat shifted under the rail with its first words
// cut (field study 4, review and evidence at 1280). Any sideways scroll of the pane or a view
// goes back at once.
export function keepSideways(main: HTMLElement): () => void {
  const back = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;
    if (el !== main && !el.classList.contains('view')) return;
    if (el.scrollLeft !== 0) el.scrollLeft = 0;
  };
  main.addEventListener('scroll', back, { capture: true, passive: true });
  return () => main.removeEventListener('scroll', back, { capture: true });
}

export function useKeepSideways(): void {
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main.main');
    return main ? keepSideways(main) : undefined;
  }, []);
}
