import { useApp } from '../../app/context.tsx';
import { blockText } from '../hablar/TeEspera.tsx';

// A review that holds the rest of a board's queue, said on the board: a board that works straight on
// its base (or lands in it) takes one change at a time, so what comes after waits until you have
// settled the one in front, and no row of the list says why. Otea says it from the records
// (app/pending.ts), with the items that wait behind. `ids`: the board's own items.
export function QueueHold({ ids }: { ids: readonly string[] }) {
  const app = useApp();
  const mine = new Set(ids);
  const holds = (app.pending?.blocks ?? []).filter(({ first, waiting }) =>
    [first, ...waiting].some((id) => mine.has(id)),
  );
  if (holds.length === 0) return null;
  return (
    <div className="bhold" role="status" data-leaf="">
      {holds.map((block) => (
        <p key={block.first}>{blockText(block)}</p>
      ))}
    </div>
  );
}
