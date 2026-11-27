import { type RefObject, useEffect } from 'react';

// The room from the foot of the screen to the top of the composer, for what floats over the page to
// stand above it (a toast: field study 4, it covered Enviar and the notes under it). The page
// (phone.css, pops.css) reads it as `--above-composer`, and the toast takes it as its foot.
export function useClearAbove(node: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = node.current;
    const root = document.documentElement;
    if (!el) return;
    const measure = () => {
      const room = window.innerHeight - el.getBoundingClientRect().top;
      if (room > 0) root.style.setProperty('--above-composer', `${Math.round(room) + 8}px`);
    };
    measure();
    const seen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    seen?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      seen?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--above-composer');
    };
  }, [node]);
}
