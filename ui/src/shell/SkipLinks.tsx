import { useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { t } from '../i18n/i18n.ts';

// The first stops of the page: they jump past the rail and the top bar to where the work is. A
// person on the keys otherwise tabs the whole rail to reach the box to write in, or the review that
// waits (pilot 1, a2). They show when they take the focus and are otherwise out of sight.
// Buttons, not links: the address is the app's own route, and a hash would change it.

type Skip = { key: string; label: 'skip.content' | 'skip.compose' | 'skip.review'; target: string };

const CONTENT: Skip = { key: 'content', label: 'skip.content', target: '.main h1' };

const BY_VIEW: Record<string, Skip> = {
  hablar: { key: 'compose', label: 'skip.compose', target: '.hb-composer textarea' },
  toca: { key: 'review', label: 'skip.review', target: '.row[data-sec="revisiones"]:not(.ghost)' },
  atasco: {
    key: 'review',
    label: 'skip.review',
    target: '.row[data-sec="revisiones"]:not(.ghost)',
  },
};

// Moves the focus to a place in the page; a heading takes it without becoming a stop of Tab.
export function skipTo(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) {
    el.setAttribute('tabindex', '-1');
  }
  el.focus();
}

export function SkipLinks() {
  const view = useApp().route.view;
  const wanted = [CONTENT, ...(BY_VIEW[view] ? [BY_VIEW[view]] : [])];
  // Which of the places exist in the page now: a jump to nothing is never offered.
  const [present, setPresent] = useState<string>('');
  const has = wanted
    .filter(({ target }) => document.querySelector(target) !== null)
    .map(({ key }) => key)
    .join(',');
  useEffect(() => {
    if (has !== present) setPresent(has);
  });
  const shown = wanted.filter(({ key }) => present.split(',').includes(key));
  if (shown.length === 0) return null;
  return (
    <nav className="skips" aria-label={t('skip.label')}>
      {shown.map(({ key, label, target }) => (
        <button key={key} type="button" className="skip" onClick={() => skipTo(target)}>
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
