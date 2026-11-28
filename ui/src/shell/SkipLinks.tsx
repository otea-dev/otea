import { useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { t } from '../i18n/i18n.ts';
import { focusPlace, livePlace } from './focus-content.ts';

// The first stops of the page: they jump past the rail and the top bar to where the work is. A
// person on the keys otherwise tabs the whole rail to reach the box to write in, or the review that
// waits (pilot 1, a2). They show when they take the focus and are otherwise out of sight.
// Buttons, not links: the address is the app's own route, and a hash would change it.

type Skip = {
  key: string;
  label: 'skip.content' | 'skip.compose' | 'skip.review' | 'skip.answer';
  target: string;
};

const CONTENT: Skip = { key: 'content', label: 'skip.content', target: '.main h1' };
const REVIEW: Skip = {
  key: 'review',
  label: 'skip.review',
  target: '.row[data-sec="revisiones"]:not(.ghost)',
};

// In the page's own order, so the stops of Tab and the skips go the same way: the content, the
// question that waits for an answer, the box to write in (Hablar's thread comes before its box).
const BY_VIEW: Record<string, Skip[]> = {
  hablar: [
    {
      key: 'answer',
      label: 'skip.answer',
      target: '.hb-ask:not([data-answered]) .hb-opt:not([disabled])',
    },
    { key: 'compose', label: 'skip.compose', target: '.hb-composer textarea' },
  ],
  toca: [REVIEW],
  atasco: [REVIEW],
};

// Moves the focus to a place in the page; a heading takes it without becoming a stop of Tab. A
// view that is leaving is never the place.
export function skipTo(selector: string): void {
  const el = livePlace(selector);
  if (el) focusPlace(el);
}

export function SkipLinks() {
  const view = useApp().route.view;
  const wanted = [CONTENT, ...(BY_VIEW[view] ?? [])];
  // Which of the places exist in the page now: a jump to nothing is never offered.
  const [present, setPresent] = useState<string>('');
  const has = wanted
    .filter(({ target }) => livePlace(target) !== null)
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
