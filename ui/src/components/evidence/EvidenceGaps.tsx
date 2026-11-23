import { freshWords } from '../../fresh-words.ts';
import { listOr, t } from '../../i18n/i18n.ts';
import type { EvidenceGaps as Gaps } from '../../views/detail/board-item.ts';

// What a review leaves unsaid by showing only the evidence that has content: a group still short
// of its minimum and a required part still empty, in red, then one quiet line with the optional
// parts nothing was attached to. The desk draws a required part as its own module, so it asks only
// for the rest (`required: false`); the phone, which draws no empty modules, asks for all.
export function EvidenceGaps({ gaps, required = false }: { gaps: Gaps; required?: boolean }) {
  const lacking = required ? gaps.required : [];
  if (!lacking.length && !gaps.groups.length && !gaps.optional.length) return null;
  return (
    <div className="ev-gaps">
      {lacking.map(({ ref, name }) => (
        <p key={ref} className="ev-gap miss">
          {t('evidence.gap.required', { name })}
        </p>
      ))}
      {gaps.groups.map((group) => (
        <p key={group.id} className="ev-gap miss" data-group={group.id}>
          {t('evidence.gap.group', {
            name: group.name,
            min: group.min,
            count: group.have,
            list: listOr(group.parts),
            fresh: freshWords(group.fresh, group.parts),
          })}
        </p>
      ))}
      {gaps.optional.length ? (
        <p className="ev-gap quiet t-cap">
          {t('evidence.gap.optional', { list: gaps.optional.join(', ') })}
        </p>
      ) : null}
    </div>
  );
}
