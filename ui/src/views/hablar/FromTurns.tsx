import type { FromMessage } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { hablarHash } from '../../selection.ts';
import { SecretaryMark } from './SecretaryMark.tsx';

// The way back from an item page to the turn of the conversation it came out of: «salió de Hablar
// · "…"», which opens Hablar at that turn. Nothing at all for an item that came from elsewhere.
export function FromTurns({ turns }: { turns: readonly FromMessage[] | undefined }) {
  const [first, ...more] = turns ?? [];
  if (!first) return null;
  return (
    <p className="hb-from">
      <SecretaryMark />
      <a href={hablarHash({ turn: first.id })}>{t('hablar.from', { snippet: first.snippet })}</a>
      {more.length > 0 ? (
        <span className="hb-turns">{t('hablar.from.more', { count: more.length })}</span>
      ) : null}
    </p>
  );
}
