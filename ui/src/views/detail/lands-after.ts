import { t } from '../../i18n/i18n.ts';
import type { Item } from '../../types.ts';

// Why an approved item waits to land (src/app/land-order.ts says it to the agents, in English, with
// their words): the page says it in its own language and the person's words. Approving was the
// person's; landing goes one change at a time, in the order they approved them.
export function landsAfterText(waits: Item['landsAfter'] | undefined): string | undefined {
  if (!waits) return undefined;
  return t(waits.overlap ? 'bi.branch.waitsFirstSame' : 'bi.branch.waitsFirst', {
    first: waits.first,
  });
}
