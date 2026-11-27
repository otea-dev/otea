import type { AtRule, Plugin } from 'postcss';

// What a phone is, for the page's layout: up to 720 px wide (SPEC §10.7, mock:893), or turned on
// its side. A phone in landscape is 844x390 or 568x320: wider than 720, so the desk layout came,
// its heading, its rail and its composer filled the screen, and Hablar's conversation kept no
// height at all (field study 5, the Android emulator). A phone is told from a short window on a
// computer by its touch screen; a window on a computer keeps the desk, short as it is.
export const LANDSCAPE_PHONE = '(max-height: 500px) and (pointer: coarse)';
export const PHONE_QUERY = `(max-width: 720px), ${LANDSCAPE_PHONE}`;

// A screen too short for what the desk and the phone both pile above the conversation (the strip
// of what waits, the offline notice, the suggestions): they fold to one line or go. By height alone.
export const SHORT_QUERY = '(max-height: 500px)';

const NARROW = '(max-width: 720px)';
const WIDE = '(min-width: 721px)';

// The style sheets say `@media (max-width: 720px)` for the phone and `(min-width: 721px)` for the
// desk, in about thirty places. The build adds the phone on its side to each: an alternative for
// the first, and `not` the phone for the second. One definition, here, and the sheets keep
// reading as they always did.
export function phoneMedia(params: string): string {
  // Said already (the plugin sees a changed rule again), or nothing of the phone in it.
  if (params.includes(LANDSCAPE_PHONE)) return params;
  if (!params.includes(NARROW) && !params.includes(WIDE)) return params;
  const alternatives = params.split(',').map((each) => each.trim());
  const out: string[] = [];
  for (const each of alternatives) {
    out.push(each.includes(WIDE) ? `${each} and (not (${LANDSCAPE_PHONE}))` : each);
    if (each.includes(NARROW)) out.push(each.replace(NARROW, LANDSCAPE_PHONE));
  }
  return out.join(', ');
}

export function phoneByHeight(): Plugin {
  return {
    postcssPlugin: 'otea-phone-by-height',
    AtRule: {
      media(rule: AtRule) {
        const next = phoneMedia(rule.params);
        if (next !== rule.params) rule.params = next;
      },
    },
  };
}
phoneByHeight.postcss = true as const;
