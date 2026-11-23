import { quoted, t } from './i18n/i18n.ts';

// What a group says of the files its counting discards (GroupState.fresh: the names of the parts
// that count only this round's files): that every part is new each round, or which are; nothing when
// the group keeps its older files. It goes right after the list of parts.
export function freshWords(fresh: readonly string[] | undefined, parts: readonly string[]): string {
  if (!fresh || fresh.length === 0) return '';
  if (fresh.length === parts.length) return t('evidence.fresh.all');
  return t('evidence.fresh.some', { names: fresh.map(quoted).join(', ') });
}
